"""Real Vue chat state: three successful rounds, one title, persistence and stale requests. Requires Vite."""
import os

from playwright.sync_api import sync_playwright


HARNESS = r'''<html><head><meta charset="UTF-8"></head><body><div id="app"></div>
<script type="module">
import {useReviewAgentChats} from '/src/composables/useReviewAgentChats.ts';
const source=await(await fetch('/src/composables/useReviewAgentChats.ts')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp}=await import(vueUrl);
localStorage.setItem('notes_app_access_token','test-token');
localStorage.setItem('notes_app_current_user',JSON.stringify({id:'title-test'}));
window.state={titles:[],failQuery:false,failTitle:false,holdTitle:false,releases:[]};
const originalFetch=window.fetch;
window.fetch=async (...args)=>{
  const url=String(args[0]);
  if(url.endsWith('/query')) return new Response(JSON.stringify(
    state.failQuery?{detail:'回复失败'}:{answer:'完整回答'}),
    {status:state.failQuery?503:200,headers:{'Content-Type':'application/json'}});
  if(url.endsWith('/title')){
    state.titles.push(url);
    if(state.holdTitle) await new Promise(resolve=>state.releases.push(resolve));
    return new Response(JSON.stringify(state.failTitle?{detail:'暂时失败'}:{title:'分式方程学习'}),
      {status:state.failTitle?503:200,headers:{'Content-Type':'application/json'}});
  }
  if(url.includes('/history/')) return new Response(JSON.stringify({deleted_count:6}),
    {headers:{'Content-Type':'application/json'}});
  return originalFetch(...args);
};
window.app=createApp({setup(){window.test=useReviewAgentChats();return ()=>null;}});
app.mount('#app');window.ready=true;
</script></body></html>'''


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(service_workers='block')
            context.route('**/chat-title-harness', lambda r: r.fulfill(content_type='text/html', body=HARNESS))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            base = os.getenv('TITLE_TEST_URL', 'http://127.0.0.1:5174')

            def load():
                page.goto(base + '/chat-title-harness')
                page.wait_for_function('window.ready')

            def send(text='讲解分式方程'):
                page.evaluate('(text)=>test.append(text)', text)

            def generated():
                page.wait_for_function("test.history.value.find(c=>c.id===test.activeId.value)?.titleSource==='generated'")

            def fresh():
                page.evaluate('test.activeId.value=null;state.titles=[];state.failQuery=false;state.failTitle=false;state.holdTitle=false')

            load()
            send()
            send('解释增根')
            assert page.evaluate('state.titles.length') == 0
            page.evaluate('state.failQuery=true')
            send('举一个例子')
            assert page.evaluate('state.titles.length') == 0
            page.evaluate('state.failQuery=false;test.retry()')
            generated()
            assert page.evaluate('state.titles.length') == 1
            for _ in range(6):
                send('继续练习')
            assert page.evaluate('state.titles.length') == 1
            load()
            send('刷新后继续')
            assert page.evaluate('state.titles.length') == 0
            assert page.evaluate('test.history.value[0].title') == '分式方程学习'

            fresh()
            send()
            send()
            page.evaluate("test.renameChat(test.activeId.value,'我的学习计划')")
            send()
            assert page.evaluate('state.titles.length') == 0
            assert page.evaluate('test.history.value[0].title') == '我的学习计划'

            fresh()
            send()
            send()
            page.evaluate('state.holdTitle=true')
            send()
            assert page.evaluate('test.sending.value') is False
            page.evaluate("test.renameChat(test.activeId.value,'手动保留');state.releases.shift()()")
            page.wait_for_timeout(100)
            assert page.evaluate('test.history.value[0].title') == '手动保留'

            fresh()
            send()
            send()
            page.evaluate('state.failTitle=true')
            send()
            page.wait_for_function('state.titles.length===1')
            page.wait_for_timeout(100)
            assert page.evaluate('test.history.value[0].titleSource') == 'initial'
            page.evaluate('state.failTitle=false')
            send()
            generated()
            assert page.evaluate('state.titles.length') == 2

            fresh()
            send()
            send()
            page.evaluate('state.holdTitle=true;window.pendingId=test.activeId.value')
            send()
            page.evaluate('test.activeId.value=null')
            send('英语单词')
            page.evaluate('state.releases.shift()()')
            page.wait_for_function("test.history.value.find(c=>c.id===pendingId).titleSource==='generated'")
            assert page.evaluate('test.history.value[0].title') == '英语单词'

            fresh()
            send()
            send()
            page.evaluate('state.holdTitle=true;window.deletedId=test.activeId.value')
            send()
            page.evaluate('test.deleteChat(deletedId)')
            page.evaluate('state.releases.shift()()')
            page.wait_for_timeout(100)
            assert page.evaluate('test.history.value.some(c=>c.id===deletedId)') is False

            # Legacy renamed records are preserved; legacy first-message titles can generate.
            page.evaluate('app.unmount()')
            page.evaluate('''() => {
              const key='review-agent-chats-v1:title-test';
              const data=JSON.parse(localStorage.getItem(key));
              data.chats=[{id:crypto.randomUUID(),title:'旧的手动名称',updatedAt:1,
                messages:[{role:'user',text:'首条消息'},{role:'assistant',text:'回答'}]}];
              data.activeId=data.chats[0].id;localStorage.setItem(key,JSON.stringify(data));
            }''')
            load()
            send()
            send()
            assert page.evaluate('state.titles.length') == 0
            assert page.evaluate('test.history.value[0].title') == '旧的手动名称'
            assert not errors, errors
            print('PASS: three successful rounds, failure/retry, generate once, reload, manual titles, '
                  'nonblocking naming, switching, deletion and legacy history')
            context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    run()
