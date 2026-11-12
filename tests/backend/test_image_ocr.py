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
from src.db_sql.models import UserModel, NotebookModel


class ImageOcrProxyTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        for owner in ('alice', 'bob'):
            self.db.add(UserModel(id=owner, email=owner+'@example.test', hashed_password='unused'))
            self.db.add(NotebookModel(id=owner, user_id=owner, name=owner))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='alice')
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.requests = []
        self.status, self.payload = 200, {'text': '图中文字\nA. 30', 'engine': 'mineru-ocr'}
        original = httpx.AsyncClient
        def transport(request):
            self.requests.append(request)
            return httpx.Response(self.status, json=self.payload)
        patch('src.db_sql.routers.image_ocr.httpx.AsyncClient', side_effect=lambda **kw:
              original(transport=httpx.MockTransport(transport), **kw)).start()

    def send(self, notebook='alice', data=b'png-bytes'):
        return self.client.post('/api/image-ocr', data={'notebook_id': notebook},
            files={'file': ('image.png', data, 'image/png')}, headers={'Authorization': 'Bearer user-token'})

    def test_owned_only_and_token_forwarded_without_question_writes(self):
        self.assertEqual(self.send('bob').status_code, 404)
        self.assertEqual(self.send('unknown').status_code, 404)
        self.assertEqual(len(self.requests), 0)
        self.assertEqual(self.send().json(), self.payload)
        self.assertEqual(self.requests[0].url.path, '/image-ocr')
        self.assertEqual(self.requests[0].headers['authorization'], 'Bearer user-token')
        self.assertIn(b'png-bytes', self.requests[0].content)
        self.assertFalse(self.db.in_transaction())

    def test_empty_oversize_upstream_errors_and_malformed_results(self):
        self.assertEqual(self.send(data=b'').status_code, 422)
        with patch('src.db_sql.routers.image_ocr.MAX_IMAGE_BYTES', 2):
            self.assertEqual(self.send(data=b'abc').status_code, 413)
        self.status, self.payload = 422, {'detail': '图片格式无效'}
        self.assertEqual(self.send().status_code, 422)
        self.status, self.payload = 200, {'text': ['invalid'], 'engine': 'mineru-ocr'}
        self.assertEqual(self.send().status_code, 503)


if __name__ == '__main__':
    unittest.main()
