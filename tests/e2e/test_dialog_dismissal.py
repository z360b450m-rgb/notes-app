"""Native dialog dismissal with real mouse/touch input; requires Vite on port 5173."""
import os

from playwright.sync_api import expect, sync_playwright


HARNESS = '''<html><head><meta charset="UTF-8"></head><body><div id="app"></div>
<script type="module">
import KnowledgeLibraryDialog from '/src/components/KnowledgeLibraryDialog.vue';
import PdfImportDialog from '/src/components/PdfImportDialog.vue';
import EntryLearningHistoryDialog from '/src/components/EntryLearningHistoryDialog.vue';
import '/src/style.css';
import '/src/ui-theme.css';
import '/src/review-ui.css';
const source = await (await fetch('/src/components/PdfImportDialog.vue')).text();
const vueUrl = source.match(/from "([^"]*\\/vue\\.js[^"]*)"/)[1];
const {createApp, h, ref} = await import(vueUrl);
createApp({setup() {
  const current = ref(null);
  const loading = ref(false);
  const components = {
    knowledge: KnowledgeLibraryDialog,
    pdf: PdfImportDialog,
    history: EntryLearningHistoryDialog,
  };
  const props = {
    knowledge: {mode:'manage', libraries:[], selected:[], error:'', importing:false,
      importProgress:'', importResults:[]},
    pdf: {progress:'', error:'', result:null},
    history: {title:'测试题目', turns:[], canRetry:false, canClear:false},
  };
  window.test = {setBusy(value) {loading.value = value}};
  return () => h('main', [
    ...Object.keys(components).map(key => h('button', {
      onClick: () => current.value = key,
    }, '打开 ' + key)),
    current.value && h(components[current.value], {
      ...props[current.value], loading:loading.value, onClose:() => current.value = null,
    }),
  ]);
}}).mount('#app');
</script></body></html>'''


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            for width, height in ((1280, 900), (390, 844)):
                context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=True)
                context.route('**/__dialog_regression__', lambda route: route.fulfill(
                    content_type='text/html', body=HARNESS))
                context.route('https://**', lambda route: route.abort())
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto('http://127.0.0.1:5173/__dialog_regression__')
                dialog = page.get_by_role('dialog')
                for name, close_label in (
                    ('knowledge', '关闭知识库'), ('pdf', '取消'), ('history', '关闭对话历史')):
                    opener = page.get_by_role('button', name='打开 ' + name, exact=True)
                    opener.click()
                    expect(dialog).to_be_visible()
                    dialog.click(position={'x': 4, 'y': 4})
                    expect(dialog).to_be_visible()
                    bounds = dialog.bounding_box()
                    inside = (bounds['x'] + 4, bounds['y'] + 4)
                    # Both drag directions can produce a click targeted at the dialog.
                    for start, end in ((inside, (2, 2)), ((2, 2), inside)):
                        page.mouse.move(*start)
                        page.mouse.down()
                        page.mouse.move(*end)
                        page.mouse.up()
                        expect(dialog).to_be_visible()
                    page.mouse.click(2, 2, button='right')
                    expect(dialog).to_be_visible()
                    if name == 'pdf':
                        page.evaluate('window.test.setBusy(true)')
                        page.mouse.click(2, 2)
                        page.keyboard.press('Escape')
                        expect(dialog).to_be_visible()
                        page.evaluate('window.test.setBusy(false)')
                    page.mouse.click(2, 2)
                    expect(dialog).to_have_count(0)
                    opener.click()
                    page.keyboard.press('Escape')
                    expect(dialog).to_have_count(0)
                    opener.focus()
                    page.keyboard.press('Enter')
                    expect(dialog).to_be_visible()
                    dialog.get_by_role('button', name=close_label, exact=True).click()
                    expect(dialog).to_have_count(0)
                    opener.tap()
                    expect(dialog).to_be_visible()
                    bounds = dialog.bounding_box()
                    page.touchscreen.tap(bounds['x'] + 4, bounds['y'] + 4)
                    expect(dialog).to_be_visible()
                    page.touchscreen.tap(2, 2)
                    expect(dialog).to_have_count(0)
                assert not errors, errors
                context.close()
            print('PASS: all three native dialogs preserve content clicks/drags, mouse/touch/keyboard dismissal and PDF busy guard')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
