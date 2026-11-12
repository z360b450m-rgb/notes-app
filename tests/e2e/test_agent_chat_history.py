"""Verify chat gestures, renaming and coordinated remote/local deletion."""

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    root = Path(__file__).resolve().parents[2]

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root / 'dist')))
    Thread(target=server.serve_forever, daemon=True).start()
    user = {'id': 'chat-history-test', 'email': 'history@example.test', 'full_name': 'Test',
            'is_active': True, 'created_at': 1}
    first_id = '6c94303d-4a34-49f2-ad7e-f3b29d5c6500'
    second_id = '7c94303d-4a34-49f2-ad7e-f3b29d5c6500'
    key = 'review-agent-chats-v1:chat-history-test'
    chats = [{'id': ident, 'title': title, 'updatedAt': 1000 + index, 'messages': [
        {'role': 'user', 'text': f'{title}的问题'}, {'role': 'assistant', 'text': f'{title}的回答'}]}
        for index, (ident, title) in enumerate([(first_id, '数学复习'), (second_id, '英语复习')])]
    deletes = []
    queries = []
    fail_delete = False

    def api(route):
        path = urlparse(route.request.url).path
        result, status = {'items': []}, 200
        if path == '/api/users/me':
            result = user
        elif path == '/health':
            result = {'status': 'ok'}
        elif path.startswith('/api/review-agent/history/'):
            assert route.request.method == 'DELETE'
            assert route.request.headers['authorization'] == 'Bearer test-token'
            deletes.append(path.rsplit('/', 1)[-1])
            if fail_delete:
                result, status = {'detail': '智能体聊天记录删除失败，记录已保留，请稍后重试'}, 502
            else:
                result = {'deleted_count': 2}
        elif path == '/api/review-agent/query':
            queries.append(route.request.post_data_json)
            result = {'answer': '新的回答'}
        route.fulfill(status=status, content_type='application/json', body=json.dumps(result))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL'))
        try:
            for mobile in (False, True):
                deletes.clear()
                queries.clear()
                fail_delete = False
                context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 900},
                                              has_touch=mobile, is_mobile=mobile)
                context.route('http://localhost:8000/**', api)
                context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
                context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
                context.add_init_script(f"""
                    localStorage.setItem('notes_app_access_token', 'test-token');
                    localStorage.setItem('notes_app_current_user', {json.dumps(json.dumps(user))});
                    if (!localStorage.getItem({json.dumps(key)})) localStorage.setItem(
                        {json.dumps(key)}, {json.dumps(json.dumps({'chats': chats, 'activeId': first_id}))});
                """)
                page = context.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='domcontentloaded')

                def enter():
                    page.get_by_role('button', name='开始复习', exact=True).click()
                    expect(page.get_by_label('复习 Agent', exact=True)).to_be_visible()

                def saved():
                    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)

                def row(title):
                    return page.locator('.agent-history-item').filter(
                        has=page.get_by_role('button', name=f'聊天操作：{title}', exact=True))

                def swipe(title, dx):
                    item = row(title)
                    item.scroll_into_view_if_needed()
                    bounds = item.locator('.agent-history-content').bounding_box()
                    item_bounds = item.bounding_box()
                    left = max(bounds['x'], item_bounds['x'])
                    right = min(bounds['x'] + bounds['width'], item_bounds['x'] + item_bounds['width'])
                    x, y = (left + 12 if dx > 0 else right - 40), bounds['y'] + 25
                    if mobile:
                        session = context.new_cdp_session(page)
                        session.send('Input.dispatchTouchEvent', {'type': 'touchStart',
                                     'touchPoints': [{'x': x, 'y': y}]})
                        for step in range(1, 13):
                            session.send('Input.dispatchTouchEvent', {'type': 'touchMove',
                                         'touchPoints': [{'x': x + dx * step / 12, 'y': y}]})
                        session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
                        session.detach()
                    else:
                        page.mouse.move(x, y)
                        page.mouse.down()
                        page.mouse.move(x + dx, y, steps=12)
                        page.mouse.up()

                enter()
                expect(page.get_by_text('数学复习的回答', exact=True)).to_be_visible()
                # Swiping must reveal actions without selecting the inactive chat.
                swipe('英语复习', -120)
                expect(row('英语复习')).to_have_class('agent-history-item relative min-w-0 shrink-0 overflow-hidden rounded-xl is-expanded')
                expect(row('英语复习').get_by_role('button', name='删除聊天：英语复习')).to_be_visible()
                expect(row('英语复习').locator('.agent-history-content')).to_have_css(
                    'transform', 'matrix(1, 0, 0, 1, -132, 0)')
                assert saved()['activeId'] == first_id
                screenshot = root / '.dev-services' / f'chat-history-{"mobile" if mobile else "desktop"}.png'
                page.screenshot(path=str(screenshot), full_page=True)
                swipe('英语复习', 120)
                expect(row('英语复习').get_by_role('button', name='聊天操作：英语复习')).to_have_attribute('aria-expanded', 'false')
                toggle = row('英语复习').get_by_role('button', name='聊天操作：英语复习')
                toggle.click()
                expect(toggle).to_have_attribute('aria-expanded', 'true')
                assert row('英语复习').locator('.agent-history-content').evaluate(
                    '(el) => el.style.transform') == 'translateX(-132px)'
                toggle.click()
                expect(toggle).to_have_attribute('aria-expanded', 'false')
                # One row at a time, button fallback, cancel and blank-name validation.
                row('数学复习').get_by_role('button', name='聊天操作：数学复习').click()
                row('英语复习').get_by_role('button', name='聊天操作：英语复习').click()
                expect(row('数学复习').get_by_role('button', name='聊天操作：数学复习')).to_have_attribute('aria-expanded', 'false')
                row('英语复习').get_by_role('button', name='重命名聊天：英语复习').click()
                dialog = page.get_by_role('dialog', name='重命名聊天', exact=True)
                name = dialog.get_by_role('textbox', name='聊天名称')
                name.fill('   ')
                expect(dialog.get_by_role('button', name='保存', exact=True)).to_be_disabled()
                page.keyboard.press('Escape')
                assert saved()['chats'][1]['title'] == '英语复习'
                row('英语复习').get_by_role('button', name='重命名聊天：英语复习').click()
                name.fill('  考前英语回顾  ')
                dialog.get_by_role('button', name='保存', exact=True).click()
                expect(row('考前英语回顾')).to_be_visible()
                assert saved()['chats'][1]['id'] == second_id
                assert saved()['chats'][1]['title'] == '考前英语回顾'
                assert not queries and not deletes
                page.reload(wait_until='domcontentloaded')
                enter()
                expect(row('考前英语回顾')).to_be_visible()
                # Inactive deletion preserves the active conversation and its draft.
                prompt = page.get_by_role('textbox', name='你的复习目标')
                prompt.fill('保留这段草稿')
                row('考前英语回顾').get_by_role('button', name='聊天操作：考前英语回顾').click()
                row('考前英语回顾').get_by_role('button', name='删除聊天：考前英语回顾').click()
                delete_dialog = page.get_by_role('dialog', name='删除聊天', exact=True)
                delete_dialog.get_by_role('button', name='取消', exact=True).click()
                assert not deletes
                row('考前英语回顾').get_by_role('button', name='删除聊天：考前英语回顾').click()
                delete_dialog.get_by_role('button', name='确认删除', exact=True).click()
                expect(row('考前英语回顾')).to_have_count(0)
                assert deletes == [second_id]
                assert saved()['activeId'] == first_id
                expect(prompt).to_have_value('保留这段草稿')
                # Failed remote deletion retains local history; retry removes both.
                fail_delete = True
                row('数学复习').get_by_role('button', name='聊天操作：数学复习').click()
                row('数学复习').get_by_role('button', name='删除聊天：数学复习').click()
                delete_dialog.get_by_role('button', name='确认删除', exact=True).click()
                expect(delete_dialog.get_by_role('alert')).to_contain_text('已保留')
                assert len(saved()['chats']) == 1
                assert saved()['activeId'] == first_id
                fail_delete = False
                delete_dialog.get_by_role('button', name='确认删除', exact=True).click()
                expect(page.get_by_role('heading', name='今天，从哪里开始？')).to_be_visible()
                assert saved()['chats'] == [] and saved()['activeId'] is None
                expect(prompt).to_have_value('')
                assert deletes == [second_id, first_id, first_id]
                page.reload(wait_until='domcontentloaded')
                enter()
                expect(page.locator('.agent-history-item')).to_have_count(0)
                prompt.fill('删除之后的新对话')
                prompt.press('Enter')
                expect(page.get_by_text('新的回答', exact=True)).to_be_visible()
                assert queries[-1]['session_id'] not in (first_id, second_id)
                # Dark theme still exposes both controls at phone/desktop widths.
                page.evaluate("document.documentElement.classList.add('dark')")
                row('删除之后的新对话').get_by_role('button', name='聊天操作：删除之后的新对话').click()
                expect(row('删除之后的新对话').locator('.agent-history-content')).to_have_css(
                    'transform', 'matrix(1, 0, 0, 1, -132, 0)')
                page.screenshot(path=str(screenshot.with_stem(screenshot.stem + '-dark')), full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                context.close()
                print(f'PASS: {"touch/mobile" if mobile else "mouse/desktop"} gestures, rename persistence, '
                      'cancel, remote deletion, failure/retry, active/draft handling and fresh session')
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    run()
