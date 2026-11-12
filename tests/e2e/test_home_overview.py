"""Built home page: one aggregate request, no question requests, correct UI and plan."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(
        SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parents[2] / 'dist')))
    Thread(target=server.serve_forever, daemon=True).start()
    user = dict(id='overview-test', email='overview@example.test', full_name=None, is_active=True, created_at=1)
    books = [dict(id=f'n{i}', name=f'统计测试{i}', description='', instructions='',
                  created_at=1, updated_at=1) for i in range(12)]
    overview = dict(items=[dict(notebookId=book['id'], entryCount=100 + i,
                               dueCount=10 + i, reviewedToday=i) for i, book in enumerate(books)],
                    subjects=[dict(name='数学', count=1266)],
                    reviewDays=[dict(timestamp=1791734400000 + i * 86400000, count=i) for i in range(7)])
    requests = []
    state = {'offline': False, 'local_seeded': False}

    def api(route):
        path = urlparse(route.request.url).path
        requests.append((route.request.method, path))
        if path == '/api/users/me':
            result = user
        elif path == '/api/notebooks':
            result = dict(items=books)
        elif path in ['/api/knowledge/documents', '/api/knowledge/notebooks']:
            result = dict(items=[])
        elif path == '/api/notebooks/overview':
            if state['offline']:
                route.abort()
                return
            payload = route.request.post_data_json
            assert len(payload['notebook_ids']) == 12
            assert payload['entries'] == [] and payload['reviews'] == []
            if state['local_seeded']:
                assert payload['local_entries'][0]['id'] == 'local-only'
                assert payload['local_reviews'][0]['id'] == 'local-log'
                assert 'BODY-SENTINEL' not in route.request.post_data
                assert 'ANSWER-SENTINEL' not in route.request.post_data
            result = overview
        else:
            raise AssertionError(f'Home must not read question or review detail: {path}')
        route.fulfill(status=200, content_type='application/json', body=json.dumps(result))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        context = browser.new_context(service_workers='block', viewport={'width': 1600, 'height': 1000})
        try:
            context.add_init_script('''
                localStorage.setItem('notes_app_access_token','test-token');
                localStorage.setItem('notes_app_current_user',%s);
                localStorage.setItem('CuotiDB:overview-test:legacy-migrated','true');
            ''' % json.dumps(json.dumps(user)))
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.route('http://localhost:8000/**', api)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/app/')
            expect(page.get_by_text('1266', exact=True)).to_be_visible()
            expect(page.get_by_text('66/252', exact=True)).to_be_visible()
            expect(page.get_by_text('100 题 · 0/10', exact=True)).to_be_visible()
            expect(page.get_by_text('111 题 · 11/32', exact=True)).to_be_visible()
            expect(page.get_by_test_id('notebook-stats-status')).to_have_count(0)
            assert requests.count(('POST', '/api/notebooks/overview')) == 1, requests
            page.get_by_role('button', name='复习计划', exact=True).click()
            expect(page.get_by_text('近 7 天复习', exact=True)).to_be_visible()
            expect(page.get_by_text('数学', exact=True)).to_be_visible()
            assert requests.count(('POST', '/api/notebooks/overview')) == 1, requests
            page.evaluate('''() => new Promise((resolve, reject) => {
                const request = indexedDB.open('CuotiDB:overview-test', 7);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const database = request.result;
                    const tx = database.transaction(['entrySummaries','reviewLogs'], 'readwrite');
                    tx.objectStore('entrySummaries').put({id:'local-only', notebookId:'n0',
                        subject:'英语', nextReviewDate:Date.now()-1, updatedAt:2, question:'BODY-SENTINEL'});
                    tx.objectStore('reviewLogs').put({id:'local-log', entryId:'local-only',
                        timestamp:Date.now(), answerText:'ANSWER-SENTINEL'});
                    tx.oncomplete = () => { database.close(); resolve(true) };
                    tx.onerror = () => reject(tx.error);
                };
            })''')
            state['local_seeded'] = True
            page.reload()
            expect(page.get_by_text('1266', exact=True)).to_be_visible()
            state['offline'] = True
            page.reload()
            expect(page.get_by_text('1266', exact=True)).to_be_visible()
            expect(page.get_by_test_id('notebook-stats-status')).to_contain_text('当前显示缓存或本地统计')
            state['offline'] = False
            page.get_by_role('button', name='重新读取统计', exact=True).click()
            expect(page.get_by_test_id('notebook-stats-status')).to_have_count(0)
            assert not errors, errors
            print('PASS: 12 notebooks, one aggregate request, correct home/plan, cached offline counts and retry, zero entry/log requests')
        finally:
            context.unroute_all(behavior='ignoreErrors')
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    run()
