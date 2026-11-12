// Run with Vite on port 5173 and Playwright available on NODE_PATH.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

async function run() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/panel-resizer-test', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<html><body><div id="app" style="height:950px;display:flex"></div>
      <script type="module">
        import NoteEditor from '/src/components/NoteEditor.vue'
        import '/src/style.css'
        import '/src/ui-theme.css'
        const source = await (await fetch('/src/components/NoteEditor.vue')).text()
        const vueUrl = source.split('"').find((value) => value.startsWith('/node_modules/') && value.includes('/vue.js'))
        const { createApp, reactive, h } = await import(vueUrl)
        const entry = { id: 'test', notebookId: 'test', title: 'Test', question: '',
          wrongAnswer: '', correctAnswer: '', subject: '', source: '', tags: [],
          createdAt: 0, updatedAt: 0 }
        window.state = reactive({ group: null })
        createApp({ render: () => h(NoteEditor, { entry, entries: [entry],
          group: window.state.group, groupEntries: [entry], answersHidden: false }) }).mount('#app')
      </script></body></html>`,
    }))
    await page.goto('http://127.0.0.1:5173/panel-resizer-test')
    const separator = (name) => page.getByTestId(`panel-resizer-${name}`)
    const question = page.getByTestId('panel-module-question')
    await question.waitFor({ state: 'visible' })
    const compactBox = await question.boundingBox()
    assert(compactBox.height <= 150, 'Default question wastes vertical space')
    const heightToggle = page.getByTestId('question-height-toggle')
    await heightToggle.click()
    await page.waitForFunction(() => document.querySelector('[data-panel-id="question"]').getBoundingClientRect().height > 200)
    await heightToggle.click()
    await page.waitForFunction(() => document.querySelector('[data-panel-id="question"]').getBoundingClientRect().height <= 150)
    if (process.env.PANEL_TEST_SCREENSHOT) await page.screenshot({ path: process.env.PANEL_TEST_SCREENSHOT })
    async function checkAndDrag(name, axis) {
      const handle = separator(name)
      await handle.waitFor({ state: 'visible' })
      const box = await handle.boundingBox()
      assert(box && box.width > 0 && box.height > 0, `${name} has no size`)
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      assert(await handle.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)),
        { x, y }), `${name} is covered by a panel`)
      const before = await page.locator('.editor-layout').getAttribute('style')
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + (axis === 'x' ? 60 : 0), y + (axis === 'y' ? 40 : 0))
      await page.mouse.up()
      await page.waitForFunction((before) => document.querySelector('.editor-layout').getAttribute('style') !== before, before)
      const after = await page.locator('.editor-layout').getAttribute('style')
      assert.notEqual(after, before, `${name} did not resize`)
    }
    await checkAndDrag('primary-row', 'y')
    await checkAndDrag('secondary-column', 'x')
    // Enable a group without refreshing or remounting the editor.
    await page.evaluate(() => {
      window.state.group = { id: 'group', notebookId: 'test', title: 'Group',
        material: '', createdAt: 0, updatedAt: 0 }
    })
    await checkAndDrag('primary-column', 'x')
    await checkAndDrag('primary-row', 'y')
    await checkAndDrag('secondary-column', 'x')
    await page.getByTestId('panel-layout-toggle').click()
    await page.getByTestId('panel-layout-toggle').click()
    await checkAndDrag('primary-column', 'x')
    await page.evaluate(() => { window.state.group = null })
    await separator('primary-column').waitFor({ state: 'detached' })
    await checkAndDrag('primary-row', 'y')
    await page.setViewportSize({ width: 900, height: 1000 })
    await separator('primary-row').waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [], 'Editor raised runtime errors')
    console.log('Compact question, expand/collapse, group switches, layout toggle, dragging and mobile passed.')
  } finally {
    await browser.close()
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
