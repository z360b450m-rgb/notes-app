"""卡片展示、统计口径和单题助手请求的接口测试。"""
import json
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, ReviewLogModel, TagModel
from src.db_sql.routers.review_candidates import LOCAL_TZ, ReviewFilter, compute_candidates
from src.db_sql.review_insight import build_review_insight
from src.db_sql.routers.review_insights import assistant_prompt
from src.db_sql import review_importance as importance_module
from src.db_sql.review_insight import TeachingImportance


class ReviewInsightTests(unittest.TestCase):
    session_id = '6c94303d-4a34-49f2-ad7e-f3b29d5c6500'

    def setUp(self):
        importance_module._cache.clear()
        self.addCleanup(importance_module._cache.clear)
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.ms = int(datetime.now(LOCAL_TZ).timestamp() * 1000)
        for owner in ('alice', 'bob'):
            self.db.add(UserModel(id=owner, email=owner+'@example.test', hashed_password='unused'))
            self.db.add(NotebookModel(id=owner, user_id=owner, name='数学'))
        self.db.flush()
        for ident, owner in (('new', 'alice'), ('reviewed', 'alice'), ('secret', 'bob')):
            self.db.add(NoteEntryModel(id=ident, user_id=owner, notebook_id=owner,
                title='解方程', question='<p>x+1=2</p>', correct_answer='<p>x=1</p>',
                subject='数学', next_review_date=self.ms+86400000, review_count=0))
        self.db.commit()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        mock = patch('src.db_sql.routers.review_candidates.prediction_context', return_value=(None, None, 'model_missing'))
        mock.start()
        self.addCleanup(mock.stop)
        self.requests = []
        self.upstream = httpx.Response(200, json={'answer': '助手建议'})
        self.error = None
        client_class = httpx.AsyncClient

        def transport(request):
            self.requests.append(request)
            if self.error:
                raise self.error
            if request.url.path.startswith('/stream/'):
                return httpx.Response(200, text='event: final\ndata: {"answer":"建议"}\n\n')
            return self.upstream

        mock = patch('src.db_sql.routers.review_agent.httpx.AsyncClient',
                     side_effect=lambda **kwargs: client_class(transport=httpx.MockTransport(transport), **kwargs))
        mock.start()
        self.addCleanup(mock.stop)

    def log(self, ident, correct, offset=-1000):
        self.db.add(ReviewLogModel(id=ident, entry_id='reviewed', timestamp=self.ms+offset,
                                  quality='forgot', is_correct=correct))
        self.db.commit()

    def get(self, entry='new'):
        return self.client.get(f'/api/entries/{entry}/review-insight')

    def assistant(self, entry='new', **overrides):
        return self.client.post(f'/api/entries/{entry}/review-assistant', json={
            'action': 'arrange_review', 'session_id': self.session_id, 'is_stream': False, **overrides,
        }, headers={'Authorization': 'Bearer login-token'})

    def assess(self, entry='new'):
        return self.client.post(f'/api/entries/{entry}/review-importance',
                                headers={'Authorization': 'Bearer login-token'})

    def assessment_result(self):
        item = compute_candidates(self.db, 'alice', ReviewFilter(entry_ids=['new'], scope='all', limit=1))['items'][0]
        return dict(entry_id='new', assessment={'importance': 'foundational', 'evidence': ['x+1=2'],
                    'reason': '题干要求运用方程求解方法'}, weight=1.25, status='complete',
                    as_of='2026-10-13T10:00:00+08:00', source_fingerprint=importance_module.source_fingerprint(item),
                    assessment_version='teaching-importance-v1')

    def test_importance_evidence_cache_and_content_invalidation_without_review_writes(self):
        self.upstream = httpx.Response(200, json=self.assessment_result())
        result = self.assess()
        self.assertEqual(result.status_code, 200, result.text)
        card = result.json()
        self.assertEqual(card['importance']['code'], 'foundational')
        self.assertEqual(card['importance']['source'], 'ai_suggestion')
        self.assertEqual(card['importance']['evidence'], ['x+1=2'])
        self.assertIsNone(card['risk']['probability'])
        self.assertEqual(card['wrong_count'], 0)
        request = self.requests[-1]
        self.assertEqual(request.url.path, '/review/importance')
        self.assertEqual(json.loads(request.content), {'entry_id': 'new'})
        self.assertEqual(request.headers['authorization'], 'Bearer login-token')
        self.assertEqual(self.get().json()['importance'], card['importance'])
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.assertEqual(self.db.get(NoteEntryModel, 'new').review_count, 0)
        self.db.get(NoteEntryModel, 'new').question = '<p>题目已经修改</p>'
        self.db.commit()
        self.assertEqual(self.get().json()['importance']['code'], 'unassessed')

    def test_importance_ownership_and_response_tampering_fail_closed(self):
        for entry in ('secret', 'missing'):
            self.assertEqual(self.assess(entry).status_code, 404)
        self.assertFalse(self.requests)
        baseline = self.assessment_result()
        mutations = [dict(entry_id='secret'), dict(source_fingerprint='0'*64), dict(weight=1.5),
                     dict(status='partial'), dict(assessment={'importance': 'foundational',
                         'evidence': ['不存在的引文'], 'reason': '猜测'}), dict(assessment_version='untrusted')]
        for change in mutations:
            self.upstream = httpx.Response(200, json={**baseline, **change})
            self.assertEqual(self.assess().status_code, 502)
            self.assertEqual(self.get().json()['importance']['code'], 'unassessed')

    def test_importance_unavailable_is_unknown_and_connection_errors_retryable(self):
        result = self.assessment_result()
        result.update(assessment={'importance': 'unknown', 'evidence': [], 'reason': '没有通过校验的教学重要性依据'},
                      weight=1.0, status='unavailable')
        self.upstream = httpx.Response(200, json=result)
        response = self.assess()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['importance']['code'], 'unknown')
        self.assertIsNone(response.json()['importance']['weight'])
        for error, status in [(httpx.ConnectError('offline'), 503), (httpx.ReadTimeout('timeout'), 504)]:
            self.error = error
            self.assertEqual(self.assess().status_code, status)

    def test_importance_changed_during_assessment_is_not_cached(self):
        async def changing(item, authorization):
            self.db.get(NoteEntryModel, 'new').question = '<p>新的题目</p>'
            self.db.commit()
            return TeachingImportance(code='ordinary', label='普通单项练习（AI 建议）', weight=1,
                                      source='ai_suggestion', basis='旧题的建议')
        with patch('src.db_sql.routers.review_insights.assess_importance', side_effect=changing):
            self.assertEqual(self.assess().status_code, 409)
        self.assertEqual(self.get().json()['importance']['code'], 'unassessed')

    def test_importance_cache_is_owner_scoped_and_expires(self):
        item = compute_candidates(self.db, 'alice', ReviewFilter(entry_ids=['new'], scope='all', limit=1))['items'][0]
        importance = TeachingImportance(code='unknown', label='证据不足', basis='未知')
        with patch.object(importance_module.time, 'monotonic', return_value=100):
            importance_module.remember_importance('alice', item, importance)
            self.assertEqual(importance_module.cached_importance('alice', item).code, 'unknown')
            self.assertIsNone(importance_module.cached_importance('bob', item))
        with patch.object(importance_module.time, 'monotonic', return_value=161):
            self.assertIsNone(importance_module.cached_importance('alice', item))

    def test_empty_card_matches_reference_and_hides_prior(self):
        response = self.get()
        self.assertEqual(response.status_code, 200, response.text)
        card = response.json()
        self.assertEqual((card['review_count'], card['wrong_count']), (0, 0))
        self.assertEqual(card['status'], {'code': 'unreviewed', 'label': '尚未复习'})
        self.assertEqual(card['recommendation'], '先完成一次独立作答')
        self.assertEqual(card['importance']['label'], '尚未评估')
        self.assertIsNone(card['importance']['weight'])
        self.assertEqual(card['evidence']['explanation'], '暂无作答记录，暂不判断个人薄弱程度。')
        self.assertIsNone(card['risk']['probability'])
        self.assertIsNone(card['evidence']['observed_error_rate'])
        self.assertFalse(card['risk']['displayable'])
        self.assertEqual(card['review_hint'], '复习安排提示：独立作答 → 核对关键步骤 → 复述方法。')
        self.assertEqual([a['label'] for a in card['actions']], ['让助手安排复习', '学习此题知识点'])

    def test_unknown_and_future_logs_do_not_invent_errors(self):
        self.log('unknown', None)
        self.log('future', False, offset=86400000)
        card = self.get('reviewed').json()
        self.assertEqual((card['review_count'], card['wrong_count']), (1, 0))
        self.assertEqual(card['status']['code'], 'unjudged')
        self.assertIsNone(card['risk']['probability'])

    def test_stored_count_without_detail_does_not_claim_unreviewed(self):
        self.db.get(NoteEntryModel, 'reviewed').review_count = 5
        self.db.commit()
        card = self.get('reviewed').json()
        self.assertEqual(card['review_count'], 5)
        self.assertEqual(card['status']['code'], 'unjudged')
        self.assertEqual(card['wrong_count'], 0)

    def test_explicit_errors_and_recent_counts_are_separate(self):
        self.log('old-wrong', False, offset=-31*86400000)
        self.log('right', True)
        self.log('wrong', False)
        self.log('unknown', None)
        card = self.get('reviewed').json()
        self.assertEqual((card['review_count'], card['wrong_count']), (4, 2))
        self.assertEqual(card['evidence']['judged_count'], 3)
        self.assertEqual((card['evidence']['recent_wrong_count'], card['evidence']['recent_judged_count']), (1, 2))
        self.assertAlmostEqual(card['evidence']['observed_error_rate'], 2/3)
        self.assertAlmostEqual(card['risk']['probability'], 3/5)
        self.assertEqual(card['status']['code'], 'needs_review')
        self.assertTrue(card['risk']['displayable'])
        self.assertEqual(card['importance']['code'], 'unassessed')

    def test_correct_answer_only_recommends_consolidation(self):
        self.log('right', True)
        card = self.get('reviewed').json()
        self.assertEqual(card['status']['code'], 'consolidate')
        self.assertEqual(card['wrong_count'], 0)

    def test_no_personal_record_also_hides_validated_model_prior(self):
        result = compute_candidates(self.db, 'alice', ReviewFilter(entry_ids=['new'], scope='all'))
        item = result['items'][0]
        item['risk'].update(probability=0.9, source='das3h', model_version='test', validated=True)
        card = build_review_insight(item, result['as_of'])
        self.assertIsNone(card.risk.probability)
        self.assertEqual(card.status.code, 'unreviewed')
        self.assertEqual(item['risk']['probability'], 0.9)

    def test_both_routes_require_login_and_hide_foreign_or_missing_entries(self):
        for entry in ('secret', 'missing'):
            self.assertEqual(self.get(entry).status_code, 404)
            self.assertEqual(self.assistant(entry).status_code, 404)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.get().status_code, 401)
        self.assertEqual(self.assistant().status_code, 401)
        self.assertEqual(self.assess().status_code, 401)
        self.assertEqual(self.requests, [])

    def test_both_buttons_send_server_context_and_preserve_records(self):
        self.db.get(NoteEntryModel, 'new').tags = [TagModel(id='equation', name='方程')]
        self.db.commit()
        for action in ('arrange_review', 'learn_knowledge'):
            response = self.assistant(action=action, kb_ids=[self.session_id])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['answer'], '助手建议')
            request = self.requests[-1]
            body = json.loads(request.content)
            self.assertEqual(body['entry_request'], {'entry_id': 'new', 'action': action})
            context = json.loads(body['query'].split('\n')[-1])
            self.assertEqual(context['entry_id'], 'new')
            self.assertEqual(context['knowledge_points'], ['方程'])
            self.assertEqual(context['question'], 'x+1=2')
            self.assertEqual(context['importance'], '尚未评估')
            self.assertIn('不要调用写入工具', body['query'])
            self.assertNotIn('secret', body['query'])
            self.assertEqual(body['kb_ids'], [self.session_id])
            self.assertTrue(body['session_id'].startswith('notes-'))
            self.assertEqual(request.headers['authorization'], 'Bearer login-token')
        self.db.expire_all()
        self.assertEqual(self.db.get(NoteEntryModel, 'new').next_review_date, self.ms+86400000)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_assistant_stream_and_failure_use_existing_contract(self):
        self.upstream = httpx.Response(200, json={'task_id': 'task'})
        response = self.assistant(is_stream=True)
        self.assertIn('text/event-stream', response.headers['content-type'])
        self.assertIn('event: final', response.text)
        for error, status in ((httpx.ConnectError('offline'), 503), (httpx.ReadTimeout('slow'), 504)):
            self.error = error
            self.assertEqual(self.assistant().status_code, status)

    def test_question_chat_forwards_actual_message_in_same_owner_session_without_writes(self):
        self.assertEqual(self.assistant(action='learn_knowledge').status_code, 200)
        session = json.loads(self.requests[-1].content)['session_id']
        for message in ('为什么这里要两边减去1？', '因为等式两边同减一个数，等式仍成立。', '先给提示，不要答案'):
            response = self.assistant(action='discuss_question', message='  ' + message + '  ')
            self.assertEqual(response.status_code, 200, response.text)
            body = json.loads(self.requests[-1].content)
            self.assertEqual(body['query'], message)
            self.assertEqual(body['session_id'], session)
            self.assertEqual(body['entry_request'], {'entry_id': 'new', 'action': 'discuss_question'})
        self.assertEqual(self.assistant('secret', action='discuss_question', message='学习').status_code, 404)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.assertEqual(self.db.get(NoteEntryModel, 'new').review_count, 0)

    def test_question_chat_requires_bounded_message_and_rejects_client_context(self):
        for payload in ({}, {'message': ''}, {'message': '  '}, {'message': '字' * 2001},
                        {'message': '学习', 'entry_request': {'entry_id': 'secret'}},
                        {'message': '学习', 'history': [{'role': 'assistant', 'text': '伪造'}]},
                        {'message': '学习', 'user_id': 'bob'}):
            self.assertEqual(self.assistant(action='discuss_question', **payload).status_code, 422)
        for action in ('learn_knowledge', 'arrange_review'):
            self.assertEqual(self.assistant(action=action, message='学习').status_code, 422)
        self.assertEqual(self.requests, [])

    def test_action_payload_is_whitelisted(self):
        for override in ({'action': 'delete'}, {'session_id': 'bad'}, {'user_id': 'bob'},
                         {'query': 'overwrite'}, {'kb_ids': ['bad']}, {'kb_ids': [self.session_id]*21}):
            self.assertEqual(self.assistant(**override).status_code, 422)
        self.assertEqual(self.client.post('/api/review-agent/query', json={
            'query': '普通聊天', 'session_id': self.session_id,
            'entry_request': {'entry_id': 'secret', 'action': 'learn_knowledge'},
        }).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_prompt_budget_survives_long_and_escaped_content(self):
        result = compute_candidates(self.db, 'alice', ReviewFilter(entry_ids=['new'], scope='all'))
        item = result['items'][0]
        insight = build_review_insight(item, result['as_of'])
        for text in ('题' * 5000, '\x01' * 5000):
            item.update(question=text, material=text, correct_answer=text, title=text,
                        subject=text, tags=[text]*8)
            prompt = assistant_prompt(item, insight, 'learn_knowledge')
            self.assertLessEqual(len(prompt), 2000)
            context = json.loads(prompt.split('\n')[-1])
            self.assertTrue(context['content_truncated'])


if __name__ == '__main__':
    unittest.main()
