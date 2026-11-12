import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.main import app
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, ReviewLogModel, ReviewAttemptModel
from src.db_sql.review_importance import source_fingerprint
from src.db_sql.routers.review_insights import selected_candidate


class AttemptTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.addCleanup(patch.stopall)
        for owner in ('alice', 'bob'):
            self.db.add(UserModel(id=owner, email=owner+'@example.test', hashed_password='unused'))
            self.db.add(NotebookModel(id=owner, user_id=owner, name='数学'))
        self.db.flush()
        for ident, owner in (('entry', 'alice'), ('secret', 'bob')):
            self.db.add(NoteEntryModel(id=ident, user_id=owner, notebook_id=owner, title='方程',
                question='解方程 x+1=2', correct_answer='x=1', review_count=0, next_review_date=9999999999999))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        patch('src.db_sql.routers.review_candidates.prediction_context', return_value=(None, None, 'model_missing')).start()
        self.attempt_id = str(uuid4())
        self.requests = []
        self.error = None
        self.mode = 'normal'
        self.mutate = lambda data: data
        self.during_model = lambda: None
        original = httpx.AsyncClient
        def transport(request):
            self.requests.append(request)
            if self.error:
                raise self.error
            payload = json.loads(request.content)
            result = self.grading(payload)
            self.during_model()
            return httpx.Response(200, json=self.mutate(result))
        patch('src.db_sql.review_grading.httpx.AsyncClient', side_effect=lambda **kwargs:
            original(transport=httpx.MockTransport(transport), **kwargs)).start()

    def grading(self, payload):
        item, _ = selected_candidate(self.db, 'alice', 'entry')
        answer, reason = payload['answer_text'], payload['explanation_text']
        ans = 'incorrect' if 'x=3' in answer else 'correct'
        reason = reason or (answer if '因为' in answer else '')
        expl = 'invalid' if '蒙' in reason or reason == '我不清楚' else 'valid' if reason or '因为' in answer else 'missing'
        if self.mode == 'unknown':
            ans = expl = 'uncertain'
        def criterion(verdict, student):
            return {'verdict': verdict, 'student_evidence': [student] if student else [],
                    'reference_evidence': ['x=1'] if student else [], 'feedback': '点评关键知识点'}
        pending = not reason and expl == 'missing'
        status = 'awaiting_explanation' if pending else 'needs_review' if ans == 'uncertain' else 'final'
        return {'entry_id': 'entry', 'source_fingerprint': source_fingerprint(item), 'status': status,
            'is_correct': (ans == 'correct' and expl != 'invalid') if status == 'final' else None,
            'evaluation_completed': status != 'awaiting_explanation',
            'assessment': {'answer': criterion(ans, answer), 'explanation': criterion(expl, reason or answer if expl not in ('missing', 'uncertain') else '')},
            'comment': '完整点评' if status == 'final' else '请说明关键解题理由',
            'followup_question': '' if status == 'final' else '你是怎么得到答案的？',
            'grading_version': 'review-single-pass-v2', 'source': 'ai_suggestion'}

    def submit(self, answer='x=1', entry='entry', **extra):
        return self.client.post(f'/api/entries/{entry}/review-attempts', json={
            'attempt_id': self.attempt_id, 'answer_text': answer, 'elapsed_ms': 1234, **extra},
            headers={'Authorization': 'Bearer token'})

    def explain(self, reason='等式两边减去1', revision=1):
        return self.client.post(f'/api/entries/entry/review-attempts/{self.attempt_id}/explanation',
            json={'explanation_text': reason, 'expected_revision': revision}, headers={'Authorization': 'Bearer token'})

    def test_answer_alone_collects_reason_then_finishes_once(self):
        response = self.submit()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['status'], 'awaiting_explanation')
        self.assertFalse(response.json()['evaluation_completed'])
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.assertFalse(self.submit().json()['evaluation_completed'])
        self.assertEqual(len(self.requests), 1)
        result = self.explain().json()
        self.assertEqual(result['status'], 'final')
        self.assertTrue(result['evaluation_completed'])
        self.assertTrue(result['is_correct'])
        self.assertEqual(result['entry_review']['review_count'], 1)
        self.assertEqual(self.submit().json()['review_log']['id'], self.attempt_id)
        self.assertEqual(self.explain('再补一句').json()['review_log']['id'], self.attempt_id)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 1)
        self.assertEqual(self.submit(answer='x=2').status_code, 409)
        self.assertEqual(self.db.get(NoteEntryModel, 'entry').next_review_date, 9999999999999)

    def test_clear_reason_in_first_answer_passes_without_followup(self):
        result = self.submit('x=1，因为等式两边减去1')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['status'], 'final')
        self.assertTrue(result.json()['is_correct'])
        self.assertFalse(result.json()['followup_question'])
        self.assertEqual(len(self.requests), 1)

    def test_correct_answer_with_invalid_reason_is_incorrect(self):
        result = self.submit('x=1，因为我是蒙的')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertFalse(result.json()['is_correct'])
        self.assertEqual(result.json()['answer_verdict'], 'correct')
        self.assertEqual(result.json()['explanation_verdict'], 'invalid')
        self.assertEqual(result.json()['entry_review']['wrong_count'], 1)

    def test_wrong_initial_answer_cannot_be_replaced_by_later_correct_answer(self):
        self.submit('x=3')
        final = self.explain('后来发现正确答案是x=1，需要两边减去1')
        self.assertFalse(final.json()['is_correct'])
        self.assertEqual(final.json()['review_log']['answer_text'], 'x=3')

    def test_wrong_answer_collects_reason_once_then_allows_continuing(self):
        pending = self.submit('x=3')
        self.assertFalse(pending.json()['evaluation_completed'])
        result = self.explain('我不清楚')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['status'], 'final')
        self.assertTrue(result.json()['evaluation_completed'])
        self.assertFalse(result.json()['is_correct'])
        self.assertEqual(result.json()['entry_review']['wrong_count'], 1)
        self.assertFalse(self.explain('再解释').json()['is_correct'])
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 1)

    def test_single_pass_grading_accepts_optional_reason_but_not_uncertainty(self):
        from src.db_sql.review_grading import GradeResponse
        for answer in ('correct', 'incorrect', 'uncertain'):
            for explanation in ('valid', 'invalid', 'missing', 'uncertain'):
                with self.subTest(answer=answer, explanation=explanation):
                    data = self.grading({'answer_text': 'x=1', 'explanation_text': '等式两边减去1'})
                    data['assessment']['answer']['verdict'] = answer
                    data['assessment']['explanation']['verdict'] = explanation
                    complete = answer != 'uncertain' and explanation in ('valid', 'invalid', 'missing')
                    data['status'] = ('final' if complete else 'needs_review' if 'uncertain' in (answer, explanation)
                                      else 'awaiting_explanation')
                    data['is_correct'] = (answer == 'correct' and explanation != 'invalid') if complete else None
                    result = GradeResponse.model_validate(data)
                    self.assertEqual(result.status == 'final', complete)
                    if not complete:
                        data.update(status='final', is_correct=False)
                        with self.assertRaises(ValueError):
                            GradeResponse.model_validate(data)

    def test_uncertainty_is_complete_and_never_regraded_or_counted_as_wrong(self):
        self.mode = 'unknown'
        result = self.submit('x=1，因为等式两边减去1')
        self.assertEqual(result.json()['status'], 'needs_review')
        self.assertTrue(result.json()['evaluation_completed'])
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.mode = 'normal'
        self.assertEqual(self.submit('x=1，因为等式两边减去1').json()['status'], 'needs_review')
        self.assertEqual(self.explain().json()['status'], 'needs_review')
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_malformed_result_cannot_write_boolean_counts(self):
        for mutation in (lambda data: {**data, 'is_correct': False},
                         lambda data: {**data, 'status': 'final'},
                         lambda data: {**data, 'assessment': {**data['assessment'], 'answer': {
                             **data['assessment']['answer'], 'verdict': 'correct', 'student_evidence': ['别人的作答']}}}):
            self.mutate = mutation
            self.assertEqual(self.submit().status_code, 502)
            self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_question_modified_during_grading_is_not_counted(self):
        def modifying():
            self.db.get(NoteEntryModel, 'entry').question = '改过的题目'
            self.db.commit()
        self.during_model = modifying
        self.assertEqual(self.submit('x=1，因为等式两边减去1').status_code, 409)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_ownership_and_whitelist(self):
        self.assertEqual(self.submit(entry='secret').status_code, 404)
        for extra in ({'is_correct': True}, {'user_id': 'bob'}, {'answer_text': '   '}, {'elapsed_ms': -1}):
            self.assertEqual(self.submit(**extra).status_code, 422)
        self.assertFalse(self.requests)
        self.submit()
        self.assertEqual(self.explain(revision=999).status_code, 409)
        self.assertEqual(len(self.requests), 1)
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='bob')
        self.assertEqual(self.submit(entry='secret').status_code, 404)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.submit().status_code, 401)

    def test_busy_and_expired_lease(self):
        self.error = httpx.ConnectError('offline')
        self.submit()
        self.error = None
        attempt = self.db.get(ReviewAttemptModel, self.attempt_id)
        attempt.result = None
        attempt.status = 'grading'
        attempt.lease_until = int(time.time()*1000)+90000
        self.db.commit()
        self.assertEqual(self.submit().status_code, 409)
        attempt.lease_until = 0
        self.db.commit()
        self.assertEqual(self.submit().json()['status'], 'awaiting_explanation')

    def test_revision_changed_during_model_cannot_finalize_an_old_result(self):
        def advancing():
            attempt = self.db.get(ReviewAttemptModel, self.attempt_id)
            attempt.revision += 1
            self.db.commit()
        self.during_model = advancing
        self.assertEqual(self.submit('x=1，因为等式两边减去1').status_code, 409)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_transport_failure_can_retry_the_same_submission_without_duplicate_results(self):
        self.error = httpx.ConnectError('offline')
        self.assertEqual(self.submit('x=1，因为两边减去1').status_code, 503)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.error = None
        result = self.submit('x=1，因为两边减去1')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()['is_correct'])
        request_count = len(self.requests)
        self.assertTrue(self.submit('x=1，因为两边减去1').json()['is_correct'])
        self.assertEqual(len(self.requests), request_count)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 1)

    def test_failed_final_commit_rolls_back_both_log_and_counter(self):
        original = self.db.commit
        calls = []
        def committing():
            calls.append(1)
            if len(calls) == 3:  # 创建尝试、领取任务已提交；最终日志/计数事务故障。
                self.db.flush()
                raise RuntimeError('simulated commit failure')
            original()
        with patch.object(self.db, 'commit', side_effect=committing):
            with self.assertRaises(RuntimeError):
                self.submit('x=1，因为等式两边减去1')
        self.db.rollback()
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)
        self.assertEqual(self.db.get(NoteEntryModel, 'entry').review_count, 0)

    def test_reason_transport_failure_keeps_reason_and_retries_same_revision(self):
        self.submit()
        self.error = httpx.ConnectError('offline')
        self.assertEqual(self.explain().status_code, 503)
        self.assertEqual(self.db.get(ReviewAttemptModel, self.attempt_id).explanation_text, '等式两边减去1')
        self.error = None
        final = self.explain(revision=1)
        self.assertEqual(final.status_code, 200, final.text)
        self.assertTrue(final.json()['evaluation_completed'])
        self.assertEqual(final.json()['status'], 'final')
        count = len(self.requests)
        self.assertEqual(self.explain(revision=1).json()['status'], 'final')
        self.assertEqual(len(self.requests), count)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 1)
