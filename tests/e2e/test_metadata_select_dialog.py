"""Dropdown options in a native modal must be painted and interactive above it."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    # The regression concerns modal stacking; screenshots use fallback fonts offline.
    os.environ['PW_TEST_SCREENSHOT_NO_FONTS_READY'] = '1'
    root = Path(__file__).resolve().parents[2]

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root / 'dist')))
    Thread(target=server.serve_forever, daemon=True).start()
    user = {'id': 'select-dialog-test', 'email': 'select@test.local', 'full_name': 'Test',
            'is_active': True, 'created_at': 1}
    libraries = [{'id': '12345678-1234-4234-8234-123456789abc', 'name': '数学知识库',
                  'description': '', 'status': 'empty', 'archived': False, 'updatedAt': 1},
                 {'id': '87654321-1234-4234-8234-123456789abc', 'name': '语文知识库',
                  'description': '', 'status': 'empty', 'archived': False, 'updatedAt': 1}]
    submissions = []

    def api(route):
        path = urlparse(route.request.url).path
        data = {'items': []}
        if path == '/health':
            data = {'status': 'ok'}
        elif path == '/api/users/me':
            data = user
        elif path == '/api/knowledge/notebooks':
            data = {'items': [{'id': 'book', 'name': '设计展示', 'deleted': False},
                              {'id': 'other-book', 'name': '数学错题本', 'deleted': False}], 'indexes': []}
        elif path == '/api/knowledge/documents':
            data = {'items': libraries}
        elif path == '/api/knowledge/ingest':
            submissions.append(route.request.post_data_json)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
            try:
                for viewport in ({'width': 1280, 'height': 900}, {'width': 390, 'height': 844}):
                    context = browser.new_context(viewport=viewport)
                    context.route('http://localhost:8000/**', api)
                    context.route('https://**', lambda route: route.abort())
                    context.add_init_script(f"""
                        localStorage.setItem('notes_app_access_token', 'test-token');
                        localStorage.setItem('notes_app_current_user', {json.dumps(json.dumps(user))});
                        localStorage.setItem('review-knowledge-libraries-v1:select-dialog-test',
                            {json.dumps(json.dumps(libraries))});
                    """)
                    page = context.new_page()
                    page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='domcontentloaded')
                    page.get_by_role('button', name='开始复习', exact=True).click()
                    assert page.evaluate("localStorage.getItem('review-knowledge-libraries-v1:select-dialog-test')") is None
                    prompt = page.get_by_role('textbox', name='你的复习目标')
                    prompt.fill('关闭管理后继续这个复习目标')
                    page.get_by_role('button', name='知识库管理').click()
                    dialog = page.get_by_role('dialog')
                    expect(dialog).to_be_visible()
                    # Native dialog padding targets the dialog itself, just like its backdrop.
                    dialog.click(position={'x': 4, 'y': 4})
                    expect(dialog).to_be_visible()
                    source = dialog.get_by_role('combobox', name='入库来源错题本')
                    expect(source).to_contain_text('设计展示')
                    source.click()
                    option = page.get_by_role('option', name='数学错题本', exact=True)
                    expect(option).to_be_visible()
                    assert option.evaluate('''element => {
                        const rect = element.getBoundingClientRect();
                        const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        return element.contains(painted);
                    }'''), 'Option is covered by the native modal despite being present in the DOM'
                    option.click(timeout=3000)
                    expect(source).to_contain_text('数学错题本')
                    expect(page.get_by_role('listbox')).to_have_count(0)
                    source.focus()
                    page.keyboard.press('ArrowDown')
                    expect(page.get_by_role('listbox')).to_be_visible()
                    expect(page.get_by_role('option', name='数学错题本', exact=True)).to_be_focused()
                    page.keyboard.press('Home')
                    expect(page.get_by_role('option', name='设计展示', exact=True)).to_be_focused()
                    page.keyboard.press('Enter')
                    expect(source).to_contain_text('设计展示')
                    target = dialog.get_by_role('combobox', name='入库目标知识库')
                    target.click()
                    page.get_by_role('option', name='语文知识库', exact=True).click(timeout=3000)
                    expect(target).to_contain_text('语文知识库')
                    source.click()
                    page.keyboard.press('Escape')
                    expect(dialog).to_be_visible()
                    expect(page.get_by_role('listbox')).to_have_count(0)
                    expect(source).to_be_focused()
                    assert submissions == [], 'Changing source/library must not trigger ingestion'
                    source.click()
                    expect(page.get_by_role('listbox')).to_be_visible()
                    page.screenshot(path=str(root / '.dev-services' / f'metadata-select-dialog-{viewport["width"]}.png'),
                                    animations='disabled')
                    page.keyboard.press('Escape')
                    expect(dialog).to_be_visible()
                    # Releasing a drag outside the dialog must not dismiss it.
                    expect(page.get_by_role('listbox')).to_have_count(0)
                    bounds = dialog.bounding_box()
                    page.mouse.move(bounds['x'] + 4, bounds['y'] + 4)
                    page.mouse.down()
                    page.mouse.move(2, 2)
                    page.mouse.up()
                    expect(dialog).to_be_visible()
                    page.mouse.click(2, 2)
                    expect(dialog).to_have_count(0)
                    expect(prompt).to_have_value('关闭管理后继续这个复习目标')
                    page.get_by_role('button', name='知识库管理').click()
                    expect(dialog).to_be_visible()
                    page.keyboard.press('Escape')
                    expect(dialog).to_have_count(0)
                    page.get_by_role('button', name='知识库管理').click()
                    page.get_by_role('button', name='关闭知识库').click()
                    expect(dialog).to_have_count(0)
                    expect(prompt).to_have_value('关闭管理后继续这个复习目标')
                    context.close()
                print('PASS: modal padding/drag safety, dropdowns, explicit dismissal and preserved review on desktop/mobile')
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
