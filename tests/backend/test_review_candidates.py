"""复习候选口径、排序、范围隔离和只读行为。"""
import unittest
from unittest.mock import patch
import os
import json
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.database import Base, get_db
from src.db_sql.auth import get_current_user
from src.db_sql.main import app
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, ReviewLogModel, TagModel
from src.db_sql.routers.review_candidates import ReviewFilter, compute_candidates, LOCAL_TZ
from src.db_sql.routers import review_candidates as module
from src.db_sql.review_risk import Model,History,identity,feature_key
from src.db_sql.review_risk_data import load_events


class ReviewCandidatesTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(app.dependency_overrides.clear)
        self.now = datetime(2026, 10, 13, 10, tzinfo=LOCAL_TZ)
        self.ms = int(self.now.timestamp() * 1000)
        for owner in ('alice', 'bob'):
            self.db.add(UserModel(id=owner, email=owner+'@example.test', hashed_password='unused'))
            self.db.add(NotebookModel(id=owner, user_id=owner, name='数学本'))
        self.db.flush()
        self.add('overdue', next_review_date=self.ms-2*86400000, review_count=3, mastery_level=0)
        self.add('today', next_review_date=int(self.now.replace(hour=23).timestamp()*1000), review_count=3, mastery_level=0)
        self.add('future', next_review_date=int(self.now.replace(day=14, hour=0).timestamp()*1000))
        self.add('unreviewed', next_review_date=None)
        self.add('secret', owner='bob', question='其他账号秘密')
        self.db.commit()

    def add(self, ident, owner='alice', **overrides):
        args = dict(id=ident, user_id=owner, notebook_id=owner, title=ident,
                    subject='数学', question='解方程 x+1=2', correct_answer='x=1',
                    created_at=self.ms, mastery_level=0, review_count=0)
        args.update(overrides)
        row = NoteEntryModel(**args)
        self.db.add(row)
        return row

    def log(self, ident, entry, correct, timestamp=None):
        self.db.add(ReviewLogModel(id=ident, entry_id=entry, is_correct=correct,
            quality='forgot', timestamp=self.ms-100 if timestamp is None else timestamp))
        self.db.commit()

    def get(self, **filters):
        return compute_candidates(self.db, 'alice', ReviewFilter(**filters), self.now)

    def test_today_uses_schedule_not_creation_and_excludes_tomorrow(self):
        result = self.get()
        self.assertEqual({row['id'] for row in result['items']}, {'overdue', 'today', 'unreviewed'})
        self.assertEqual(result['items'][0]['due_status'], 'overdue')
        self.assertNotIn('secret', str(result))
        self.assertEqual(self.get(scope='all')['total_count'], 4)

    def test_unknown_future_and_old_correctness_have_distinct_meanings(self):
        self.log('no', 'today', False)
        self.log('yes', 'today', True)
        self.log('unknown', 'today', None)
        self.log('future-log', 'today', False, self.ms+100)
        self.log('old-no', 'today', False, self.ms-31*86400000)
        row = next(item for item in self.get()['items'] if item['id'] == 'today')
        self.assertEqual((row['incorrect_count'], row['judged_count']), (2, 3))
        self.assertEqual((row['recent_incorrect_count'], row['recent_judged_count']), (1, 2))
        self.assertEqual(row['score_components']['recent_error_rate'], 7.5)

    def test_rank_before_limit_instead_of_recent_entry_sampling(self):
        for index in range(5):
            self.log(str(index), 'today', False)
        result = self.get(limit=1)
        self.assertEqual(result['items'][0]['id'], 'today')
        self.assertEqual(result['total_count'], 3)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['items'][0]['score_components']['repeated_errors'], 25)

    def test_tag_and_text_match_are_distinguished_and_wildcards_literal(self):
        self.db.get(NoteEntryModel, 'overdue').tags = [TagModel(id='tag', name='方程')]
        self.db.commit()
        rows = self.get(knowledge_point='方程')['items']
        self.assertEqual(next(row for row in rows if row['id'] == 'overdue')['match_basis'], 'exact_tag')
        self.assertEqual(next(row for row in rows if row['id'] == 'today')['match_basis'], 'text_mention')
        self.assertEqual(self.get(knowledge_point='%')['total_count'], 0)
        self.assertEqual(self.get(knowledge_point='几何')['total_count'], 0)

    def test_scope_and_selected_ids_are_revalidated(self):
        for filters in ({'notebook_ids': ['bob']}, {'entry_ids': ['secret']}, {'entry_ids': ['deleted']}):
            with self.assertRaises(HTTPException):
                self.get(**filters)
        self.assertEqual(self.get(scope='all', entry_ids=['future'])['items'][0]['id'], 'future')

    def test_trained_risk_ranks_all_candidates_before_limiting(self):
        tag = TagModel(id='risk-tag',name='方程')
        self.db.get(NoteEntryModel,'today').tags = [tag]
        self.db.get(NoteEntryModel,'overdue').tags = [tag]
        self.db.commit()
        model = Model(0.0,{feature_key('item',identity('today')):4.0},('方程',),
            (identity('alice'),),self.ms-10000,'test',True,{'activation_gate_passed':True})
        with patch.object(module,'prediction_context',return_value=(model,History([]),None)):
            result = self.get(limit=1)
        self.assertEqual(result['items'][0]['id'],'today')
        self.assertEqual(result['items'][0]['risk']['source'],'das3h')
        self.assertEqual(result['ranking_version'],'review-v2')

    def test_ranking_scans_past_first_database_batch(self):
        for index in range(205):
            self.add(f'new-{index:03}')
        self.add('z-last')
        self.db.commit()
        for index in range(5):
            self.log(f'last-error-{index}','z-last',False)
        result = self.get(limit=1)
        self.assertEqual(result['items'][0]['id'],'z-last')
        self.assertEqual(result['total_count'],209)

    def test_history_reader_excludes_unknown_future_and_other_users(self):
        self.log('yes','today',True)
        self.log('unknown','today',None)
        self.log('future','today',False,self.ms+1)
        self.log('secret','secret',False)
        events = load_events(self.db,['alice'],self.ms,['方程'])
        self.assertEqual([event.event_id for event in events],['yes'])
        self.assertEqual(events[0].user,identity('alice'))
        self.assertEqual(events[0].skills,())

    def test_fallback_and_duration_are_explicit(self):
        self.log('wrong','today',False)
        row = self.db.get(ReviewLogModel,'wrong')
        row.elapsed_ms = 123000
        self.db.commit()
        with patch.object(module,'prediction_context',return_value=(None,None,'model_missing')):
            item = next(row for row in self.get()['items'] if row['id'] == 'today')
        self.assertAlmostEqual(item['risk']['probability'],2/3)
        self.assertEqual(item['risk']['source'],'beta_binomial')
        self.assertEqual(item['estimated_seconds'],123)
        self.assertEqual(item['time_estimate_source'],'history_median')

    def test_configured_model_loads_into_api_and_corruption_falls_back(self):
        self.db.get(NoteEntryModel,'today').tags = [TagModel(id='model-tag',name='方程')]
        self.db.commit()
        model = Model(0.0,{feature_key('item',identity('today')):4.0},('方程',),
            (identity('alice'),),self.ms-10000,'test-file',True,{'activation_gate_passed':True})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'model.json'
            path.write_text(json.dumps(model.to_dict()),encoding='utf-8')
            with patch.dict(os.environ,{'REVIEW_RISK_MODEL_PATH':str(path)}):
                item = next(row for row in self.get()['items'] if row['id'] == 'today')
                self.assertEqual(item['risk']['model_version'],'test-file')
                self.assertEqual(item['risk']['source'],'das3h')
                path.write_text('{}',encoding='utf-8')
                item = next(row for row in self.get()['items'] if row['id'] == 'today')
                self.assertEqual(item['risk']['source'],'beta_binomial')
                self.assertEqual(item['risk']['fallback_reason'],'model_invalid')

    def test_api_login_whitelist_readonly_and_no_owner_leak(self):
        before = self.db.query(NoteEntryModel).count()
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/review-agent/review-candidates', json={}).status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            app.dependency_overrides[get_db] = lambda: self.db
            response = client.post('/api/review-agent/review-candidates', json={'scope': 'all'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn('其他账号秘密', response.text)
            for payload in ({'sql':'SELECT 1'}, {'user_id':'bob'}, {'limit':1000}, {'scope':'tomorrow'}):
                self.assertEqual(client.post('/api/review-agent/review-candidates', json=payload).status_code, 422)
        self.assertEqual(self.db.query(NoteEntryModel).count(), before)
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_empty_related_terms_do_not_return_risk_candidates(self):
        result = module.related_candidates(module.RelatedFilter(anchor_entry_id='today'),
            SimpleNamespace(id='alice'), self.db)
        self.assertEqual(result['items'], [])
        self.assertEqual(result['total_count'], 0)

    def test_random_supplement_scans_whole_notebook_and_excludes_selected_entries(self):
        self.db.add(NotebookModel(id='other', user_id='alice', name='另一本'))
        self.db.flush()
        self.add('zz-other-book', notebook_id='other')
        for index in range(60):
            self.add(f'z-{index:02}')
        self.db.commit()
        # 固定随机排序表达式，验证抽样范围包含前50个风险候选之外的题，无概率断言。
        with patch.object(module.func, 'random', return_value=NoteEntryModel.id.desc()) as random_order:
            result = module.random_candidates(module.RandomFilter(anchor_entry_id='today',
                exclude_entry_ids=['z-59','z-59','overdue'],limit=3), SimpleNamespace(id='alice'), self.db)
        random_order.assert_called_once()
        self.assertEqual({row['id'] for row in result['items']}, {'z-58','z-57','z-56'})
        self.assertEqual(result['total_count'], 61)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['filters']['notebook_ids'], ['alice'])
        self.assertEqual(result['filters']['entry_ids'], [])
        self.assertEqual(self.db.query(ReviewLogModel).count(), 0)

    def test_random_api_auth_scope_small_and_empty_notebook(self):
        before = self.db.query(NoteEntryModel).count()
        with TestClient(app) as client:
            path='/api/review-agent/random-candidates'
            self.assertEqual(client.post(path,json={'anchor_entry_id':'today'}).status_code,401)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            app.dependency_overrides[get_db] = lambda: self.db
            response=client.post(path,json={'anchor_entry_id':'today','limit':20})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual({row['id'] for row in response.json()['items']},{'overdue','future','unreviewed'})
            response=client.post(path,json={'anchor_entry_id':'today',
                'exclude_entry_ids':['overdue','future','unreviewed']})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['items'],[])
            self.assertEqual(response.json()['total_count'],0)
            for ident in ('secret','deleted'):
                self.assertEqual(client.post(path,json={'anchor_entry_id':ident}).status_code,404)
            self.assertEqual(client.post(path,json={'anchor_entry_id':'today','user_id':'bob'}).status_code,422)
        self.assertEqual(self.db.query(NoteEntryModel).count(),before)
