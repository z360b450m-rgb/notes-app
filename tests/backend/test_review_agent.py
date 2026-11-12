"""Exercise the adapter's real HTTP serialization without calling a model."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from src.db_sql.auth import get_current_user
from src.db_sql.main import app


class ReviewAgentTests(unittest.TestCase):
    session_id = "6c94303d-4a34-49f2-ad7e-f3b29d5c6500"

    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(app.dependency_overrides.clear)
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="alice")
        self.requests = []
        self.upstream = httpx.Response(200, json={"answer": "真实助手回复"})
        self.error = None
        self.stream_response = httpx.Response(200, text=(
            'event: summary\ndata: {"text":"正在检索"}\n\n'
            'event: delta\ndata: {"delta":"部分回答"}\n\n'
            'event: final\ndata: {"answer":"部分回答"}\n\n'
        ), headers={'content-type': 'text/event-stream'})

        def transport(request):
            self.requests.append(request)
            if self.error:
                raise self.error
            if request.url.path.startswith('/stream/'):
                return self.stream_response
            return self.upstream

        client_class = httpx.AsyncClient
        self.mock = patch(
            "src.db_sql.routers.review_agent.httpx.AsyncClient",
            side_effect=lambda **kwargs: client_class(transport=httpx.MockTransport(transport), **kwargs),
        ).start()
        self.addCleanup(patch.stopall)

    def query(self, **overrides):
        return self.client.post("/api/review-agent/query", json={
            "query": "  帮我复习  ", "session_id": self.session_id, **overrides,
            "is_stream": overrides.get('is_stream', False),
        })

    def test_forwards_existing_contract_and_returns_answer(self):
        import json
        with patch.dict("os.environ", {"RAG_AGENT_URL": "http://127.0.0.1:8001/"}):
            response = self.query()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"session_id": self.session_id, "answer": "真实助手回复"})
        self.assertEqual(str(self.requests[0].url), "http://127.0.0.1:8001/query")
        body = json.loads(self.requests[0].content)
        self.assertEqual(body["query"], "帮我复习")
        self.assertIs(body["is_stream"], False)
        self.assertEqual(set(body), {"query", "session_id", "is_stream"})
        self.assertNotIn("authorization", self.requests[0].headers)

    def test_forwards_verified_login_token_for_stats(self):
        response = self.client.post('/api/review-agent/query', json={
            'query': '有多少道错题', 'session_id': self.session_id, 'is_stream': False,
        }, headers={'Authorization': 'Bearer login-token'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].headers['authorization'], 'Bearer login-token')

    def test_selected_library_id_is_forwarded_without_browser_document_content(self):
        import json
        kb = '12345678-1234-4234-8234-123456789abc'
        response = self.query(query='根据讲义解释增长率', kb_ids=[kb])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(json.loads(self.requests[0].content)['kb_ids'], [kb])
        self.assertNotIn('knowledge_documents', json.loads(self.requests[0].content))
        self.assertEqual(len(self.requests), 1, 'Must not require a wrong-entry catalog/index request')

    def test_document_snapshots_must_belong_to_selection_and_be_unique(self):
        kb = '12345678-1234-4234-8234-123456789abc'
        document = {'id': kb, 'name': '讲义', 'content': '知识点'}
        for arguments in ({'kb_ids': [], 'knowledge_documents': [document]},
                          {'kb_ids': [kb], 'knowledge_documents': [document, document]}):
            self.assertEqual(self.query(**arguments).status_code, 422)
        self.assertEqual(self.requests, [])

    def test_sessions_are_stable_and_isolated_by_authenticated_user(self):
        import json
        self.query()
        self.query()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="bob")
        self.query()
        sessions = [json.loads(request.content)["session_id"] for request in self.requests]
        self.assertEqual(sessions[0], sessions[1])
        self.assertNotEqual(sessions[0], sessions[2])

    def test_stream_forwards_summary_delta_and_final(self):
        import json
        self.upstream = httpx.Response(200, json={'task_id': 'stream-task'})
        response = self.query(is_stream=True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('text/event-stream', response.headers['content-type'])
        self.assertEqual(response.headers['x-accel-buffering'], 'no')
        self.assertIn('event: summary', response.text)
        self.assertIn('event: delta', response.text)
        self.assertIn('event: final', response.text)
        self.assertIs(json.loads(self.requests[0].content)['is_stream'], True)
        self.assertEqual(self.requests[1].url.path, '/stream/stream-task')

    def test_stream_read_failure_is_an_error_event(self):
        self.upstream = httpx.Response(200, json={'task_id': 'stream-task'})
        self.stream_response = httpx.Response(503, text='private failure')
        response = self.query(is_stream=True)
        self.assertIn('event: error', response.text)
        self.assertNotIn('private failure', response.text)

    def test_proxy_yields_before_upstream_finishes(self):
        import asyncio
        from src.db_sql.routers.review_agent import forward_agent_stream

        class DelayedStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'event: delta\ndata: {"delta":"first"}\n\n'
                await asyncio.sleep(10)
                yield b'event: final\ndata: {"answer":"first"}\n\n'

        self.stream_response = httpx.Response(200, stream=DelayedStream())

        async def check():
            stream = forward_agent_stream('http://test-upstream', 'task', 30)
            try:
                first = await asyncio.wait_for(anext(stream), timeout=1)
                self.assertIn(b'event: delta', first)
            finally:
                await stream.aclose()

        asyncio.run(check())

    def test_requires_login_and_rejects_invalid_requests(self):
        for overrides in ({"query": " "}, {"query": "x" * 2001}, {"session_id": "invalid"}):
            self.assertEqual(self.query(**overrides).status_code, 422)
        app.dependency_overrides.clear()
        self.assertEqual(self.query().status_code, 401)
        self.assertEqual(self.requests, [])

    def test_unavailable_and_timeout_are_actionable(self):
        for error, status in ((httpx.ConnectError("offline"), 503), (httpx.ReadTimeout("slow"), 504)):
            self.error = error
            response = self.query()
            self.assertEqual(response.status_code, status, response.text)
            self.assertTrue(response.json()["detail"])

    def test_bad_upstream_responses_are_rejected(self):
        for upstream in (httpx.Response(500, json={"detail": "private failure details"}),
                         httpx.Response(200, text="not json"),
                         httpx.Response(200, json={"answer": ""})):
            self.upstream = upstream
            response = self.query()
            self.assertEqual(response.status_code, 502, response.text)
            self.assertNotIn("private failure", response.text)

    def test_delete_history_uses_query_identity_and_forwards_token(self):
        import json
        self.query()
        session = json.loads(self.requests[-1].content)['session_id']
        self.upstream = httpx.Response(200, json={'deleted_count': 4})
        response = self.client.delete(f'/api/review-agent/history/{self.session_id}',
                                      headers={'Authorization': 'Bearer login-token'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'session_id': self.session_id, 'deleted_count': 4})
        request = self.requests[-1]
        self.assertEqual(request.method, 'DELETE')
        self.assertEqual(request.url.path, f'/history/{session}')
        self.assertEqual(request.headers['authorization'], 'Bearer login-token')

    def test_delete_history_is_isolated_by_user_and_idempotent(self):
        self.upstream = httpx.Response(200, json={'deleted_count': 0})
        url = f'/api/review-agent/history/{self.session_id}'
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 200)
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='bob')
        self.assertEqual(self.client.delete(url).status_code, 200)
        paths = [request.url.path for request in self.requests]
        self.assertEqual(paths[0], paths[1])
        self.assertNotEqual(paths[0], paths[2])

    def test_delete_history_requires_login_and_valid_uuid(self):
        self.assertEqual(self.client.delete('/api/review-agent/history/invalid').status_code, 422)
        app.dependency_overrides.clear()
        self.assertEqual(self.client.delete(f'/api/review-agent/history/{self.session_id}').status_code, 401)
        self.assertEqual(self.requests, [])

    def test_delete_history_reports_unavailable_and_timeout(self):
        for error, status in ((httpx.ConnectError('offline'), 503), (httpx.ReadTimeout('slow'), 504)):
            self.error = error
            response = self.client.delete(f'/api/review-agent/history/{self.session_id}')
            self.assertEqual(response.status_code, status)
            self.assertIn('已保留', response.json()['detail'])

    def test_delete_history_rejects_unconfirmed_or_failed_deletion(self):
        for upstream in (httpx.Response(500, text='private failure'),
                         httpx.Response(200, text='not json'),
                         httpx.Response(200, json={}),
                         httpx.Response(200, json={'deleted_count': True}),
                         httpx.Response(200, json={'deleted_count': -1})):
            self.upstream = upstream
            response = self.client.delete(f'/api/review-agent/history/{self.session_id}')
            self.assertEqual(response.status_code, 502, response.text)
            self.assertNotIn('private failure', response.text)

    def test_title_forwards_scoped_session_and_token(self):
        import json
        from src.db_sql.routers.review_agent import agent_session_id
        from uuid import UUID
        self.upstream = httpx.Response(200, json={'title': ' 分式方程学习 '})
        url = f'/api/review-agent/history/{self.session_id}/title'
        response = self.client.post(url, headers={'Authorization': 'Bearer valid'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'title': '分式方程学习'})
        request = self.requests[-1]
        self.assertEqual(request.url.path, '/chat-title')
        self.assertEqual(request.headers['authorization'], 'Bearer valid')
        self.assertEqual(json.loads(request.content),
                         {'session_id': agent_session_id('alice', UUID(self.session_id))})
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='bob')
        self.client.post(url)
        self.assertNotEqual(json.loads(self.requests[-1].content), json.loads(request.content))

    def test_title_requires_login_and_valid_uuid(self):
        self.assertEqual(self.client.post('/api/review-agent/history/invalid/title').status_code, 422)
        app.dependency_overrides.clear()
        self.assertEqual(self.client.post(f'/api/review-agent/history/{self.session_id}/title').status_code, 401)
        self.assertEqual(self.requests, [])

    def test_title_rejects_bad_upstream_data_and_outages(self):
        url = f'/api/review-agent/history/{self.session_id}/title'
        for result in ({}, {'title': ''}, {'title': ' '}, {'title': 'x' * 33}, {'title': 'x\ny'}):
            self.upstream = httpx.Response(200, json=result)
            self.assertEqual(self.client.post(url).status_code, 503)
        self.error = httpx.ReadTimeout('private failure')
        response = self.client.post(url)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private failure', response.text)
