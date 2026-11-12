"""Exercise the real knowledge dialog and composable with an isolated API fixture."""
import os
import json
from playwright.sync_api import expect, sync_playwright

HARNESS = '''<html><head><meta charset="UTF-8"></head><body><div id="app"></div>
<script type="module">
import Dialog from '/src/components/KnowledgeLibraryDialog.vue';
import {createKnowledgeLibraries} from '/src/composables/useKnowledgeLibraries.ts';
import TaskCenter from '/src/components/BackgroundTaskCenter.vue';
import {createBackgroundTasks,backgroundTasksKey} from '/src/composables/useBackgroundTasks.ts';
import '/src/style.css'; import '/src/ui-theme.css';
const source=await(await fetch('/src/components/KnowledgeLibraryDialog.vue')).text();
const vueUrl=source.match(/from "([^"]*\\/vue\\.js[^"]*)"/)[1];
const {createApp,h,provide}=await import(vueUrl);
createApp({setup(){const tasks=createBackgroundTasks();provide(backgroundTasksKey,tasks);
const feature=createKnowledgeLibraries(tasks); feature.libraryMode.value='insert'; window.feature=feature;
return()=>[feature.libraryMode.value?h(Dialog,{mode:feature.libraryMode.value,libraries:feature.libraries.value,selected:[],error:feature.error.value,
importing:feature.importing.value,importProgress:feature.importProgress.value,importResults:feature.importResults.value,
activeImportId:feature.activeImportId.value,actionIds:feature.actionIds.value,
focusLibraryId:feature.focusLibraryId.value,onClose:()=>{feature.libraryMode.value=null},
onImport:feature.importFiles,onCancelImport:feature.cancelImport,onDelete:feature.deleteLibrary}):null,h(TaskCenter)];}}).mount('#app'); window.ready=true;
</script></body></html>'''


