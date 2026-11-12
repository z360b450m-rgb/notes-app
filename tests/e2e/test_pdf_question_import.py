"""真实上传适配器、草稿界面和确认流程；API 使用隔离替身，不写用户数据库。"""
import base64
import copy
import json
import os
from pathlib import Path
import re
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

HARNESS=r'''<html><head><meta charset="UTF-8"></head><body>
<div id="app"></div><script type="module">
import Dialog from '/src/components/PdfImportDialog.vue';
import {usePdfImport} from '/src/composables/usePdfImport.ts';
import {importQuestionsFromPdf} from '/src/services/shopkeeperPdfAdapter.ts';
import '/src/style.css';import '/src/ui-theme.css';
const source=await(await fetch('/src/components/PdfImportDialog.vue')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref}=await import(vueUrl);
const hookSource=await(await fetch('/src/composables/usePdfImport.ts')).text();
const serviceUrl=hookSource.match(/from "([^"]*\/services\/pdfImport\.ts[^"]*)"/)[1];
const {registerPdfImportHandler}=await import(serviceUrl);
registerPdfImportHandler(importQuestionsFromPdf);
createApp({setup(){
 const book=ref('book-a');let reloads=0;
 const feature=usePdfImport({activeNotebookId:book,loadEntries:async()=>{reloads++},loadNotebooks:async()=>{},showToast:()=>{}});
 window.test={book,feature,reloads:()=>reloads};feature.handleOpenPdfImport();
 return()=>feature.showPdfImport.value?h(Dialog,{
 loading:feature.pdfImportLoading.value,progress:feature.pdfImportProgress.value,error:feature.pdfImportError.value,
 result:feature.pdfImportResult.value,draft:feature.pdfImportDraft.value,confirming:feature.pdfImportConfirming.value,cancelling:feature.pdfImportCancelling.value,
 onSubmit:feature.handleSubmitPdfImport,onConfirm:feature.handleConfirmPdfImport,onReload:feature.handleReloadPdfDraft,onClose:feature.handleClosePdfImport}):null;
}}).mount('#app');window.ready=true;
</script></body></html>'''

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=')


def fixture():
    questions=[]
    for number in range(1,6):
        questions.append(dict(key=f'q{number}',source_number=str(number),title=f'第{number}题',stem=f'第{number}题原始文字题干',kind='choice',
            options=[{'key':k,'text':f'选项{k}内容'} for k in 'ABCD'],asset_keys=['own-chart'] if number==5 else [],
            group_key='g1' if number<=3 else 'g2',source_pages=[2 if number<5 else 3],
            correct_answer='',explanation='',student_answer='',answer_status='missing',
            warnings=['原文件未识别到正确答案，录入后待补充'],standalone_material_text='',standalone_asset_keys=[]))
    return {'schema_version':'pdf-question-draft-v1','page_count':4,'questions':questions,
        'groups':[dict(key='g1',title='（一）',material_text='第一份共享材料',asset_keys=['material-1'],question_keys=['q1','q2','q3'],decision='suggested',warnings=[]),
                  dict(key='g2',title='（二）',material_text='第二份共享材料',asset_keys=['material-2'],question_keys=['q4','q5'],decision='suggested',warnings=[])],
        'assets':[dict(key=k,url=f'http://localhost:8000/api/question-imports/job/assets/{k}?token=test',width=400,height=200,page_number=2) for k in ('material-1','material-2','own-chart')],
        'notices':['题目、题组和图片需校对确认；本次导入不会增加复习或答错次数。']}


