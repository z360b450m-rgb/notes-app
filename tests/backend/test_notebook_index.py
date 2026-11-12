"""手动触发、快照、增删改、失败重试和知识库隔离。"""
import json
import unittest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.db_sql.database import Base, get_db
from src.db_sql.auth import get_current_user
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, QuestionGroupModel, NotebookIndexModel
from src.db_sql.main import app
from src.db_sql import crud, notebook_index


class NotebookIndexTests(unittest.TestCase):
    kb = '12345678-1234-4234-8234-123456789abc'

    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)
        with self.sessions() as db:
            db.add_all([UserModel(id=owner, email=owner+'@test.local', hashed_password='unused')
                        for owner in ('alice', 'bob')])
            db.flush()
            db.add(NotebookModel(id='book', name='数学本', user_id='alice'))
            db.flush()
            db.add(QuestionGroupModel(id='group', notebook_id='book', material='公共材料'))
            db.flush()
            db.add_all([NoteEntryModel(id=key, user_id='alice', notebook_id='book', question='题目'+key,
                                      title=key, group_id='group') for key in ('a', 'b')])
            db.commit()
        self.calls = []
        self.summary_calls = []
        self.summary_fail = False
        self.fail = False
        def transport(request):
            if request.url.path.endswith('/summary'):
                self.summary_calls.append(str(request.url))
                return httpx.Response(503 if self.summary_fail else 200, json={'description': '简短简介'})
            self.calls.append(json.loads(request.content))
            return httpx.Response(503 if self.fail else 200, json={'status': 'completed'})
        client_class = httpx.Client
        patch.object(notebook_index.httpx, 'Client', side_effect=lambda **kwargs:
                     client_class(transport=httpx.MockTransport(transport), **kwargs)).start()

    def execute(self, remove=False, kb=None):
        with self.sessions() as db:
            row = notebook_index.prepare_index(db, 'alice', kb or self.kb, 'book', remove)
            index_id, task_id = row.id, row.task_id
        notebook_index.run_index(index_id, task_id, self.sessions)
        with self.sessions() as db:
            return notebook_index.serialize_index(db.get(NotebookIndexModel, index_id))

    def test_crud_does_not_create_index_or_call_rag(self):
        with self.sessions() as db:
            crud.update_entry(db, 'a', {'question': '修改但尚未执行'}, user_id='alice')
            self.assertEqual(db.query(NotebookIndexModel).count(), 0)
        self.assertEqual(self.calls, [])

    def test_one_summary_per_batch_including_unchanged_import(self):
        self.execute()
        self.assertEqual(len(self.summary_calls), 1)
        self.execute()
        self.assertEqual(len(self.summary_calls), 2)

    def test_summary_failure_does_not_fail_indexing(self):
        self.summary_fail = True
        result = self.execute()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['indexed_count'], 2)

    def test_remove_one_index_preserves_source_other_library_and_allows_explicit_reimport(self):
        from src.db_sql.routers import knowledge_documents as api
        other_kb = '22345678-1234-4234-8234-123456789abc'
        self.execute()
        self.execute(kb=other_kb)
        with self.sessions() as db:
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            with TestClient(app) as client, patch.object(api, 'forward', new_callable=AsyncMock) as forward:
                forward.return_value = {'removed': True, 'entry_id': 'a', 'notebook_id': 'book'}
                response = client.delete(f'/api/knowledge/documents/{self.kb}/entries/book/a',
                                         headers={'Authorization': 'Bearer token'})
                self.assertEqual(response.status_code, 200, response.text)
                forward.assert_awaited_once_with('DELETE', f'/{self.kb}/entries/book/a', 'Bearer token')
                db.expire_all()
                row = db.query(NotebookIndexModel).filter_by(kb_id=self.kb).one()
                self.assertEqual(set(row.hashes), {'b'})
                self.assertEqual(set(db.query(NotebookIndexModel).filter_by(kb_id=other_kb).one().hashes), {'a', 'b'})
                self.assertEqual(db.query(NoteEntryModel).count(), 2)
        self.calls.clear()
        self.execute()
        self.assertEqual([item['entry_id'] for item in self.calls], ['a'])

    def test_remove_rejects_active_import_and_unconfirmed_or_failed_cleanup(self):
        from fastapi import HTTPException
        from src.db_sql.routers import knowledge_documents as api
        self.execute()
        with self.sessions() as db:
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            with TestClient(app) as client, patch.object(api, 'forward', new_callable=AsyncMock) as forward:
                row = db.query(NotebookIndexModel).filter_by(kb_id=self.kb).one()
                row.status = 'running'
                row.snapshot = {'worker_id': notebook_index.PROCESS_ID}
                db.commit()
                url = f'/api/knowledge/documents/{self.kb}/entries/book/a'
                self.assertEqual(client.delete(url).status_code, 409)
                forward.assert_not_awaited()
                row.status = 'completed'
                row.snapshot = {}
                db.commit()
                forward.return_value = {'removed': False}
                self.assertEqual(client.delete(url).status_code, 502)
                self.assertIn('a', row.hashes)
                forward.side_effect = HTTPException(503, 'offline')
                self.assertEqual(client.delete(url).status_code, 503)
                self.assertIn('a', row.hashes)

    def test_question_list_adds_owned_source_name_and_auth_is_required(self):
        from src.db_sql.routers import knowledge_documents as api
        self.execute()
        with self.sessions() as db:
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            with TestClient(app) as client, patch.object(api, 'forward', new_callable=AsyncMock) as forward:
                forward.return_value = {'items': [{'entry_id': 'a', 'notebook_id': 'book'}], 'total': 1}
                url = f'/api/knowledge/documents/{self.kb}/entries'
                response = client.get(url + '?q=math&offset=20&limit=20')
                self.assertEqual(response.json()['items'][0]['notebook_name'], '数学本')
                self.assertEqual(forward.call_args.kwargs['params'], {'q': 'math', 'offset': 20, 'limit': 20})
                app.dependency_overrides.pop(get_current_user)
                self.assertEqual(client.get(url).status_code, 401)
                self.assertEqual(client.delete(url + '/book/a').status_code, 401)

    def test_first_repeat_changed_and_deleted(self):
        first = self.execute()
        self.assertEqual(first['report']['added'], 2)
        self.assertEqual(first['status'], 'completed')
        self.calls.clear()
        repeat = self.execute()
        self.assertEqual(repeat['report']['skipped'], 2)
        self.assertEqual(self.calls, [])
        with self.sessions() as db:
            crud.update_entry(db, 'a', {'question': '新内容'}, user_id='alice')
            crud.delete_entry(db, 'b', user_id='alice')
            crud.create_entry(db, notebook_id='book', title='c', question='新题', entry_id='c', user_id='alice')
        self.assertEqual(self.calls, [])
        result = self.execute()
        self.assertEqual(result['report']['updated'], 1)
        self.assertEqual(result['report']['added'], 1)
        self.assertEqual(result['report']['deleted'], 1)
        self.assertEqual(result['indexed_count'], 2)
        self.assertEqual({(item['operation'], item['entry_id']) for item in self.calls},
                         {('upsert', 'a'), ('upsert', 'c'), ('delete', 'b')})

    def test_group_changes_rebuild_children_but_review_changes_do_not(self):
        self.execute()
        self.calls.clear()
        with self.sessions() as db:
            crud.update_entry(db, 'a', {'mastery_level': 3}, user_id='alice')
        self.assertEqual(self.execute()['report']['skipped'], 2)
        with self.sessions() as db:
            db.get(QuestionGroupModel, 'group').material = '修改公共材料'
            db.commit()
        self.assertEqual(self.execute()['report']['updated'], 2)

    def test_failure_keeps_manifest_and_manual_retry(self):
        self.fail = True
        result = self.execute()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['indexed_count'], 0)
        self.assertEqual(result['report']['failed'], 2)
        self.fail = False
        self.assertEqual(self.execute()['report']['added'], 2)
        self.assertEqual(self.execute(remove=True)['report']['deleted'], 2)
        with self.sessions() as db:
            self.assertEqual(db.query(NoteEntryModel).count(), 2)

    def test_deleted_notebook_and_separate_knowledge_libraries(self):
        self.execute()
        other = self.execute(kb='abcdefab-1234-4234-8234-123456789abc')
        self.assertEqual(other['report']['added'], 2)
        self.execute(remove=True)
        with self.sessions() as db:
            self.assertEqual(db.query(NotebookIndexModel).filter_by(kb_id=other['kb_id']).first().hashes.keys(), {'a', 'b'})
            crud.delete_notebook(db, 'book', user_id='alice')
        result = self.execute(kb=other['kb_id'])
        self.assertEqual(result['report']['deleted'], 2)

    def test_snapshot_is_stable_and_busy_task_is_rejected(self):
        with self.sessions() as db:
            row = notebook_index.prepare_index(db, 'alice', self.kb, 'book')
            index_id, task_id = row.id, row.task_id
            with self.assertRaises(Exception) as error:
                notebook_index.prepare_index(db, 'alice', self.kb, 'book')
            self.assertEqual(error.exception.status_code, 409)
            crud.update_entry(db, 'a', {'question': '入库期间修改'}, user_id='alice')
        notebook_index.run_index(index_id, task_id, self.sessions)
        self.assertEqual(next(call['entry']['question'] for call in self.calls if call['entry_id'] == 'a'), '题目a')
        self.assertEqual(self.execute()['report']['updated'], 1)

    def test_api_auth_owner_and_manual_trigger(self):
        def database():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/knowledge/notebooks').status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='bob')
            self.assertEqual(client.post('/api/knowledge/ingest', json={'kb_id': self.kb, 'notebook_id': 'book'}).status_code, 404)
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
            with patch('src.db_sql.routers.notebook_index.run_index') as worker:
                response = client.post('/api/knowledge/ingest', json={'kb_id': self.kb, 'notebook_id': 'book'})
            self.assertEqual(response.status_code, 202, response.text)
            worker.assert_called_once()
            index_id = response.json()['id']
            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='bob')
            self.assertEqual(client.get('/api/knowledge/ingest/'+index_id).status_code, 404)


if __name__ == '__main__':
    unittest.main()
