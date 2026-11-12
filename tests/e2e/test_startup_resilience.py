"""Built-app startup with a stalled API, retry, auth expiry and cache upgrades."""

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
    state = {'mode': 'stall'}
    held_routes = []
    user = {'id': 'startup-test', 'email': 'test@example.com', 'full_name': None,
            'is_active': True, 'created_at': 1}
    notebook = {'id': 'startup-nb', 'name': '启动测试错题本', 'description': '',
                'instructions': '', 'created_at': 1, 'updated_at': 1}

    def api(route):
        path = urlparse(route.request.url).path
        if path == '/api/users/me':
            if state['mode'] == 'stall':
                held_routes.append(route)
                return  # Held until the frontend's abort signal times out.
            route.fulfill(status=401 if state['mode'] == 'expired' else 200,
                          content_type='application/json', body=json.dumps(user))
            return
        result = {'items': [notebook]} if path == '/api/notebooks' else {'items': []}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(result))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(service_workers='block')
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.route('http://localhost:8000/**', api)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate('''user => {
              localStorage.setItem('notes_app_access_token','test-token');
              localStorage.setItem('notes_app_current_user',JSON.stringify(user));
              localStorage.setItem('CuotiDB:startup-test:legacy-migrated','true');
            }''', user)
            page.reload(wait_until='domcontentloaded')
            expect(page.get_by_text('正在加载错题本…', exact=True)).to_be_visible()
            expect(page.get_by_text('连接超时，请确认后台服务已启动后重试', exact=True)).to_be_visible(timeout=8000)
            for route in held_routes:
                route.abort()
            held_routes.clear()
            assert page.evaluate("localStorage.getItem('notes_app_access_token')") == 'test-token'
            state['mode'] = 'ok'
            page.get_by_role('button', name='重新加载', exact=True).click()
            expect(page.get_by_text(notebook['name'], exact=True).first).to_be_visible()
            # Normal storage reads/writes must close their connections, so another
            # page can upgrade the cache without hanging behind idle handles.
            page.wait_for_timeout(300)
            assert page.evaluate('''() => new Promise((resolve, reject) => {
              const r=indexedDB.open('CuotiDB:startup-test',8);
              const timer=setTimeout(()=>reject(new Error('Cache upgrade stalled')),2000);
              r.onblocked=()=>{clearTimeout(timer);reject(new Error('Idle connection blocked upgrade'))};
              r.onsuccess=()=>{clearTimeout(timer);r.result.close();resolve(true)};
              r.onerror=()=>{clearTimeout(timer);reject(r.error)};
            })''')
            state['mode'] = 'expired'
            page.reload(wait_until='domcontentloaded')
            page.wait_for_function("localStorage.getItem('notes_app_access_token') === null")
            expect(page.get_by_role('button', name='登录', exact=True).last).to_be_visible()
            assert not errors, errors
            print('PASS: startup timeout/retry, retained session, expired-session logout and unblocked cache upgrade')
        finally:
            context.unroute_all(behavior='ignoreErrors')
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    run()
