"""真实 Vue 卡片的接口接入、请求取消、流式回复和离线展示；需要 Vite。"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


HARNESS = r'''<html><head><meta charset="UTF-8"></head><body>
<div id="app" style="padding:24px;max-width:900px;margin:auto"></div><script type="module">
import Card from '/src/components/EntryReviewInsightCard.vue';
import '/src/style.css';import '/src/ui-theme.css';
const source=await(await fetch('/src/components/EntryReviewInsightCard.vue')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref}=await import(vueUrl);
const entry=ref({id:'first',notebookId:'book',title:'方程练习',question:'x+1=2',
correctAnswer:'x=1',wrongAnswer:'',subject:'数学',source:'',tags:['方程'],createdAt:1,updatedAt:1});
const logs=ref([]),dirty=ref(false);window.test={entry,logs,dirty};
createApp({setup(){return()=>h(Card,{entry:entry.value,logs:logs.value,isDirty:dirty.value})}}).mount('#app');
window.ready=true;
</script></body></html>'''


def card(entry='first', reviews=0, wrong=0):
    return {
        'entry_id': entry, 'notebook_id': 'book', 'review_count': reviews, 'wrong_count': wrong,
        'status': {'code': 'unreviewed' if not reviews else 'needs_review',
                   'label': '尚未复习' if not reviews else '建议复习'},
        'recommendation': '先完成一次独立作答' if not reviews else '优先独立重做，核对易错步骤',
        'importance': {'label': '尚未评估'},
        'evidence': {'explanation': '暂无作答记录，暂不判断个人薄弱程度。' if not reviews else '已判定对错 3 次，其中答错 2 次。'},
        'review_hint': '复习安排提示：独立作答 → 核对关键步骤 → 复述方法。',
    }


def run():
    requests = []
    state = {'read_failure': False, 'assistant_failure': False, 'reviews': 0}

    def api(route):
        request = route.request
        path = urlparse(request.url).path
        if request.method == 'OPTIONS':
            route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'})
            return
        assert request.headers.get('authorization') == 'Bearer test-token'
        headers = {'Access-Control-Allow-Origin': '*'}
        if path.endswith('/review-insight'):
            if state['read_failure']:
                route.fulfill(status=503, content_type='application/json', headers=headers,
                              body=json.dumps({'detail': '暂时无法连接后台'}))
            else:
                ident = path.split('/')[-2]
                reviews = 3 if ident == 'second' else state['reviews']
                route.fulfill(content_type='application/json', headers=headers,
                              body=json.dumps(card(ident, reviews, 2 if reviews else 0)))
        elif path.endswith('/review-bundle'):
            requests.append((path, request.post_data_json))
            ident = path.split('/')[-2]
            route.fulfill(content_type='application/json', headers=headers, body=json.dumps({
                'anchor_entry_id':ident,'notebook_id':'book','proposal_token':'proposal','expires_at':1999999999999,
                'estimated_seconds':300,'notices':[],'bundle_version':'related-review-v1','items':[
                    {'entry_id':ident,'title':'当前题复习','question_preview':'x+1=2','knowledge_points':['方程'],
                     'estimated_seconds':300,'review_count':0,'wrong_count':0,
                     'relation':{'relation':'anchor','reason':'当前题目','anchor_evidence':[],'candidate_evidence':[]},
                     'importance':{'importance':'unknown','reason':'未评估','evidence':[]}}]}))
        elif path.endswith('/review-assistant'):
            requests.append((path, request.post_data_json))
            if state['assistant_failure']:
                route.fulfill(status=503, content_type='application/json', headers=headers,
                              body=json.dumps({'detail': 'RAG 服务未启动'}))
            else:
                body = request.post_data_json
                response = ('针对你的解释：' + body['message'] + '。等式性质使用正确。'
                    if body['action'] == 'discuss_question' else
                    '方程知识点：等式两边同时减去 1。引导问题：为什么等式仍成立？')
                route.fulfill(content_type='text/event-stream', headers=headers, body=(
                    'event: summary\ndata: {"text":"正在分析这道题"}\n\n'
                    'event: delta\ndata: '+json.dumps({'delta': response})+'\n\n'
                    'event: final\ndata: '+json.dumps({'answer': response})+'\n\n'))
        else:
            route.abort()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(viewport={'width': 1200, 'height': 900}, service_workers='block')
            context.route('http://localhost:8000/**', api)
            context.route('**/review-insight-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.add_init_script("localStorage.setItem('notes_app_access_token','test-token');localStorage.setItem('notes_app_current_user',JSON.stringify({id:'alice'}))")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:5174/review-insight-harness')
            page.wait_for_function('window.ready')
            def open_assistant():
                toggle = page.get_by_test_id('review-insight-toggle')
                expect(toggle).to_have_attribute('aria-expanded', 'false')
                expect(page.get_by_test_id('entry-learning-input')).to_be_hidden()
                toggle.click()

            open_assistant()
            arrange = page.get_by_role('button', name='让助手安排复习', exact=True)
            learn = page.get_by_role('button', name='学习此题知识点', exact=True)
            expect(arrange).to_be_enabled()
            expect(page.get_by_test_id('entry-learning-counts')).to_have_text('复习 0 次 · 答错 0 次')
            expect(page.get_by_test_id('review-insight-evidence')).to_have_text('暂无作答记录，暂不判断个人薄弱程度。')
            composer = page.get_by_test_id('entry-learning-input')
            send = page.get_by_test_id('entry-learning-send')
            history_button = page.get_by_test_id('entry-learning-history-button')
            history_dialog = page.get_by_role('dialog', name='当前题目对话历史', exact=True)

            def open_history(count):
                history_button.click()
                expect(history_dialog).to_be_visible()
                expect(history_dialog.get_by_test_id('entry-learning-history-turn')).to_have_count(count)

            def close_history():
                page.keyboard.press('Escape')
                expect(history_dialog).to_have_count(0)

            def check_history(count):
                open_history(count)
                close_history()

            expect(composer).to_be_visible()
            expect(send).to_be_disabled()
            expect(history_button).to_be_disabled()
            expect(history_dialog).to_have_count(0)
            # The card accepts a question before any lesson button is clicked.
            composer.fill('这道题应该先想哪个知识点？')
            composer.evaluate("el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true}))")
            assert not requests, 'IME Enter must not submit an unfinished composition'
            composer.press('Enter')
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('这道题应该先想哪个知识点')
            assert requests[-1][1]['action'] == 'discuss_question'
            assert requests[-1][1]['message'] == '这道题应该先想哪个知识点？'
            initial_session = requests[-1][1]['session_id']
            output = Path('.dev-services/review-insight-card.png')
            page.get_by_test_id('entry-review-insight').screenshot(path=str(output))
            page.get_by_test_id('review-insight-toggle').click()
            expect(learn).to_be_hidden()
            page.get_by_test_id('review-insight-toggle').click()
            arrange.click()
            expect(page.get_by_test_id('review-bundle-preview')).to_contain_text('当前题复习')
            expect(page.get_by_test_id('confirm-review-bundle')).to_be_enabled()
            assert requests[-1][0].endswith('/review-bundle')
            state['assistant_failure'] = True
            learn.click()
            expect(page.get_by_text('RAG 服务未启动', exact=False)).to_be_visible()
            state['assistant_failure'] = False
            page.get_by_role('button', name='重试回复', exact=True).click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('方程知识点')
            first_session = requests[-1][1]['session_id']
            assert requests[-1][1]['action'] == 'learn_knowledge'
            assert requests[-1][1]['session_id'] == first_session
            assert first_session == initial_session
            expect(page.get_by_test_id('review-bundle-preview')).to_be_visible()
            # Continue the guide using the same conversation; keep both previous turns.
            composer.fill('因为等式两边减去同一个数')
            composer.press('Shift+Enter')
            assert composer.input_value().endswith('\n')
            composer.type('所以等式仍成立')
            send.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('针对你的解释')
            assert requests[-1][1]['message'] == '因为等式两边减去同一个数\n所以等式仍成立'
            assert requests[-1][1]['action'] == 'discuss_question'
            assert requests[-1][1]['session_id'] == first_session
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            open_history(3)
            expect(history_dialog.get_by_test_id('entry-learning-history-answer').nth(1)).to_contain_text('为什么等式仍成立')
            page.screenshot(path='.dev-services/entry-learning-history.png')
            close_history()
            expect(history_button).to_be_focused()
            expect(page.get_by_test_id('entry-learning-counts')).to_have_text('复习 0 次 · 答错 0 次')
            expect(page.get_by_test_id('review-bundle-preview')).to_be_visible()
            page.get_by_test_id('entry-review-insight').screenshot(path='.dev-services/entry-learning-chat.png')
            # Failure/retry must resend the actual message without duplicating the user turn.
            state['assistant_failure'] = True
            composer.fill('请先给提示，不要答案')
            send.click()
            check_history(4)
            expect(page.get_by_text('RAG 服务未启动', exact=False)).to_be_visible()
            state['assistant_failure'] = False
            page.get_by_role('button', name='重试回复', exact=True).click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('请先给提示，不要答案')
            check_history(4)
            assert requests[-1][1]['message'] == '请先给提示，不要答案'

            # Explicit stop keeps a snapshot; switching entries allows the next request to finish in the background.
            page.evaluate(r'''() => {
              window.originalFetch=window.fetch;window.aborted=false;window.backgroundFinished=false;
              window.fetch=async (url,init)=>{
                if(String(url).endsWith('/first/review-assistant')){
                  let timer;
                  const stream=new ReadableStream({start(controller){
                    const encoder=new TextEncoder();
                    controller.enqueue(encoder.encode('event: delta\ndata: {"delta":"正在生成第一题"}\n\n'));
                    timer=setTimeout(()=>{controller.enqueue(encoder.encode('event: final\ndata: {"answer":"第一题后台回复"}\n\n'));controller.close();window.backgroundFinished=true},1500);
                    init.signal.addEventListener('abort',()=>{window.aborted=true;clearTimeout(timer);controller.error(new DOMException('Aborted','AbortError'))});
                  },cancel(){clearTimeout(timer)}});
                  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
                }
                return window.originalFetch(url,init);
              };
            }''')
            composer.fill('继续解释一下这里')
            send.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('正在生成第一题')
            expect(page.get_by_role('button', name='停止生成')).to_be_visible()
            expect(arrange).to_be_disabled()
            page.get_by_role('button', name='停止生成').click()
            expect(page.get_by_text('回复已停止，可重试。', exact=False)).to_be_visible()
            page.evaluate('window.aborted=false')
            page.get_by_role('button', name='重试回复').click()
            expect(page.get_by_role('button', name='停止生成')).to_be_visible()
            page.evaluate("test.entry.value={...test.entry.value,id:'second',reviewCount:3,wrongCount:2}")
            open_assistant()
            page.wait_for_function('window.backgroundFinished')
            assert not page.evaluate('window.aborted')
            expect(page.get_by_test_id('entry-learning-counts')).to_have_text('复习 3 次 · 答错 2 次')
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_have_count(0)
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(0)
            expect(composer).to_have_value('')
            expect(arrange).to_be_enabled()
            learn.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('方程知识点')
            assert requests[-1][0].endswith('/second/review-assistant')
            assert requests[-1][1]['session_id'] != first_session
            second_session = requests[-1][1]['session_id']
            # Returning to a question restores its conversation/session; drafts are per question.
            composer.fill('第二题尚未发送的草稿')
            page.evaluate("window.fetch=window.originalFetch;test.entry.value={...test.entry.value,id:'first',reviewCount:0,wrongCount:0}")
            open_assistant()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            expect(history_dialog).to_have_count(0)
            open_history(5)
            expect(history_dialog.get_by_test_id('entry-learning-history-answer').last).to_contain_text('第一题后台回复')
            expect(history_dialog.get_by_text('上次回复快照', exact=True).last).to_be_visible()
            close_history()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('第一题后台回复')
            composer.fill('回到第一题继续聊')
            send.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('回到第一题继续聊')
            assert requests[-1][1]['session_id'] == first_session
            page.evaluate("test.entry.value={...test.entry.value,id:'second',reviewCount:3,wrongCount:2}")
            open_assistant()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            check_history(1)
            expect(composer).to_have_value('第二题尚未发送的草稿')
            # Edits preserve visible history while changing the server context.
            page.evaluate("test.dirty.value=true;test.entry.value.question='x+2=3'")
            expect(composer).to_be_disabled()
            expect(learn).to_be_disabled()
            check_history(1)
            expect(page.get_by_text('题目已修改，后续回复依据保存后的内容；之前的对话仍保留。')).to_be_visible()
            page.evaluate('test.dirty.value=false')
            composer.fill('新题怎么做？')
            send.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('新题怎么做')
            assert requests[-1][1]['session_id'] != second_session
            check_history(2)

            # Refresh after new local logs, failure notice and explicit retry.
            state['read_failure'] = True
            page.evaluate("test.entry.value={...test.entry.value,id:'first',question:'x+1=2',reviewCount:0,wrongCount:0}")
            open_assistant()
            expect(page.get_by_role('button', name='重试加载')).to_be_visible()
            expect(arrange).to_be_disabled()
            state['read_failure'] = False
            page.get_by_role('button', name='重试加载').click()
            expect(arrange).to_be_enabled()
            state['read_failure'] = True
            page.evaluate('test.entry.value.updatedAt++')
            expect(page.get_by_role('button', name='重试加载')).to_be_visible()
            state['read_failure'] = False
            page.evaluate("window.dispatchEvent(new CustomEvent('notes-app:sync-completed',{detail:{owner:'bob',entryIds:['first'],groupIds:[]}}))")
            page.wait_for_timeout(150)
            expect(arrange).to_be_disabled()
            page.evaluate("window.dispatchEvent(new CustomEvent('notes-app:sync-completed',{detail:{owner:'alice',entryIds:['first'],groupIds:[]}}))")
            expect(arrange).to_be_enabled()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            check_history(6)
            # Remount/page reload preserves conversations, then only the explicit clear removes this one.
            page.reload()
            page.wait_for_function('window.ready')
            open_assistant()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            expect(history_dialog).to_have_count(0)
            open_history(6)
            history_dialog.get_by_test_id('entry-learning-history-clear').click()
            expect(history_dialog).to_have_count(0)
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(0)
            expect(history_button).to_be_disabled()
            expect(composer).to_be_focused()
            page.evaluate("test.entry.value={...test.entry.value,id:'second',question:'x+2=3'}")
            open_assistant()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            open_history(2)
            history_dialog.get_by_role('button', name='继续对话', exact=True).click()
            expect(history_dialog).to_have_count(0)
            expect(composer).to_be_focused()
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(1)
            # Changing the selected question dismisses an open history popup.
            open_history(2)
            page.evaluate("test.entry.value={...test.entry.value,id:'first',question:'x+1=2'}")
            open_assistant()
            expect(history_dialog).to_have_count(0)
            expect(page.get_by_test_id('entry-learning-turn')).to_have_count(0)
            composer.fill('清空后重新提问')
            send.click()
            expect(page.get_by_test_id('entry-review-assistant-answer')).to_contain_text('清空后重新提问')
            assert requests[-1][1]['session_id'] != first_session
            state['reviews'] = 3
            page.evaluate("test.entry.value.reviewCount=3;test.entry.value.wrongCount=2;test.logs.value=[{id:'one',entryId:'first',timestamp:1,quality:'mastered',isCorrect:false}]")
            expect(page.get_by_test_id('review-insight-status')).to_have_text('建议复习')
            page.set_viewport_size({'width': 390, 'height': 844})
            expect(learn).to_be_visible()
            expect(composer).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.get_by_test_id('entry-review-insight').screenshot(path='.dev-services/review-insight-mobile.png')
            open_history(1)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path='.dev-services/entry-learning-history-mobile.png')
            close_history()
            page.evaluate("document.documentElement.classList.add('dark')")
            page.get_by_test_id('entry-review-insight').screenshot(path='.dev-services/review-insight-dark.png')
            open_history(1)
            page.screenshot(path='.dev-services/entry-learning-history-dark.png')
            close_history()
            assert not errors, errors

            # Even when local storage contains Alice's chats, Bob cannot see them.
            alice_chats = page.evaluate("localStorage.getItem('entry-learning-chats-v1:alice')")
            another = browser.new_context(viewport={'width': 900, 'height': 700}, service_workers='block')
            another.route('http://localhost:8000/**', api)
            another.route('**/review-insight-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            another.add_init_script("localStorage.setItem('notes_app_access_token','test-token');localStorage.setItem('notes_app_current_user',JSON.stringify({id:'bob'}));localStorage.setItem('entry-learning-chats-v1:alice'," + json.dumps(alice_chats) + ")")
            bob_page = another.new_page()
            bob_page.goto('http://127.0.0.1:5174/review-insight-harness')
            expect(bob_page.get_by_test_id('entry-learning-input')).to_be_enabled()
            expect(bob_page.get_by_test_id('entry-learning-turn')).to_have_count(0)
            another.close()

            # Offline users keep local counts and receive no false model assessment.
            offline = browser.new_context(viewport={'width': 900, 'height': 700})
            offline.route('**/review-insight-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            offline_page = offline.new_page()
            offline_page.goto('http://127.0.0.1:5174/review-insight-harness')
            offline_page.get_by_test_id('review-insight-toggle').click()
            expect(offline_page.get_by_text('当前展示本地记录，登录后可使用复习助手。')).to_be_visible()
            expect(offline_page.get_by_role('button', name='让助手安排复习')).to_be_disabled()
            offline.close()
            print('PASS: history hidden by default, popup open/Escape/focus, historical retry/continue/clear, persistence, per-entry drafts/session, SSE background completion and snapshots, bundle retention, mobile/dark, account isolation and offline')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
