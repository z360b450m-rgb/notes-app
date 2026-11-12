"""Verify explicit ingestion UI, progress and selected-library query routing."""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright


def run():
    os.environ['PW_TEST_SCREENSHOT_NO_FONTS_READY'] = '1'
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass
    root = Path(__file__).resolve().parents[2]
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root/'dist')))
    Thread(target=server.serve_forever, daemon=True).start()
    user = {'id': 'index-test', 'email': 'index@test.local', 'full_name': 'Test', 'is_active': True, 'created_at': 1}
    kb = '12345678-1234-4234-8234-123456789abc'
    library = {'id': kb, 'name': '数学知识库', 'description': '', 'content': '方程移项要变号。', 'updatedAt': 1}
    submissions, queries = [], []
    poll_count = 0
    allow_complete = False
    latest = None
    def result(status, remove=False):
        return {'id': 'manifest', 'kb_id': kb, 'notebook_id': 'book', 'status': status, 'indexed_count': 0 if remove else 2,
                'report': {'total': 0 if remove else 2, 'added': 0 if remove else 2, 'updated': 0,
                           'deleted': 2 if remove else 0, 'skipped': 0, 'failed': 0, 'failures': [],
                           'processed': 2 if status == 'completed' else 0, 'pending': 2}}
    def api(route):
        nonlocal poll_count, latest
        path = urlparse(route.request.url).path
        data, status = {'items': []}, 200
        if path == '/health':
            data = {'status': 'ok'}
        elif path == '/api/users/me':
            data = user
        elif path == '/api/knowledge/notebooks':
            data = {'items': [{'id': 'book', 'name': '数学错题本', 'deleted': False}], 'indexes': [latest] if latest else []}
        elif path == '/api/knowledge/documents':
            data = {'items': [{**library, 'status': 'ready', 'charCount': 8, 'chunkCount': 1, 'entityCount': 2, 'relationCount': 1}]}
        elif path == '/api/knowledge/ingest':
            submissions.append(route.request.post_data_json)
            poll_count = 0
            latest = result('running', submissions[-1]['remove'])
            data, status = latest, 202
        elif path == '/api/knowledge/ingest/manifest':
            poll_count += 1
            latest = result('completed' if allow_complete and poll_count >= 2 else 'running', submissions[-1]['remove'])
            data = latest
        elif path == '/api/review-agent/query':
            queries.append(route.request.post_data_json)
            data = {'answer': '已按所选知识库回答'}
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context()
            context.route('http://localhost:8000/**', api)
            context.route('https://**', lambda route: route.abort())
            context.add_init_script(f"""
                localStorage.setItem('notes_app_access_token', 'test-token');
                localStorage.setItem('notes_app_current_user', {json.dumps(json.dumps(user))});
                localStorage.setItem('review-knowledge-libraries-v1:index-test', {json.dumps(json.dumps([library]))});
            """)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='domcontentloaded')
            page.get_by_role('button', name='开始复习', exact=True).click()
            page.get_by_role('button', name='知识库管理').click()
            dialog = page.get_by_role('dialog')
            expect(dialog.get_by_role('combobox', name='入库来源错题本')).to_contain_text('数学错题本')
            expect(dialog.get_by_role('combobox', name='入库目标知识库')).to_contain_text('数学知识库')
            assert submissions == [], 'Opening or selecting must not ingest'
            dialog.get_by_role('button', name='执行入库', exact=True).click()
            expect(dialog.get_by_role('button', name='入库中…', exact=True)).to_be_disabled()
            expect(dialog.get_by_role('progressbar', name='错题本入库进度')).to_have_attribute('value', '0')
            dialog.get_by_role('button', name='后台运行', exact=True).click()
            expect(dialog).to_have_count(0)
            page.get_by_role('button', name='首页', exact=True).click()
            expect(page.get_by_role('region', name='复习 Agent')).to_have_count(0)
            task_center = page.get_by_label('后台任务', exact=True)
            expect(task_center).to_contain_text('数学错题本 · 入库中')
            allow_complete = True
            expect(task_center).to_contain_text('数学错题本 · 入库完成', timeout=6000)
            task_center.get_by_role('button', name='查看结果').click()
            expect(dialog).to_be_visible()
            expect(dialog.get_by_role('combobox', name='入库来源错题本')).to_contain_text('数学错题本')
            expect(dialog.locator('.knowledge-index-result')).to_contain_text('入库完成', timeout=6000)
            assert submissions == [{'kb_id': kb, 'notebook_id': 'book', 'remove': False}]
            expect(dialog.get_by_text('新增 2 · 更新 0 · 删除 0 · 跳过 0 · 失败 0', exact=True)).to_be_visible()
            page.screenshot(path=str(root/'.dev-services'/'manual-index-ui.png'), full_page=True)
            dialog.get_by_role('button', name='移除该错题本索引').click()
            expect(dialog.get_by_text('新增 0 · 更新 0 · 删除 2 · 跳过 0 · 失败 0', exact=True)).to_be_visible(timeout=6000)
            # Completion notifications remain clickable while the dialog is open.
            task_center.get_by_role('button', name='查看结果').click()
            assert submissions[-1]['remove'] is True
            dialog.get_by_role('button', name='插入知识库', exact=True).click()
            dialog.get_by_role('checkbox', name='选择 数学知识库', exact=True).check()
            dialog.get_by_role('button', name='确认选择 1 个', exact=False).click()
            page.get_by_role('button', name='开始复习', exact=True).click()
            page.get_by_role('textbox', name='你的复习目标').fill('根据知识库解释方程')
            page.get_by_role('button', name='发送复习目标').click()
            expect(page.get_by_text('已按所选知识库回答', exact=True)).to_be_visible()
            assert queries[-1]['kb_ids'] == [kb]
            assert 'knowledge_documents' not in queries[-1], 'Only server library IDs should be sent'
            assert page.evaluate("localStorage.getItem('review-knowledge-libraries-v1:index-test')") is None
            expect(page.get_by_text('尚无已入库错题', exact=False)).to_have_count(0)
            assert len(queries) == 1, 'A single send must work even with no indexed wrong entries'
            page.get_by_role('textbox', name='你的复习目标').fill('你好')
            page.get_by_role('button', name='发送复习目标').click()
            expect(page.get_by_text('已按所选知识库回答', exact=True)).to_have_count(2)
            assert len(queries) == 2
            assert not errors, errors
            print('PASS: explicit ingestion still works; selected documents submit immediately without wrong-entry indexes')
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    run()