def run():
    os.environ['PW_TEST_SCREENSHOT_NO_FONTS_READY'] = '1'
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            page = browser.new_page(viewport={'width': 1100, 'height': 900})
            page.add_init_script("localStorage.setItem('notes_app_access_token','test-token');localStorage.setItem('notes_app_current_user',JSON.stringify({id:'knowledge-ui-test'}));localStorage.setItem('review-knowledge-libraries-v1:knowledge-ui-test',JSON.stringify([{id:'old-local',name:'Old',content:'old-local-body'}]));localStorage.setItem('unrelated-question-fixture','keep');")
            page.route('**/knowledge-import-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            uploads = []
            metadata = None
            polls = 0
            auto_complete = False
            deletions = []
            def api(route):
                nonlocal metadata, polls
                if route.request.method == 'OPTIONS':
                    route.fulfill(headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'})
                    return
                status = 200
                path = route.request.url.split('/api/knowledge/documents')[-1]
                if route.request.method == 'POST' and path == '/import/reserve':
                    metadata = {'id':'12345678-1234-4234-8234-123456789abc','name':'学习教材','description':'',
                        'status':'uploading','stage':'等待上传文件','archived':False,'updatedAt':1,'error':'',
                        'charCount':0,'chunkCount':0,'entityCount':0,'relationCount':0,
                        'source':{'format':'pdf','fileName':'学习教材.pdf','size':20}}
                    polls = 0
                    result, status = metadata, 201
                elif route.request.method == 'POST' and path.endswith('/import'):
                    uploads.append(route.request.post_data_buffer)
                    metadata.update(status='processing',stage='MinerU 解析中')
                    result, status = metadata, 202
                elif route.request.method == 'POST' and path.endswith('/cancel'):
                    metadata.update(status='cancelling', stage='正在取消导入并清理半成品')
                    polls = 0
                    result, status = metadata, 202
                elif route.request.method == 'DELETE':
                    deletions.append(path)
                    metadata.update(status='deleting', stage='正在停止任务并删除资料')
                    polls = 0
                    result, status = metadata, 202
                else:
                    if metadata:
                        polls += 1
                        if polls >= 2 and metadata['status'] == 'cancelling':
                            metadata.update(status='cancelled', stage='已取消导入')
                        elif polls >= 2 and metadata['status'] == 'deleting':
                            metadata = None
                        elif polls >= 2 and metadata['status'] == 'processing' and auto_complete:
                            metadata.update(status='ready',stage='入库完成',charCount=2000,chunkCount=3,entityCount=8,relationCount=5)
                    result = {'items':[metadata] if metadata else []}
                route.fulfill(status=status, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                              body=json.dumps(result))
            page.route('**/api/knowledge/documents**', api)
            def notebooks(route):
                headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}
                route.fulfill(content_type='application/json', headers=headers, body='{"items":[],"indexes":[]}')
            page.route('**/api/knowledge/notebooks', notebooks)
            page.route('https://**', lambda route: route.abort())
            page.goto('http://127.0.0.1:5173/knowledge-import-harness',wait_until='domcontentloaded')
            page.wait_for_function('window.ready')
            expect(page.get_by_text('Markdown / PDF · 每个文件创建一个服务端知识库，入库完成后可检索')).to_be_visible()
            file_input = page.get_by_label('导入 Markdown 或 PDF 学习资料')
            assert '.pdf' in file_input.get_attribute('accept')
            file_input.set_input_files({'name': '学习教材.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.7\nfixture'})
            expect(page.get_by_role('progressbar', name='学习资料入库进度')).to_be_visible()
            page.get_by_role('button', name='后台运行', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            auto_complete = True
            task_center = page.get_by_label('后台任务', exact=True)
            expect(task_center).to_contain_text('入库完成', timeout=10000)
            task_center.get_by_role('button', name='查看结果').click()
            expect(page.locator('dialog')).to_contain_text('入库完成 · 3 段资料 · 8 个知识实体',timeout=10000)
            assert len(uploads) == 1
            stored = page.evaluate('feature.libraries.value[0]')
            assert stored['name'] == '学习教材'
            assert stored['status'] == 'ready' and stored['source']['format'] == 'pdf'
            assert 'content' not in stored
            assert page.evaluate("localStorage.getItem('review-knowledge-libraries-v1:knowledge-ui-test')") is None
            assert page.evaluate("localStorage.getItem('unrelated-question-fixture')") == 'keep'
            assert b'%PDF-1.7' in uploads[0]
            expect(page.get_by_text('资料保存在服务端，入库完成后可用于对话检索')).to_be_visible()
            auto_complete = False
            file_input.set_input_files([
                {'name':'待取消.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.7\ncancel'},
                {'name':'不得上传.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.7\nqueued'}])
            expect(page.locator('.knowledge-library-card').get_by_text('MinerU 解析中', exact=True)).to_be_visible()
            page.get_by_role('button', name='取消本次导入', exact=True).click()
            expect(page.locator('.knowledge-library-card')).to_contain_text('已取消导入',timeout=10000)
            page.wait_for_function('!feature.importing.value')
            assert len(uploads) == 2 and b'queued' not in uploads[-1]
            # A server task can also be cancelled after re-opening the page.
            metadata.update(status='processing',stage='正在构建图谱')
            page.reload(wait_until='domcontentloaded')
            page.wait_for_function('window.ready')
            page.get_by_role('button', name='取消导入', exact=True).click()
            expect(page.locator('.knowledge-library-card')).to_contain_text('已取消导入',timeout=10000)
            task_center.get_by_role('button', name='收起', exact=True).click()
            page.get_by_role('button', name='管理知识库', exact=True).click()
            page.get_by_role('button', name='删除', exact=True).click()
            expect(page.get_by_text('资料及检索索引将永久删除', exact=False)).to_be_visible()
            page.locator('.knowledge-library-card').get_by_role('button', name='取消', exact=True).click()
            assert not deletions
            page.get_by_role('button', name='删除', exact=True).click()
            page.locator('dialog').screenshot(path='.dev-services/knowledge-import-desktop.png')
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.locator('dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
            page.locator('dialog').screenshot(path='.dev-services/knowledge-import-mobile.png')
            page.get_by_role('button', name='确认删除', exact=True).click()
            expect(page.locator('.knowledge-library-card')).to_have_count(0,timeout=10000)
            assert len(deletions) == 1
            assert page.evaluate("localStorage.getItem('unrelated-question-fixture')") == 'keep'
            print('PASS: server import, batch cancellation, reopened task cancellation, delete confirmation/cleanup and unrelated data retained')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
