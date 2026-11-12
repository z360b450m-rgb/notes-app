import json
import unittest
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
from src.db_sql.routers.review_insights import selected_candidate
from src.db_sql.review_bundle import source_fingerprint


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        for owner in ('alice','bob'):
            self.db.add(UserModel(id=owner,email=owner+'@example.test',hashed_password='unused'))
            self.db.add(NotebookModel(id=owner,user_id=owner,name='数学'))
        self.db.add(NotebookModel(id='other',user_id='alice',name='另一错题本'))
        self.db.flush()
        tag = TagModel(id='equation',name='方程')
        for ident,owner,book in [('anchor','alice','alice'),('related','alice','alice'),('transfer','alice','alice'),
                                 ('unrelated','alice','alice'),('other','alice','other'),('secret','bob','bob')]:
            self.db.add(NoteEntryModel(id=ident,user_id=owner,notebook_id=book,title=ident,
                question='计算正方形面积' if ident=='unrelated' else '解方程 x+1=2',
                correct_answer='4' if ident=='unrelated' else 'x=1',review_count=0,tags=[tag] if ident!='unrelated' else [],next_review_date=9999999999999))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda:self.db
        app.dependency_overrides[get_current_user] = lambda:SimpleNamespace(id='alice')
        patch('src.db_sql.routers.review_candidates.prediction_context',return_value=(None,None,'model_missing')).start()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.rows = ['anchor','related','transfer']
        self.mutate = lambda result:result
        self.status = 200
        self.requests = []
        original = httpx.AsyncClient
        def transport(request):
            self.requests.append(request)
            return httpx.Response(self.status,json=self.mutate(self.upstream()))
        patch('src.db_sql.review_bundle.httpx.AsyncClient',side_effect=lambda **kw:
            original(transport=httpx.MockTransport(transport),**kw)).start()

    def upstream(self):
        items = []
        for ident in self.rows:
            owner = 'bob' if ident=='secret' else 'alice'
            row,_ = selected_candidate(self.db,owner,ident)
            items.append(dict(entry_id=ident,notebook_id=row['notebook_id'],title=row['title'],question_preview=row['question'][:120],
                subject=row['subject'],knowledge_points=row['tags'],estimated_seconds=row['estimated_seconds'],source_fingerprint=source_fingerprint(row),
                relation={'relation':'anchor' if ident=='anchor' else 'same_concept','reason':'当前题' if ident=='anchor' else '同一方程求解方法',
                    'anchor_evidence':[] if ident=='anchor' else ['解方程'],'candidate_evidence':[] if ident=='anchor' else ['解方程']},
                importance={'importance':'ordinary','evidence':['解方程'],'reason':'单项练习'}))
        return dict(anchor_entry_id='anchor',notebook_id='alice',items=items,relation_status='complete',importance_status='complete',
                    related_count=len(items)-1,ranking_pool_count=4,candidate_truncated=False,as_of='2026-10-13T10:00:00+08:00',bundle_version='related-review-v1')

    def prepare(self, entry='anchor', **body):
        return self.client.post(f'/api/entries/{entry}/review-bundle',json=body,headers={'Authorization':'Bearer token'})

    def confirm(self, token, entry='anchor', **body):
        return self.client.post(f'/api/entries/{entry}/review-bundle/confirm',json={'proposal_token':token,**body})

    def test_prepare_then_confirm_exact_group_is_read_only(self):
        self.db.add(ReviewLogModel(id='wrong',entry_id='transfer',timestamp=1,quality='forgot',is_correct=False))
        self.db.add(ReviewLogModel(id='right',entry_id='related',timestamp=1,quality='mastered',is_correct=True))
        self.db.commit()
        response = self.prepare()
        self.assertEqual(response.status_code,200,response.text)
        result = response.json()
        self.assertEqual([row['entry_id'] for row in result['items']],['anchor','transfer','related'])
        self.assertEqual(result['estimated_seconds'],900)
        self.assertNotIn('correct_answer',json.dumps(result))
        confirmed = self.confirm(result['proposal_token'])
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        self.assertEqual(confirmed.json()['entry_ids'],['anchor','transfer','related'])
        self.assertEqual(self.confirm(result['proposal_token']).status_code,200)
        self.assertEqual(self.db.query(ReviewLogModel).count(),2)
        self.assertEqual(self.db.get(NoteEntryModel,'anchor').review_count,0)
        self.assertEqual(self.requests[0].headers['authorization'],'Bearer token')
        self.assertEqual(json.loads(self.requests[0].content)['limit'],10)

    def test_signatures_scope_expiry_and_unknown_fields(self):
        token = self.prepare().json()['proposal_token']
        self.assertEqual(self.confirm(token[:-1]+('0' if token[-1]!='0' else '1')).status_code,422)
        self.assertEqual(self.confirm(token,entry='related').status_code,422)
        self.assertEqual(self.confirm(token,entry_ids=['secret']).status_code,422)
        expires = __import__('time').time()+1000
        with patch('src.db_sql.review_bundle.time.time',return_value=expires):
            self.assertEqual(self.confirm(token).status_code,409)
        self.assertEqual(self.prepare(user_id='bob').status_code,422)
        self.assertEqual(self.prepare(limit=100).status_code,422)
        self.assertEqual(self.prepare(limit=3).status_code,422)

    def test_recalled_questions_can_be_confirmed_without_claiming_verified_relation(self):
        self.rows=['anchor','related','transfer','unrelated']
        def recalled(result):
            item=result['items'][-1]
            item['relation']={'relation':'recalled','reason':'召回补充题，关联尚未确认',
                              'anchor_evidence':[],'candidate_evidence':[]}
            item['importance']={'importance':'unknown','reason':'未评估','evidence':[]}
            result['related_count']=2
            return result
        self.mutate=recalled
        result=self.prepare()
        self.assertEqual(result.status_code,200,result.text)
        bundle=result.json()
        self.assertEqual(len(bundle['items']),4)
        self.assertTrue(any('召回补充题' in notice for notice in bundle['notices']))
        confirmed=self.confirm(bundle['proposal_token'])
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        self.assertEqual(confirmed.json()['entry_ids'],[item['entry_id'] for item in bundle['items']])
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)
        def false_recalled(result):
            result=recalled(result)
            result['items'][-1]['relation']['anchor_evidence']=['未核验']
            return result
        self.mutate=false_recalled
        self.assertEqual(self.prepare().status_code,502)

    def test_random_supplement_reason_notice_and_confirmation_are_preserved(self):
        def random_supplement(result):
            result['items'][1]['relation']={'relation':'recalled',
                'reason':'随机补充：从当前错题本随机抽取，尚未确认与原题的知识点关联',
                'anchor_evidence':[],'candidate_evidence':[]}
            result['related_count']=1
            return result
        self.mutate=random_supplement
        response=self.prepare()
        self.assertEqual(response.status_code,200,response.text)
        bundle=response.json()
        self.assertTrue(any('随机补题' in notice for notice in bundle['notices']))
        self.assertTrue(any(item['relation']['reason'].startswith('随机补充：') for item in bundle['items']))
        confirmed=self.confirm(bundle['proposal_token'])
        self.assertEqual(confirmed.status_code,200,confirmed.text)
        self.assertEqual(confirmed.json()['entry_ids'],[item['entry_id'] for item in bundle['items']])

    def test_modified_or_deleted_question_requires_new_proposal(self):
        token = self.prepare().json()['proposal_token']
        self.db.get(NoteEntryModel,'related').question='题干已修改'
        self.db.commit()
        self.assertEqual(self.confirm(token).status_code,409)
        self.db.delete(self.db.get(NoteEntryModel,'transfer'))
        self.db.commit()
        self.assertEqual(self.confirm(token).status_code,404)

    def test_upstream_scope_duplicate_and_false_relation_quotes_fail_closed(self):
        for rows in (['anchor','secret'],['anchor','other'],['anchor','anchor'],['related']):
            self.rows = rows
            self.assertIn(self.prepare().status_code,(404,502))
        self.rows = ['anchor','related']
        def false_quote(result):
            result['items'][1]['relation']['anchor_evidence']=['未提供的知识点']
            return result
        self.mutate = false_quote
        self.assertEqual(self.prepare().status_code,502)
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)

    def test_recall_uses_current_owned_notebook_all_schedule_and_tags(self):
        response = self.client.post('/api/review-agent/related-candidates',json={'anchor_entry_id':'anchor','concepts':[],'limit':50})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual({row['id'] for row in response.json()['items']},{'anchor','related','transfer'})
        self.assertTrue(all(row['due_status']=='future' for row in response.json()['items']))
        self.assertEqual(self.client.post('/api/review-agent/related-candidates',json={'anchor_entry_id':'secret'}).status_code,404)

    def test_semantic_recall_diagnostics_are_validated_and_shown_in_preview(self):
        def diagnostics(result):
            result['retrieval']={'strategy':'semantic-v2','status':'complete','candidate_count':3,'hydrated_count':3,
                'channels':['stem','structure','graph'],'graph_available':True,'warnings':[]}
            return result
        self.mutate=diagnostics
        response=self.prepare()
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()
        self.assertEqual(result['retrieval']['channels'],['stem','structure','graph'])
        self.assertTrue(any('召回 3 道候选题' in notice for notice in result['notices']))

    def test_anchor_only_notice_and_login(self):
        self.rows=['anchor']
        result=self.prepare().json()
        self.assertEqual(len(result['items']),1)
        self.assertTrue(result['notices'])
        self.assertEqual(self.prepare(entry='secret').status_code,404)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.prepare().status_code,401)
        self.assertEqual(self.confirm(result['proposal_token']).status_code,401)