def run():
    data=fixture()
    image_data={asset['key']:PNG for asset in data['assets']}
    real=os.getenv('PDF_IMPORT_SMOKE_DRAFT')
    if real:
        data=json.loads(Path(real).read_text(encoding='utf-8'))
        image_data={a['key']:base64.b64decode(a.pop('content_base64')) for a in data['assets']}
        for asset in data['assets']:
            asset['url']=f"http://localhost:8000/api/question-imports/job/assets/{asset['key']}?token=test"
        for question in data['questions']:
            question.setdefault('standalone_material_text','')
            question.setdefault('standalone_asset_keys',[])
    job=dict(id='job',notebook_id='book-a',filename='fixture.pdf',status='ready_for_review',revision=1,message='解析完成',draft=data)
    state={'polls':0,'committed':False,'commit_calls':0,'save_calls':0,'saved_keys':[], 'upload_body':''}

    def api(route):
        request=route.request
        path=urlparse(request.url).path
        headers={'Access-Control-Allow-Origin':'*'}
        if request.method=='OPTIONS':
            route.fulfill(status=200,headers={**headers,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'})
            return
        if '/assets/' in path:
            key=path.rsplit('/',1)[-1]
            route.fulfill(content_type='image/jpeg' if real else 'image/png',headers=headers,body=image_data[key])
            return
        assert request.headers.get('authorization')=='Bearer test-token'
        payload=None
        if request.method=='POST' and path=='/api/question-imports':
            state['upload_body']=(request.post_data_buffer or b'').decode('utf-8',errors='replace')
            payload={k:job[k] for k in ('id','notebook_id','filename','revision')}
            payload.update(status='uploaded',message='PDF 已上传')
        elif request.method=='GET' and path.endswith('/draft'):
            payload=job
        elif request.method=='GET':
            state['polls']+=1
            payload={k:job[k] for k in ('id','notebook_id','filename','revision')}
            payload.update(status='committed' if state['committed'] else 'parsing' if state['polls']==1 else 'ready_for_review',message='MinerU 正在解析图文' if state['polls']==1 else '解析完成')
        elif request.method=='PATCH':
            state['save_calls']+=1
            patch=request.post_data_json
            assert patch['expected_revision']==job['revision']
            assert all('asset_keys' not in row and 'review_count' not in row for row in patch['questions'])
            for edit in patch['questions']:
                question=next(q for q in data['questions'] if q['key']==edit['key'])
                old=next((g for g in data['groups'] if g['key']==question['group_key']),None)
                if old and edit['group_key'] is None:
                    question['standalone_material_text']=old['material_text']
                    question['standalone_asset_keys']=old['asset_keys']
                question.update(edit)
            job['revision']+=1
            payload=job
        elif path.endswith('/confirm'):
            state['commit_calls']+=1
            assert request.post_data_json['reviewed'] is True
            keys=request.post_data_json['question_keys']
            if not state['committed']:
                state['committed']=True
                state['saved_keys']=keys
                route.fulfill(status=503,content_type='application/json',headers=headers,
                    body=json.dumps({'detail':'确认回执暂时不可用，请重试'}))
                return
            assert keys==state['saved_keys']
            payload={'status':'completed','importedCount':len(keys)}
        else:
            raise AssertionError((request.method,path))
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
            page.locator('dialog').screenshot(path='.dev-services/pdf-import-upload.png')
            page.set_viewport_size({'width':390,'height':844})
            assert page.locator('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
            page.locator('dialog').screenshot(path='.dev-services/pdf-import-upload-mobile.png')
            page.set_viewport_size({'width':1100,'height':900})
            expect(page.get_by_role('button',name='提交 PDF',exact=True)).to_be_disabled()
            page.locator('input[type=file]').set_input_files({'name':'fixture.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.7\nfixture'})
            page.get_by_role('button',name='提交 PDF',exact=True).click()
            expect(page.get_by_text('MinerU 正在解析图文',exact=True)).to_be_visible()
            page.evaluate("test.book.value='book-b'")
            expect(page.get_by_test_id('pdf-import-preview')).to_be_visible(timeout=10000)
            assert 'book-a' in state['upload_body'] and 'book-b' not in state['upload_body']
            expect(page.get_by_test_id('pdf-import-question')).to_have_count(5)
            expect(page.get_by_test_id('pdf-import-group')).to_have_count(2)
            expect(page.get_by_label('题干',exact=True)).to_have_count(1)
            # 阻塞提示必须准确定位题目，点击确认时不能向后端提交无效选项。
            page.evaluate('''() => {
                const qs=test.feature.pdfImportDraft.value.draft.questions;
                window.savedOptions=qs.map(q=>JSON.parse(JSON.stringify(q.options)));
                qs[1].options=[];
                qs[3].options=[{key:'A',text:'one'},{key:'A',text:''}];
            }''')
            issues=page.get_by_test_id('pdf-import-issue')
            expect(issues).to_have_count(2)
            expect(issues.first).to_contain_text('原第 2 题 · PDF 第 2 页')
            expect(issues.first).to_contain_text('0 个文字选项')
            expect(issues.nth(1)).to_contain_text('选项字母重复：A')
            expect(issues.nth(1)).to_contain_text('选项内容为空：A')
            issues.nth(1).click()
            expect(page.get_by_label('题干',exact=True)).to_have_value(data['questions'][3]['stem'])
            page.get_by_role('checkbox',name=re.compile('我已对照原 PDF')).check()
            page.get_by_test_id('pdf-import-confirm').click()
            expect(page.get_by_label('题干',exact=True)).to_have_value(data['questions'][1]['stem'])
            assert state['save_calls']==0 and state['commit_calls']==0
            page.evaluate('''() => {
                const qs=test.feature.pdfImportDraft.value.draft.questions;
                qs[1].options=window.savedOptions[1];qs[3].options=window.savedOptions[3];
                qs[4].option_mode='image';qs[4].options=[];
            }''')
            expect(issues).to_have_count(0)
            page.get_by_role('navigation',name='选择校对题目').get_by_role('button').nth(4).click()
            expect(page.get_by_test_id('pdf-image-options')).to_contain_text('无需补填文字选项')
            expect(page.get_by_role('button',name='＋ 补充选项',exact=True)).to_have_count(0)
            page.evaluate('''() => {
                const q=test.feature.pdfImportDraft.value.draft.questions[4];
                q.options=window.savedOptions[4];delete q.option_mode;
            }''')
            page.get_by_role('navigation',name='选择校对题目').get_by_role('button').first.click()
            page.get_by_role('checkbox',name=re.compile('我已对照原 PDF')).uncheck()
            expect(page.get_by_role('button',name='上一题',exact=True)).to_be_disabled()
            page.get_by_role('button',name='下一题',exact=True).click()
            expect(page.get_by_label('题干',exact=True)).to_have_value(data['questions'][1]['stem'])
            page.get_by_role('button',name='上一题',exact=True).click()
            page.get_by_test_id('pdf-import-group').first.click()
            expect(page.get_by_label('公共材料文字',exact=True)).to_have_value(data['groups'][0]['material_text'])
            page.locator('dialog').screenshot(path='.dev-services/pdf-import-material.png')
            page.get_by_role('button',name='第 1 题 →',exact=True).click()
            page.wait_for_function("Array.from(document.querySelectorAll('dialog img')).every(img=>img.complete&&img.naturalWidth>0)")
            assert not state['committed']
            confirm=page.get_by_test_id('pdf-import-confirm')
            expect(confirm).to_be_disabled()
            page.locator('dialog').screenshot(path='.dev-services/pdf-import-preview.png')
            def check_layout():
                assert page.locator('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
                assert confirm.is_visible()
                assert confirm.evaluate('''el => {
                    const rect = el.getBoundingClientRect();
                    const dialog = el.closest('dialog').getBoundingClientRect();
                    return rect.bottom <= dialog.bottom && rect.top >= dialog.top;
                }'''), 'Confirm action must remain inside the visible dialog'
                page.locator('.pdf-editor').evaluate('el => el.scrollTop = el.scrollHeight')
                assert confirm.is_visible()
                assert page.get_by_role('heading',name='导入 PDF 错题',exact=True).is_visible()
                page.locator('.pdf-editor').evaluate('el => el.scrollTop = 0')
            check_layout()
            page.set_viewport_size({'width':390,'height':844})
            page.evaluate("document.documentElement.classList.add('dark')")
            check_layout()
            page.locator('dialog').screenshot(path='.dev-services/pdf-import-preview-mobile-dark.png')
            page.set_viewport_size({'width':1100,'height':900})
            page.evaluate("document.documentElement.classList.remove('dark')")
            reviewed=page.get_by_role('checkbox',name=re.compile('我已对照原 PDF'))
            reviewed.check()
            page.get_by_role('button',name='重新加载草稿',exact=True).click()
            expect(reviewed).not_to_be_checked()
            expect(confirm).to_be_disabled()
            page.get_by_label('题干',exact=True).first.fill('已校对的第一题题干')
            page.get_by_role('navigation',name='选择校对题目').get_by_role('button').nth(4).click()
            page.get_by_label('第5题公共材料',exact=True).select_option(label='独立题（保留已有材料）')
            page.get_by_role('navigation',name='选择校对题目').get_by_role('button').first.click()
            expect(page.get_by_label('题干',exact=True)).to_have_value('已校对的第一题题干')
            select_all=page.get_by_role('checkbox',name='全选',exact=True)
            select_all.uncheck()
            expect(confirm).to_have_text('确认录入 0 道题目')
            expect(confirm).to_be_disabled()
            select_all.check()
            page.get_by_role('checkbox',name=re.compile(r'^第\s*2\s*题$')).uncheck()
            page.get_by_role('checkbox',name=re.compile('我已对照原 PDF')).check()
            expect(confirm).to_have_text('确认录入 4 道题目')
            confirm.click()
            expect(page.get_by_role('alert')).to_contain_text('确认回执暂时不可用')
            assert state['committed'] and state['saved_keys']==['q1','q3','q4','q5']
            assert data['questions'][0]['stem']=='已校对的第一题题干'
            assert data['questions'][4]['standalone_material_text']
            confirm.click()
            expect(page.get_by_text('已保存 4 道题目。',exact=True)).to_be_visible()
            assert state['save_calls']==1 and state['commit_calls']==2
            assert page.evaluate('test.reloads()')==1
            page.get_by_role('button',name='关闭',exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            assert not errors,errors
            print('PASS: registered HTTP adapter, frozen notebook, text/figures/groups preview, edits, selected commit, lost receipt retry and list refresh')
        finally:
            browser.close()


if __name__=='__main__':run()
