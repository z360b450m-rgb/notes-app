"""Real Vue stores and panels: background streams, failure snapshots, retries and browser exit."""
import os
from playwright.sync_api import expect, sync_playwright


HARNESS = r'''<html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">
import Agent from '/src/components/ReviewAgentEntry.vue';
import Card from '/src/components/EntryReviewInsightCard.vue';
import '/src/style.css';import '/src/ui-theme.css';
const agentSource=await(await fetch('/src/components/ReviewAgentEntry.vue')).text();
const vueUrl=agentSource.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref,provide}=await import(vueUrl);
const agentUrl=agentSource.match(/from "([^"]*\/useReviewAgentChats\.ts[^"]*)"/)[1];
const {createReviewAgentChats,reviewAgentChatsKey}=await import(agentUrl);
const cardSource=await(await fetch('/src/components/EntryReviewInsightCard.vue')).text();
const insightUrl=cardSource.match(/from "([^"]*\/useEntryReviewInsight\.ts[^"]*)"/)[1];
const insightSource=await(await fetch(insightUrl)).text();
const learningUrl=insightSource.match(/from "([^"]*\/useEntryLearningConversation\.ts[^"]*)"/)[1];
const {createEntryLearningConversations,entryLearningConversationsKey}=await import(learningUrl);
localStorage.setItem('notes_app_access_token','snapshot-token');
localStorage.setItem('notes_app_current_user',JSON.stringify({id:'snapshot-owner'}));
window.streams=[];
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const originalFetch=window.fetch;
window.fetch=async (...args)=>{
  const url=String(args[0]);
  if(url.endsWith('/review-insight')) {
    const id=url.split('/').at(-2);
    return json({entry_id:id,notebook_id:'book',review_count:0,wrong_count:0,status:{label:'尚未复习'},
      evidence:{explanation:'尚未复习'},importance:{label:'尚未评估'},recommendation:'先作答',review_hint:'核对步骤'});
  }
  if(url.endsWith('/query')||url.endsWith('/review-assistant')) {
    const state={signal:args[1].signal,controller:null};streams.push(state);
    const stream=new ReadableStream({start(controller){
      state.controller=controller;
      controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"delta":"已经生成的部分回复"}\n\n'));
      state.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
    }});
    return new Response(stream,{headers:{'content-type':'text/event-stream'}});
  }
  if(url.endsWith('/title')) return json({title:'复习学习计划'});
  if(url.includes('localhost:8000')) return json({items:[]});
  return originalFetch(...args);
};
window.finish=(index,text)=>{streams[index].controller.enqueue(new TextEncoder().encode('event: final\ndata: '+JSON.stringify({answer:text})+'\n\n'));streams[index].controller.close()};
window.fail=index=>streams[index].controller.error(new Error('测试网络中断'));
const makeEntry=id=>({id,notebookId:'book',title:id,question:'x+1=2',correctAnswer:'x=1',wrongAnswer:'',subject:'数学',source:'',tags:[],createdAt:1,updatedAt:1});
const entry=ref(makeEntry('first')),showMain=ref(true),showCard=ref(true);
const tasks={tasks:ref([]),update(item){const old=this.tasks.value.find(x=>x.id===item.id);if(old)Object.assign(old,item);else this.tasks.value.push(item)}};
createApp({setup(){
 const chats=createReviewAgentChats(tasks,()=>{showMain.value=true});provide(reviewAgentChatsKey,chats);
 const learning=createEntryLearningConversations(tasks,(book,id)=>{entry.value=makeEntry(id);showCard.value=true});provide(entryLearningConversationsKey,learning);
 window.test={chats,learning,tasks,entry,showMain,showCard,makeEntry};
 return()=>h('div',{style:{maxWidth:'900px',margin:'auto'}},[
   showMain.value?h(Agent):null,
   showCard.value?h(Card,{entry:entry.value,logs:[]}):null,
 ]);
}}).mount('#app');window.ready=true;
</script></body></html>'''


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(service_workers='block')
            context.route('**/background-chat-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            url = os.getenv('CHAT_TEST_URL', 'http://127.0.0.1:5174') + '/background-chat-harness'
            page.goto(url)
            page.wait_for_function('window.ready')
            main = page.get_by_role('region', name='复习 Agent')
            prompt = main.get_by_role('textbox', name='你的复习目标')
            prompt.fill('后台处理主对话')
            main.get_by_role('button', name='发送复习目标').click()
            expect(main.get_by_text('已经生成的部分回复', exact=True)).to_be_visible()
            page.evaluate('test.showMain.value=false')
            assert page.evaluate('streams[0].signal.aborted') is False
            page.evaluate("finish(0,'在后台完成的主对话')")
            page.wait_for_function('!test.chats.sending.value')
            assert page.evaluate('test.tasks.tasks.value[0].state') == 'completed'
            page.evaluate('test.showMain.value=true')
            expect(main.get_by_text('在后台完成的主对话', exact=True)).to_be_visible()
            prompt.fill('下一轮出现异常')
            prompt.press('Enter')
            expect(main.get_by_text('已经生成的部分回复', exact=True).last).to_be_visible()
            page.evaluate('fail(1)')
            expect(main.get_by_role('alert')).to_contain_text('测试网络中断')
            expect(main.get_by_text('在后台完成的主对话', exact=True)).to_be_visible()
            expect(main.get_by_text('已经生成的部分回复', exact=True).last).to_be_visible()
            assert page.evaluate("JSON.parse(localStorage.getItem('review-agent-chats-v1:snapshot-owner:snapshot')).chats[0].messages.at(-1).snapshotAt>0")
            main.get_by_role('button', name='重试', exact=True).click()
            expect(main.get_by_text('上次回复快照', exact=True)).to_be_visible()
            assert page.evaluate("test.chats.messages.value.at(-1).previous.text") == '已经生成的部分回复'
            page.evaluate("finish(2,'重试成功的新回复')")
            expect(main.get_by_text('重试成功的新回复', exact=True)).to_be_visible()
            # The pending main chat can be left while another chat is selected.
            prompt.fill('主对话等待关闭浏览器')
            prompt.press('Enter')
            page.wait_for_function('streams.length===4')
            main.get_by_role('button', name='新对话', exact=True).click()
            assert page.evaluate('streams[3].signal.aborted') is False
            page.evaluate('test.chats.activeId.value=test.chats.history.value[0].id')

            card = page.get_by_test_id('entry-review-insight')
            card.get_by_test_id('review-insight-toggle').click()
            composer = card.get_by_role('textbox')
            composer.fill('解释第一题')
            composer.press('Enter')
            expect(card.get_by_test_id('entry-review-assistant-answer')).to_contain_text('已经生成的部分回复')
            page.evaluate("test.entry.value=test.makeEntry('second')")
            assert page.evaluate('streams[4].signal.aborted') is False
            page.evaluate("finish(4,'第一题后台完成，不能串到第二题')")
            page.wait_for_function('test.learning.running.value.length===0')
            expect(card).not_to_contain_text('第一题后台完成，不能串到第二题')
            page.evaluate("test.entry.value=test.makeEntry('first')")
            card.get_by_test_id('review-insight-toggle').click()
            expect(card.get_by_test_id('entry-review-assistant-answer')).to_contain_text('第一题后台完成，不能串到第二题')
            composer.fill('关闭面板后保留')
            composer.press('Enter')
            page.wait_for_function('streams.length===6')
            page.evaluate('test.showCard.value=false')
            assert page.evaluate('streams[5].signal.aborted') is False
            page.evaluate('fail(5)')
            page.wait_for_function('test.learning.running.value.length===0')
            page.evaluate('test.showCard.value=true')
            card.get_by_test_id('review-insight-toggle').click()
            expect(card.get_by_test_id('entry-review-assistant-answer')).to_contain_text('已经生成的部分回复')
            expect(card.get_by_role('alert')).to_contain_text('测试网络中断')
            card.get_by_role('button', name='重试回复', exact=True).click()
            expect(card.get_by_text('上次回复快照', exact=True)).to_be_visible()
            page.wait_for_function('streams.length===7')
            # beforeunload writes interrupted snapshots without falsely stopping a cancelled navigation.
            page.evaluate("window.dispatchEvent(new Event('beforeunload'))")
            assert page.evaluate('streams[3].signal.aborted') is False
            assert page.evaluate('streams[6].signal.aborted') is False
            for key in ('review-agent-chats-v1:snapshot-owner', 'entry-learning-chats-v1:snapshot-owner'):
                assert page.evaluate('(key)=>localStorage.getItem(key).includes("页面已关闭或刷新")', key)
            page.close(run_before_unload=True)
            page = context.new_page()
            page.goto(url)
            page.wait_for_function('window.ready')
            main = page.get_by_role('region', name='复习 Agent')
            expect(main.get_by_text('已经生成的部分回复', exact=True).last).to_be_visible()
            expect(main.get_by_role('alert')).to_contain_text('页面已关闭或刷新')
            card = page.get_by_test_id('entry-review-insight')
            card.get_by_test_id('review-insight-toggle').click()
            expect(card.get_by_test_id('entry-review-assistant-answer')).to_contain_text('已经生成的部分回复')
            expect(card.get_by_role('alert')).to_contain_text('页面已关闭或刷新')
            expect(card.get_by_text('上次回复快照', exact=True)).to_be_visible()
            assert page.evaluate('test.tasks.tasks.value.length') == 0
            card.screenshot(path='.dev-services/chat-interrupted-snapshot.png')
            # A damaged primary record can still recover from the last complete checkpoint.
            context.add_init_script("localStorage.setItem('review-agent-chats-v1:snapshot-owner','broken');localStorage.setItem('entry-learning-chats-v1:snapshot-owner','broken')")
            page.reload()
            page.wait_for_function('window.ready')
            expect(main.get_by_text('已经生成的部分回复', exact=True).last).to_be_visible()
            expect(main.get_by_role('alert')).to_contain_text('页面已关闭或刷新')
            card.get_by_test_id('review-insight-toggle').click()
            expect(card.get_by_test_id('entry-review-assistant-answer')).to_contain_text('已经生成的部分回复')
            assert not errors, errors
            print('PASS: main panel close/reopen, switch chat, entry switch/close, task results, partial errors, '
                  'retry snapshots, beforeunload checkpoint and actual browser page close/reopen recovery')
            context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    run()
