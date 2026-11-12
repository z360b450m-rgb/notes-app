"""Browser checks for the connected entrance using a mocked query API."""

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(
        QuietHandler, directory=str(Path(__file__).resolve().parents[2] / "dist"),
    ))
    Thread(target=server.serve_forever, daemon=True).start()
    requests = []
    user = {"id": "agent-test", "email": "agent@example.test", "full_name": "Test",
            "is_active": True, "created_at": 1}
    notebooks = [{'id': book, 'name': name, 'created_at': 1, 'updated_at': 1}
                 for book, name in [('book-one', '第一本'), ('book-two', '原题所在本')]]
    linked_entry = {'id': 'cuoti_link_target', 'notebook_id': 'book-two', 'title': '链接目标题',
                    'question': '<p>这是跳转后应打开的原始题干。</p>',
                    'correct_answer': '<p>原始解析</p>', 'wrong_answer': '',
                    'subject': '数学', 'source': '', 'tags': [], 'created_at': 1, 'updated_at': 1}

    def api(route):
        request = route.request
        path = urlparse(request.url).path
        result = {"items": []}
        status = 200
        if path == "/api/users/me":
            result = user
        elif path == "/health":
            result = {"status": "ok"}
        elif path == '/api/notebooks':
            result = {'items': notebooks}
        elif path == '/api/entries/search':
            book = parse_qs(urlparse(request.url).query)['notebook_id'][0]
            result = {'items': [linked_entry] if book == 'book-two' else []}
        elif path == '/api/entries/summaries':
            book = parse_qs(urlparse(request.url).query)['notebook_id'][0]
            result = {'items': [linked_entry] if book == 'book-two' else []}
        elif path == '/api/entries/cuoti_link_target':
            result = linked_entry
        elif path == '/api/entries/deleted':
            result, status = {'detail': '题目不存在'}, 404
        elif path == "/api/knowledge/notebooks":
            result = {"items": [], "indexes": [
                {"kb_id": "12345678-1234-4234-8234-123456789abc", "indexed_count": 1},
            ]}
        elif path == '/api/knowledge/documents':
            result = {'items': [{'id': '12345678-1234-4234-8234-123456789abc',
                                 'name': '测试', 'description': '', 'status': 'ready',
                                 'archived': False, 'updatedAt': 1}]}
        elif path == "/api/review-agent/query":
            assert request.headers["authorization"] == "Bearer test-token"
            requests.append(request.post_data_json)
            if len(requests) == 2:
                status, result = 503, {"detail": "RAG 服务未启动"}
            else:
                result = {"answer": f"接口回复 {len(requests)}"}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(result))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv("PLAYWRIGHT_CHANNEL"))
        try:
            context = browser.new_context()
            context.route("http://localhost:8000/**", api)
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.add_init_script(f"""
                localStorage.setItem('notes_app_access_token', 'test-token');
                localStorage.setItem('notes_app_current_user', {json.dumps(json.dumps(user))});
            """)
            page = context.new_page()
            page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until='domcontentloaded')
            page.get_by_role("button", name="开始复习", exact=True).click()
            prompt = page.get_by_role("textbox", name="你的复习目标")
            prompt.fill("测试第一条问题")
            page.get_by_role("button", name="发送复习目标").click()
            expect(page.get_by_text("接口回复 1", exact=True)).to_be_visible()
            prompt.fill("第二条问题")
            prompt.press("Enter")
            expect(page.get_by_label('复习目标对话').get_by_text("RAG 服务未启动", exact=True)).to_be_visible()
            page.get_by_role("button", name="重试", exact=True).click()
            expect(page.get_by_text("接口回复 3", exact=True)).to_be_visible()
            assert requests[0]["session_id"] == requests[1]["session_id"] == requests[2]["session_id"]
            assert requests[1] == requests[2]
            expect(page.get_by_text("第二条问题", exact=True)).to_have_count(1)
            page.reload()
            page.get_by_role("button", name="开始复习", exact=True).click()
            expect(page.get_by_text("接口回复 3", exact=True)).to_be_visible()
            page.get_by_role("button", name="新对话", exact=True).click()
            prompt.fill("新的会话")
            prompt.press("Enter")
            expect(page.get_by_text("接口回复 4", exact=True)).to_be_visible()
            assert requests[-1]["session_id"] != requests[0]["session_id"]
            # 用延迟final的真实ReadableStream验证页面在pending时显示增量文字
            page.evaluate("""() => {
                const originalFetch = window.fetch;
                window.fetch = async (...args) => {
                    if (!String(args[0]).includes('/api/review-agent/query')) return originalFetch(...args);
                    const body = JSON.parse(args[1].body);
                    if (body.is_stream !== true) throw new Error('Stream flag missing');
                    const encoder = new TextEncoder();
                    return new Response(new ReadableStream({start(controller) {
                        controller.enqueue(encoder.encode('event: summary\\ndata: {"text":"正在检索学习资料"}\\n\\n'));
                        setTimeout(() => controller.enqueue(encoder.encode(
                            'event: delta\\ndata: {"delta":"流式第一段"}\\n\\n')), 100);
                        setTimeout(() => {
                            controller.enqueue(encoder.encode(
                                'event: final\\ndata: {"answer":"流式第一段，第二段。"}\\n\\n'));
                            controller.close();
                        }, 2000);
                    }}), {headers: {'Content-Type': 'text/event-stream'}});
                };
            }""")
            page.get_by_role("button", name="新对话", exact=True).click()
            prompt.fill("测试流式输出")
            prompt.press("Enter")
            expect(page.get_by_text("流式第一段", exact=True)).to_be_visible(timeout=1500)
            expect(page.get_by_text("正在检索学习资料", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="发送复习目标")).to_be_disabled()
            expect(page.get_by_text("流式第一段，第二段。", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="新对话", exact=True)).to_be_enabled()
            math_answer = r"""用公式表示就是：

$$
a^2 + b^2 = c^2
$$

其中：
- $ a $ 和 $ b $ 是直角边。
- $ c $ 是斜边。

---

### 举个例子

$$
c = \sqrt{3^2 + 4^2} = \sqrt{25} = 5
$$

代码保持原样：`cost $10`。
"""
            page.evaluate("""answer => {
                window.fetch = async () => {
                    const encoder = new TextEncoder();
                    return new Response(new ReadableStream({start(controller) {
                        controller.enqueue(encoder.encode('event: delta\\ndata: ' +
                            JSON.stringify({delta:'用公式表示：\\n\\n$$\\na^2 + b^2'}) + '\\n\\n'));
                        setTimeout(() => {
                            controller.enqueue(encoder.encode('event: final\\ndata: ' +
                                JSON.stringify({answer}) + '\\n\\n'));
                            controller.close();
                        }, 2000);
                    }}), {headers: {'Content-Type': 'text/event-stream'}});
                };
            }""", math_answer)
            page.get_by_role("button", name="新对话", exact=True).click()
            prompt.fill("解释勾股定理")
            prompt.press("Enter")
            expect(page.get_by_text("公式生成中…", exact=True)).to_be_visible(timeout=1500)
            answer = page.locator('.learning-answer').last
            expect(answer.locator('.katex')).to_have_count(5)
            expect(answer.locator('h3')).to_have_text('举个例子')
            expect(answer.locator('li')).to_have_count(2)
            expect(answer.locator('code')).to_have_text('cost $10')
            assert '$$' not in answer.inner_text()
            assert r'\sqrt' not in answer.inner_text()
            screenshot = Path(__file__).resolve().parents[2] / '.dev-services' / 'answer-render.png'
            page.screenshot(path=str(screenshot), full_page=True)
            # 澄清选项随历史保存，点击后发送完整问题并保留知识库范围
            library_id = '12345678-1234-4234-8234-123456789abc'
            page.evaluate("kb => sessionStorage.setItem('seed-last-library',kb)", library_id)
            page.add_init_script("""(() => {
                const kb = sessionStorage.getItem('seed-last-library');
                if (!kb) return;
                const key = 'review-agent-chats-v1:agent-test';
                const saved = JSON.parse(localStorage.getItem(key));
                const chat = saved.chats.find(c => c.id === saved.activeId);
                chat.messages.filter(m => m.role === 'user').at(-1).knowledgeBases = [{id:kb,name:'测试'}];
                localStorage.setItem(key, JSON.stringify(saved));
                sessionStorage.removeItem('seed-last-library');
            })()""")
            page.reload()
            page.get_by_role('button', name='开始复习', exact=True).click()
            choices = [{'id': '1', 'label': '介绍当前知识库', 'text': '介绍当前知识库的主要内容'},
                       {'id': '2', 'label': '查询题目数量', 'text': '当前知识库有多少题'},
                       {'id': '3', 'label': '取消这次请求', 'text': '取消这次请求'}]

            def mock_choices(answer, options):
                page.evaluate("""payload => {
                    window.__choiceRequests = [];
                    const originalFetch = window.fetch;
                    window.fetch = async (...args) => {
                        if (!String(args[0]).includes('/api/review-agent/query')) return originalFetch(...args);
                        window.__choiceRequests.push(JSON.parse(args[1].body));
                        return new Response('event: final\\ndata: ' + JSON.stringify(payload) + '\\n\\n',
                            {headers:{'Content-Type':'text/event-stream'}});
                    };
                }""", {'answer': answer, 'clarification_choices': options})

            mock_choices('你想介绍内容还是查询数量？', choices)
            prompt.fill('测试澄清选项')
            prompt.press('Enter')
            answers = page.get_by_label('可执行回答', exact=True)
            expect(answers.get_by_role('button')).to_have_count(3)
            assert len(page.evaluate('window.__choiceRequests')) == 1
            page.screenshot(path=str(screenshot.with_name('clarification-choices.png')), full_page=True)
            page.reload()
            page.get_by_role('button', name='开始复习', exact=True).click()
            expect(answers.get_by_role('button')).to_have_count(3)
            mock_choices('已执行介绍当前知识库。', [])
            answers.get_by_role('button', name='1. 介绍当前知识库', exact=True).click()
            expect(page.get_by_text('已执行介绍当前知识库。', exact=True)).to_be_visible()
            click_request = page.evaluate('window.__choiceRequests')[0]
            assert click_request['query'] == choices[0]['text']
            assert click_request['kb_ids'] == [library_id]
            expect(answers).to_have_count(0)
            # 原题链接须打开所属错题本，错误ID留在聊天中，历史恢复后仍能点击。
            mock_choices('[不存在的题目](#/notebooks/book-two/entries/deleted)\n\n'
                         '[打开原题](#/notebooks/book-two/entries/cuoti_link_target)\n\n'
                         '[旧格式原题](#entry-cuoti_link_target)\n\n'
                         '[外部资料](https://example.test/reference)', [])
            prompt.fill('测试原题跳转')
            prompt.press('Enter')
            page.get_by_role('link', name='不存在的题目', exact=True).click()
            expect(page.get_by_role('alert').filter(has_text='无法打开原题')).to_be_visible()
            expect(prompt).to_be_visible()
            expect(page.get_by_role('link', name='外部资料')).to_have_attribute(
                'href', 'https://example.test/reference')
            page.reload()
            page.get_by_role('button', name='开始复习', exact=True).click()
            page.get_by_role('link', name='打开原题', exact=True).click()
            expect(page.locator('[contenteditable="true"]').filter(
                has_text='这是跳转后应打开的原始题干。')).to_be_visible()
            page.get_by_role('button', name='返回 AI 助手', exact=True).click()
            expect(page.get_by_label('复习 Agent', exact=True)).to_be_visible()
            expect(page.get_by_role('heading', name='开始复习', exact=True)).to_be_visible()
            expect(page.get_by_text('测试原题跳转', exact=True)).to_be_visible()
            page.get_by_role('link', name='打开原题', exact=True).click()
            expect(page.locator('[contenteditable="true"]').filter(
                has_text='这是跳转后应打开的原始题干。')).to_be_visible()
            page.get_by_role('button', name='返回', exact=True).click()
            expect(page.get_by_label('复习 Agent', exact=True)).to_have_count(0)
            page.get_by_role('button', name='开始复习', exact=True).click()
            page.get_by_role('link', name='旧格式原题', exact=True).click()
            expect(page.locator('[contenteditable="true"]').filter(
                has_text='这是跳转后应打开的原始题干。')).to_be_visible()
            expect(page.get_by_text('原题所在本', exact=True).first).to_be_visible()
            print("PASS: real entrance API calls, retry, saved history and separate sessions")
            print("PASS: incremental answer and processing summary visible before final")
            print("PASS: rendered Markdown, math and incomplete streaming formula")
            print("PASS: streamed choices, reload persistence, explicit click, selected library and stale button removal")
            print('PASS: original entry navigation, notebook selection, missing target, saved links and legacy ID links')
            print('PASS: separate return to AI assistant restores conversation; normal return opens notebook list')
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    run()
