"""Background parsing keeps the PDF preview and navigates to the original notebook."""
import json
import os
import re
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from test_pdf_question_import import HARNESS, PNG, fixture


BACKGROUND_HARNESS = HARNESS.replace(
    "import Dialog from '/src/components/PdfImportDialog.vue';",
    """import Dialog from '/src/components/PdfImportDialog.vue';
import TaskCenter from '/src/components/BackgroundTaskCenter.vue';
import {createBackgroundTasks,backgroundTasksKey} from '/src/composables/useBackgroundTasks.ts';""",
).replace(
    '{createApp,h,ref}', '{createApp,h,ref,provide}',
).replace(
    "const book=ref('book-a');let reloads=0;",
    "const tasks=createBackgroundTasks();provide(backgroundTasksKey,tasks);const book=ref('book-a');let reloads=0;",
).replace(
    'activeNotebookId:book,',
    "tasks,openNotebook:async(id)=>{window.openedNotebook=id},activeNotebookId:book,",
).replace(
    'return()=>feature.showPdfImport.value?h(Dialog,{',
    'return()=>[(feature.showPdfImport.value||feature.pdfImportLoading.value||feature.pdfImportDraft.value||feature.pdfImportResult.value)?h(Dialog,{visible:feature.showPdfImport.value,onBackground:feature.handleBackgroundPdfImport,',
).replace('}):null;', '}):null,h(TaskCenter)];')


def run():
    job = dict(id='job', notebook_id='book-a', filename='fixture.pdf', status='ready_for_review',
               revision=1, message='解析完成', draft=fixture())
    state = {'ready': False, 'committed': False, 'cancelled': 0, 'keys': []}

    def api(route):
        request = route.request
        path = urlparse(request.url).path
        headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                   'Access-Control-Allow-Methods': '*'}
        if request.method == 'OPTIONS':
            route.fulfill(headers=headers)
            return
        if '/assets/' in path:
            route.fulfill(headers=headers, content_type='image/png', body=PNG)
            return
        if path == '/api/question-imports' and request.method == 'POST':
            assert 'book-a' in (request.post_data_buffer or b'').decode(errors='replace')
            payload = {'id': 'job', 'status': 'parsing', 'message': '正在解析测试 PDF'}
        elif path.endswith('/cancel'):
            state['cancelled'] += 1
            payload = {'status': 'cancelled'}
        elif request.method == 'PATCH':
            job['revision'] += 1
            payload = job
        elif path.endswith('/confirm'):
            state['keys'] = request.post_data_json['question_keys']
            state['committed'] = True
            payload = {'status': 'completed', 'importedCount': len(state['keys'])}
        elif path.endswith('/draft'):
            payload = job
        else:
            payload = {'id': 'job', 'status': 'committed' if state['committed'] else
                       'ready_for_review' if state['ready'] else 'parsing', 'message': '正在解析测试 PDF'}
        route.fulfill(headers=headers, content_type='application/json', body=json.dumps(payload))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            page = browser.new_page(viewport={'width': 1100, 'height': 900})
            page.set_default_timeout(10000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('http://localhost:8000/**', api)
            page.route('**/pdf-background-harness', lambda route: route.fulfill(
                content_type='text/html', body=BACKGROUND_HARNESS))
            page.add_init_script("localStorage.setItem('notes_app_access_token','test-token')")
            page.goto('http://127.0.0.1:5173/pdf-background-harness')
            page.wait_for_function('window.ready')
            page.locator('input[type=file]').set_input_files(
                {'name': 'fixture.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-fixture'})
            page.get_by_role('button', name='提交 PDF', exact=True).click()
            expect(page.get_by_role('progressbar', name='PDF 识别进度')).to_be_visible()
            page.get_by_role('button', name='后台运行', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.evaluate("test.book.value='book-b'")
            state['ready'] = True
            center = page.get_by_label('后台任务', exact=True)
            expect(center).to_contain_text('识别完成，待校对')
            center.get_by_role('button', name='去校对题目').click()
            expect(page.get_by_test_id('pdf-import-preview')).to_be_visible()
            source = page.get_by_role('link', name='查看原 PDF')
            assert source.get_attribute('href').startswith('blob:')
            page.get_by_role('checkbox', name=re.compile(r'^第\s*2\s*题$')).uncheck()
            page.get_by_role('checkbox', name=re.compile('我已对照原 PDF')).check()
            # Hiding and restoring the preview preserves the user's selection and source PDF.
            page.evaluate('test.feature.handleBackgroundPdfImport()')
            page.evaluate('test.feature.handleOpenPdfImport()')
            expect(page.get_by_role('checkbox', name=re.compile(r'^第\s*2\s*题$'))).not_to_be_checked()
            expect(source).to_be_visible()
            page.get_by_test_id('pdf-import-confirm').click()
            expect(center).to_contain_text('导入完成')
            center.get_by_role('button', name='查看错题本').click()
            page.wait_for_function("window.openedNotebook==='book-a'")
            assert len(state['keys']) == 4 and state['cancelled'] == 0
            assert not errors, errors
            print('PASS: background parsing, completion action, preserved preview and selection, original notebook navigation')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
