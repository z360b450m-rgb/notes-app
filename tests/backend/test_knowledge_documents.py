"""Library uploads proxy to persistent indexing; no browser body or local asset storage."""
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch, MagicMock

import httpx
from fastapi.testclient import TestClient
from src.db_sql.auth import get_current_user
from src.db_sql.main import app
from src.db_sql.routers import knowledge_documents as api
from src.db_sql.database import get_db


class KnowledgeDocumentTests(TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.requests = []
        self.upstream = httpx.Response(202, json={'id': 'library', 'status': 'processing'})
        original = httpx.AsyncClient
        def transport(request):
            self.requests.append(request)
            return self.upstream
        patch.object(api.httpx, 'AsyncClient', side_effect=lambda **kwargs:
            original(transport=httpx.MockTransport(transport), **kwargs)).start()

    def test_markdown_upload_forwards_file_and_login_to_persistent_pipeline(self):
        result = self.client.post('/api/knowledge/documents/import',
            files={'file': ('lecture.md', b'# Growth rate', 'text/markdown')},
            headers={'Authorization': 'Bearer test-token'})
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()['status'], 'processing')
        self.assertEqual(self.requests[0].url.path, '/knowledge/libraries/import')
        self.assertEqual(self.requests[0].headers['Authorization'], 'Bearer test-token')
        self.assertIn(b'# Growth rate', self.requests[0].content)
        self.assertNotIn('content', result.json())

    def test_library_metadata_and_archive_use_server_routes(self):
        self.upstream = httpx.Response(200, json={'items': [{'id': 'server-library', 'name': 'Lecture'}]})
        response = self.client.get('/api/knowledge/documents', headers={'Authorization': 'Bearer token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].url.path, '/knowledge/libraries')
        ident = '12345678-1234-4234-8234-123456789abc'
        self.upstream = httpx.Response(200, json={'id': ident, 'archived': True})
        response = self.client.patch('/api/knowledge/documents/' + ident,
            json={'name': 'Lecture', 'description': '', 'archived': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.requests[-1].content)['archived'], True)

    def test_failure_does_not_return_success_or_parser_contents(self):
        self.upstream = httpx.Response(503, json={'detail': '存储服务不可用'})
        response = self.client.post('/api/knowledge/documents/import', files={'file': ('book.pdf', b'%PDF')})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], '存储服务不可用')

    def test_requires_login(self):
        app.dependency_overrides.clear()
        self.assertEqual(self.client.get('/api/knowledge/documents').status_code, 401)
        self.assertEqual(self.client.post('/api/knowledge/documents/import',
            files={'file': ('learning.pdf', b'%PDF')}).status_code, 401)
        self.assertEqual(self.requests, [])

    def test_reserve_scoped_upload_cancel_and_delete_forward_to_same_library(self):
        ident = '12345678-1234-4234-8234-123456789abc'
        db = MagicMock()
        app.dependency_overrides[get_db] = lambda: db
        header = {'Authorization': 'Bearer test-token'}
        response = self.client.post('/api/knowledge/documents/import/reserve',
            json={'name': 'Lecture', 'description': ''}, headers=header)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.requests[-1].url.path, '/knowledge/libraries/import/reserve')
        response = self.client.post(f'/api/knowledge/documents/{ident}/import',
            files={'file': ('book.md', b'# test')}, headers=header)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.requests[-1].url.path, f'/knowledge/libraries/{ident}/import')
        response = self.client.post(f'/api/knowledge/documents/{ident}/cancel', headers=header)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.requests[-1].url.path, f'/knowledge/libraries/{ident}/cancel')
        response = self.client.delete(f'/api/knowledge/documents/{ident}', headers=header)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.requests[-1].method, 'DELETE')
        self.assertEqual(self.requests[-1].headers['Authorization'], 'Bearer test-token')
        db.query.return_value.filter_by.assert_called_once_with(user_id='alice', kb_id=ident)
        db.commit.assert_called_once()

    def test_cancel_delete_authentication_and_upstream_not_found_are_preserved(self):
        ident = '12345678-1234-4234-8234-123456789abc'
        self.upstream = httpx.Response(404, json={'detail': '知识库不存在'})
        self.assertEqual(self.client.post(f'/api/knowledge/documents/{ident}/cancel').status_code, 404)
        db = MagicMock()
        app.dependency_overrides[get_db] = lambda: db
        self.assertEqual(self.client.delete(f'/api/knowledge/documents/{ident}').status_code, 404)
        db.query.assert_not_called()
        app.dependency_overrides.clear()
        self.assertEqual(self.client.post(f'/api/knowledge/documents/{ident}/cancel').status_code, 401)
        self.assertEqual(self.client.delete(f'/api/knowledge/documents/{ident}').status_code, 401)
