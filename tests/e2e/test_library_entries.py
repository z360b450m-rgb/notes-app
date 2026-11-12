"""Knowledge library dialog: published questions, detail, search/paging and scoped removal. Requires Vite."""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


HARNESS = r'''<html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import Dialog from '/src/components/KnowledgeLibraryDialog.vue';
import '/src/style.css';import '/src/ui-theme.css';
const source=await(await fetch('/src/components/KnowledgeLibraryDialog.vue')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref,provide}=await import(vueUrl);
const panelSource=await(await fetch('/src/components/NotebookIngestPanel.vue')).text();
const ingestUrl=panelSource.match(/from "([^"]*\/useNotebookIngest\.ts[^"]*)"/)[1];
const {notebookIngestKey}=await import(ingestUrl);
localStorage.setItem('notes_app_access_token','test-token');
const libraries=[{id:'12345678-1234-4234-8234-123456789abc',name:'代数知识库',description:'分式方程及增根检验的学习资料。',
  status:'empty',archived:false,updatedAt:1,charCount:0,chunkCount:0,entityCount:0,relationCount:0},
  {id:'22345678-1234-4234-8234-123456789abc',name:'英语知识库',description:'手写简介',
  status:'empty',archived:false,updatedAt:1,charCount:0,chunkCount:0,entityCount:0,relationCount:0}];
window.test={refreshes:0};
createApp({setup(){
  provide(notebookIngestKey,{sources:ref([{id:'book',name:'数学练习册',deleted:false}]),indexes:ref([]),
    error:ref(''),submitting:ref(false),refresh:async()=>{},execute:async()=>{}});
  return ()=>h(Dialog,{mode:'manage',libraries,selected:[],error:'',importing:false,importProgress:'',
    importResults:[],onRefresh:()=>test.refreshes++});
}}).mount('#app');window.ready=true;
</script></body></html>'''


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            for mobile in (False, True):
                items = [dict(entry_id=f'e{i:02}', notebook_id='book', notebook_name='数学练习册',
                    title=f'代数第{i}题', subject='数学', preview=f'分式方程题干{i}', tags=['增根'], has_images=False)
                    for i in range(25)]
                mutations = []
                fail_delete = True
                context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 900},
                                               service_workers='block')
                context.route('**/library-entries-harness', lambda r: r.fulfill(content_type='text/html', body=HARNESS))

                def api(route):
                    nonlocal items
                    request = route.request
                    path = urlparse(request.url).path
                    assert request.headers['authorization'] == 'Bearer test-token'
                    status = 200
                    if path == '/api/knowledge/notebooks':
                        result = {'items': [], 'indexes': []}
                    elif request.method == 'DELETE':
                        mutations.append(path)
                        if fail_delete:
                            status, result = 503, {'detail': '错题移除未完成，请重试'}
                        else:
                            ident = path.rsplit('/', 1)[-1]
                            items = [item for item in items if item['entry_id'] != ident]
                            result = {'removed': True}
                    elif path.endswith('/entries'):
                        params = parse_qs(urlparse(request.url).query)
                        query = params.get('q', [''])[0]
                        offset = int(params.get('offset', ['0'])[0])
                        rows = [item for item in items if query in item['title']]
                        if '/22345678-' in path:
                            rows = []
                        result = {'items': rows[offset:offset+20], 'total': len(rows)}
                    else:
                        item = next(item for item in items if item['entry_id'] == path.rsplit('/', 1)[-1])
                        result = {**item, 'question': '解分式方程，检验所得的根。', 'options': ['A. 1', 'B. 2'],
                            'material': '公共材料第一行\n公共材料第二行', 'reference_answer': 'x=1，代入检验。',
                            'student_answer': 'x=2', 'images': ['javascript:window.unsafe=true']}
                    route.fulfill(status=status, content_type='application/json', body=json.dumps(result))

                context.route('http://localhost:8000/**', api)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(os.getenv('LIBRARY_TEST_URL', 'http://127.0.0.1:5174') + '/library-entries-harness')
                page.wait_for_function('window.ready')
                card = page.locator('[data-library-id="12345678-1234-4234-8234-123456789abc"]')
                expect(card.get_by_text('分式方程及增根检验的学习资料。', exact=True)).to_be_visible()
                card.get_by_role('button', name='查看错题', exact=True).click()
                panel = card.get_by_role('region', name='知识库已入库错题')
                expect(panel.get_by_text('已入库错题 · 25 道', exact=True)).to_be_visible()
                expect(panel.locator('li')).to_have_count(20)
                panel.get_by_role('button', name='下一页', exact=True).click()
                expect(panel.locator('li')).to_have_count(5)
                panel.get_by_role('button', name='上一页', exact=True).click()
                expect(panel.locator('li')).to_have_count(20)
                panel.get_by_role('textbox', name='搜索已入库错题').fill('代数第0题')
                panel.get_by_role('button', name='搜索', exact=True).click()
                expect(panel.locator('li')).to_have_count(1)
                row = panel.locator('li')
                row.get_by_role('button', name='查看题目', exact=True).click()
                expect(row.get_by_text('x=1，代入检验。', exact=True)).to_be_visible()
                expect(row.get_by_text('x=2', exact=True)).to_be_visible()
                expect(row.locator('img')).to_have_count(0)
                assert page.evaluate('window.unsafe===undefined')
                row.get_by_role('button', name='从知识库移除', exact=True).click()
                row.get_by_role('button', name='取消移除', exact=True).click()
                assert mutations == []
                row.get_by_role('button', name='从知识库移除', exact=True).click()
                row.get_by_role('button', name='确认移除', exact=True).click()
                expect(panel.get_by_role('alert')).to_have_text('错题移除未完成，请重试')
                expect(panel.locator('li')).to_have_count(1)
                fail_delete = False
                row.get_by_role('button', name='确认移除', exact=True).click()
                expect(panel.get_by_text('没有匹配的错题', exact=True)).to_be_visible()
                assert len(mutations) == 2
                assert all(path.endswith('/12345678-1234-4234-8234-123456789abc/entries/book/e00') for path in mutations)
                assert page.evaluate('test.refreshes') == 1
                panel.get_by_role('textbox', name='搜索已入库错题').fill('')
                panel.get_by_role('button', name='搜索', exact=True).click()
                expect(panel.get_by_text('已入库错题 · 24 道', exact=True)).to_be_visible()
                other = page.locator('[data-library-id="22345678-1234-4234-8234-123456789abc"]')
                other.get_by_role('button', name='查看错题', exact=True).click()
                expect(other.get_by_text('这个知识库还没有已入库错题', exact=True)).to_be_visible()
                expect(card.get_by_role('region', name='知识库已入库错题')).to_have_count(0)
                page.evaluate("document.documentElement.classList.add('dark')")
                expect(other.get_by_role('button', name='刷新错题', exact=True)).to_have_css('color', 'rgb(180, 172, 158)')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                screenshot = Path('.dev-services') / f'library-entries-{"mobile" if mobile else "desktop"}.png'
                page.screenshot(path=str(screenshot), full_page=True)
                assert not errors, errors
                context.close()
                print(f'PASS: {"mobile" if mobile else "desktop"} library details, search/paging, '
                      'cancel, failed removal/retry, empty state, source-safe requests and dark layout')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
