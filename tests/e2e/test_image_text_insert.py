"""Real editor components with isolated data; OCR transport is deterministic."""
import json
import os
from playwright.sync_api import expect, sync_playwright

PNG = {'name': 'question.png', 'mimeType': 'image/png', 'buffer': bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        context = browser.new_context(viewport={'width': 1440, 'height': 1080}, service_workers='block')
        context.add_init_script("localStorage.setItem('notes_app_access_token','ocr-test')")
        requests, delayed, errors = [], [], []
        state = {'mode': 'ok'}
        def api(route):
            request = route.request
            headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                       'Access-Control-Allow-Methods': '*'}
            if request.method == 'OPTIONS':
                route.fulfill(status=200, headers=headers)
                return
            if request.url.endswith('/api/image-ocr'):
                requests.append(request)
                assert request.headers['authorization'] == 'Bearer ocr-test'
                assert b'ocr-book' in request.post_data_buffer
                if state['mode'] == 'delayed':
                    delayed.append(route)
                    return
                status, result = (503, {'detail': '文字识别暂时不可用'}) if state['mode'] == 'fail' else (
                    200, {'text': '2018年游客规模\nA.减少了30万人次以上\nB.增加了30万人次以内', 'engine': 'mineru-ocr'})
            else:
                status, result = 200, {'items': []}
            route.fulfill(status=status, headers=headers, content_type='application/json', body=json.dumps(result))
        context.route('http://localhost:8000/**', api)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto('http://127.0.0.1:5173/tests/e2e/fixtures/image_text.html')
            question = page.locator('[data-panel-id="question"] [contenteditable=true]')
            material = page.locator('[data-panel-id="material"] [contenteditable=true]')
            expect(question).to_contain_text('前文后文')
            dialog = page.get_by_test_id('image-text-modal')

            def open_question():
                question.click()
                page.locator('input[type=file]').nth(1).set_input_files(PNG)
                expect(page.get_by_role('button', name='下一步：转文字')).to_be_visible()
                page.get_by_role('button', name='跳过裁剪', exact=True).click()
                expect(dialog).to_be_visible()

            # Saved caret, editable text, safe text insertion and no unwanted source image.
            question.click()
            question.evaluate("el => {const r=document.createRange();r.setStart(el.firstChild.firstChild,2);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r)}")
            with page.expect_file_chooser() as chooser:
                page.locator('#shared-image-tools button[title="导入图片"]').nth(1).click()
            chooser.value.set_files(PNG)
            page.get_by_role('button', name='跳过裁剪', exact=True).click()
            expect(dialog.locator('textarea')).to_have_value('2018年游客规模\nA.减少了30万人次以上\nB.增加了30万人次以内')
            expect(dialog.get_by_label('同时保留原图')).not_to_be_checked()
            dialog.locator('textarea').fill('校对后的文字<script>alert(1)</script>\nD.增加了30万人次以内')
            dialog.get_by_role('button', name='插入文字', exact=True).click()
            expect(dialog).to_have_count(0)
            expect(question).to_contain_text('前文校对后的文字<script>alert(1)</script>')
            expect(question).to_contain_text('后文')
            expect(question.locator('script, img')).to_have_count(0)

            # Failed OCR can retry without modifying the editor before confirmation.
            old = question.inner_html()
            state['mode'] = 'fail'
            open_question()
            expect(dialog.get_by_role('alert')).to_contain_text('文字识别暂时不可用')
            expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_disabled()
            assert question.inner_html() == old
            state['mode'] = 'ok'
            dialog.get_by_role('button', name='重新识别').click()
            expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_enabled()
            dialog.get_by_role('button', name='取消', exact=True).click()
            assert question.inner_html() == old

            # Material keeps the graph image by default; words are still editable.
            material.click()
            page.locator('input[type=file]').nth(0).set_input_files(PNG)
            page.get_by_role('button', name='下一步：转文字', exact=True).click()
            expect(dialog.get_by_label('同时保留原图')).to_be_checked()
            expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_enabled()
            dialog.get_by_role('button', name='插入文字', exact=True).click()
            expect(material).to_contain_text('2018年游客规模')
            expect(material.locator('img')).to_have_count(1)

            # Both answer panels use the same OCR stage.
            for panel in ('wrong', 'correct'):
                answer = page.locator(f'[data-panel-id="{panel}"] [contenteditable=true]')
                answer.click()
                page.locator('#shared-image-tools input[type=file]').nth(2 if panel == 'wrong' else 3).set_input_files(PNG)
                expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_enabled()
                dialog.get_by_role('button', name='插入文字', exact=True).click()
                expect(answer).to_contain_text('2018年游客规模')
                expect(answer.locator('img')).to_have_count(0)

            # A late result after cancellation or switching cannot write into another entry.
            state['mode'] = 'delayed'
            open_question()
            expect(dialog.get_by_role('status')).to_be_visible()
            expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_disabled()
            page.locator('#switch-entry').dispatch_event('click')
            expect(dialog).to_have_count(0)
            expect(question).to_have_text('前文后文')
            for route in delayed:
                route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'},
                    content_type='application/json', body=json.dumps({'text': '不能串题的旧结果', 'engine': 'mineru-ocr'}))
            delayed.clear()
            expect(question).not_to_contain_text('不能串题的旧结果')
            state['mode'] = 'ok'
            open_question()
            expect(dialog.get_by_role('button', name='插入文字', exact=True)).to_be_enabled()
            dialog.get_by_role('button', name='仅插入图片').click()
            expect(question.locator('img')).to_have_count(1)
            expect(question).not_to_contain_text('2018年游客规模')
            page.screenshot(path='.dev-services/image-text-insert-test.png')
            assert requests and not errors, errors
            print('PASS: crop to OCR, edit and caret, literal text, retry/cancel, shared chart, both answers, switch guard and image fallback')
        finally:
            context.close()
            browser.close()


if __name__ == '__main__':
    run()
