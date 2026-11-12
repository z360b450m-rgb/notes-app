"""Cancel through the real dialog, composable and HTTP adapter; no user database writes."""
import json
import os
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright
from test_pdf_question_import import HARNESS


def run():
    state={'cancel_calls':0,'uploads':0}
    def api(route):
        request=route.request
        path=urlparse(request.url).path
        headers={'Access-Control-Allow-Origin':'*'}
        if request.method=='OPTIONS':
            route.fulfill(status=200,headers={**headers,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'})
            return
        assert request.headers.get('authorization')=='Bearer test-token'
        if path=='/api/question-imports' and request.method=='POST':
            state['uploads']+=1
            payload={'id':f"job-{state['uploads']}",'status':'parsing','message':'正在解析测试 PDF'}
        elif path.endswith('/cancel') and request.method=='POST':
            state['cancel_calls']+=1
            if state['cancel_calls']==1:
                route.fulfill(status=503,content_type='application/json',headers=headers,
                              body=json.dumps({'detail':'停止解析暂未确认，请重试取消。'},ensure_ascii=False))
                return
            payload={'status':'cancelled'}
        elif request.method=='GET' and '/draft' not in path:
            payload={'id':path.rsplit('/',1)[-1],'status':'parsing','message':'正在解析测试 PDF'}
        else:
            raise AssertionError(f'Unexpected write or draft request: {request.method} {path}')
        route.fulfill(content_type='application/json',headers=headers,body=json.dumps(payload,ensure_ascii=False))

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.getenv('PLAYWRIGHT_CHANNEL','msedge'))
        try:
            context=browser.new_context(viewport={'width':1100,'height':900},service_workers='block')
            context.route('http://localhost:8000/**',api)
            context.route('**/pdf-import-harness',lambda route:route.fulfill(content_type='text/html',body=HARNESS))
            context.add_init_script("localStorage.setItem('notes_app_access_token','test-token')")
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto('http://127.0.0.1:5173/pdf-import-harness')
            page.wait_for_function('window.ready')
            page.locator('input[type=file]').set_input_files({'name':'fixture.pdf','mimeType':'application/pdf','buffer':b'%PDF-fixture'})
            page.get_by_role('button',name='提交 PDF',exact=True).click()
            expect(page.get_by_text('正在解析测试 PDF',exact=True)).to_be_visible()
            cancel=page.get_by_role('button',name='取消',exact=True)
            expect(cancel).to_be_enabled()
            page.evaluate('test.feature.pdfImportConfirming.value=true')
            expect(cancel).to_be_disabled()
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog')).to_be_visible()
            page.evaluate('test.feature.pdfImportConfirming.value=false')
            expect(cancel).to_be_enabled()
            cancel.click()
            expect(page.get_by_role('alert')).to_contain_text('停止解析暂未确认')
            expect(cancel).to_be_enabled()
            cancel.click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert state['cancel_calls']==2
            assert page.evaluate('test.feature.pdfImportDraft.value') is None

            page.evaluate('test.feature.handleOpenPdfImport()')
            page.locator('input[type=file]').set_input_files({'name':'fixture.pdf','mimeType':'application/pdf','buffer':b'%PDF-fixture'})
            page.get_by_role('button',name='提交 PDF',exact=True).click()
            expect(page.get_by_text('正在解析测试 PDF',exact=True)).to_be_visible()
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert state['cancel_calls']==3

            # Cancel before the upload reply: obtain the identifier, then cancel that job.
            page.evaluate('''async () => {
                test.feature.handleOpenPdfImport();
                const task=test.feature.handleSubmitPdfImport(new File(['%PDF-fixture'],'fixture.pdf'));
                await test.feature.handleClosePdfImport();
                await task;
            }''')
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert state['uploads']==3 and state['cancel_calls']==4
            assert not errors,errors
            print('PASS: cancel button, retry after cancellation failure, Esc, upload cancellation race, confirmation protection')
        finally:
            browser.close()


if __name__=='__main__':run()
