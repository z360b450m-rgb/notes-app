const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright')

async function run() {
  const { createServer } = await import('vite')
  const source = String.raw`<p><strong>计算</strong> $\frac{1}{2}$ 与 \(x^2\)。</p><p>\[a+b=c\]</p><p>$$\sqrt{4}=2$$</p><pre>$code$</pre>`
  const image =
    '<img alt="测试图" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:120px;height:60px">'
  const code = `
    import { createApp, h, reactive, provide, ref } from 'vue'
    import NoteEditor from '/src/components/NoteEditor.vue'
    import { sanitizeHtml } from '/src/utils/sanitize.ts'
    import { restoreEditorMath } from '/src/utils/editorMath.ts'
    import '/src/style.css'
    import '/src/ui-theme.css'
    import '/src/workspace-ui.css'
    import '/src/interaction-ui.css'
    import 'katex/dist/katex.min.css'
    createApp({setup() {
      provide('toast', () => {})
      provide('drawingEnabled', ref(false))
      const source = ${JSON.stringify(source)}
      const image = ${JSON.stringify(image)}
      const state = reactive({ updates: 0, group: { id: 'group', notebookId: 'math-test', title: '材料', material: source, createdAt: 1, updatedAt: 1 },
        entry: { id: 'one', notebookId: 'math-test', title: '公式题', question: source + image,
          wrongAnswer: source, correctAnswer: source, subject: '', source: '', tags: [], createdAt: 1, updatedAt: 1 } })
      window.mathQA = { state, source, image, sanitizeHtml,
        serialized: (panel) => {
          const clone = document.querySelector('[data-panel-id="' + panel + '"] .panel-body').cloneNode(true)
          restoreEditorMath(clone)
          return clone.innerHTML
        },
      }
      return () => h('div', { class: 'workspace-ui', style: 'height:100vh;display:flex;flex-direction:column' }, [
        h('button', { id: 'outside', style: 'flex-shrink:0' }, '结束编辑'),
        h('main', {class:'workspace-main', style:'display:flex;min-height:0;flex:1'}, [h(NoteEditor, {
          entry: state.entry, group: state.group, groupEntries: [state.entry], entries: [state.entry], answersHidden: false,
          onUpdate: () => state.updates++,
        })]),
      ])
    }}).mount('#app')
  `
  const server = await createServer({
    root: path.resolve(__dirname, '../..'),
    appType: 'custom',
    cacheDir: path.join(os.tmpdir(), 'renote-math-tools-vite'),
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'math-tools-fixture',
        resolveId: (id) => (id === '/__math_entry.js' ? id : undefined),
        load: (id) => (id === '/__math_entry.js' ? code : undefined),
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__math_qa') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
              '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="/__math_entry.js"></script></body></html>',
            )
          })
        },
      },
    ],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('Page error:', error.message)
    })
    await page.route('http://localhost:8000/**', (route) => route.fulfill({ json: [] }))
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__math_qa')
    await page.waitForFunction(() => !!window.mathQA)
    const panel = (id) => page.locator('[data-panel-id="' + id + '"] .panel-body')
    for (const id of ['material', 'question', 'wrong', 'correct']) {
      await panel(id).locator('.katex').first().waitFor()
      assert.equal(await panel(id).locator('.katex').count(), 4)
      assert.equal(await panel(id).locator('pre').innerText(), '$code$')
      assert.equal(
        await page.evaluate((id) => window.mathQA.serialized(id), id),
        source + (id === 'question' ? image : ''),
      )
    }
    assert.equal(
      await page.evaluate(() => window.mathQA.state.updates),
      0,
      'Preview must not mark a note dirty',
    )
    await panel('correct').locator('.editor-math').first().click()
    assert.equal(await page.locator('.editor-formatting-group > span').innerText(), '正确答案')
    await page.locator('#outside').click()
    await panel('correct').locator('.editor-math').first().waitFor()
    const formula = panel('question').locator('.editor-math').first()
    await formula.click()
    assert.equal(await panel('question').locator('.katex').count(), 0)
    assert.equal(await page.evaluate(() => getSelection().toString()), String.raw`$\frac{1}{2}$`)
    await page.locator('#outside').click()
    await formula.waitFor()
    assert.equal(await page.evaluate(() => window.mathQA.state.updates), 0)

    // Formatting must preserve TeX and the inline HTML while using the existing editor.
    await panel('question').click({ position: { x: 15, y: 15 } })
    await panel('question').press('Control+End')
    await page.keyboard.type('补充条件')
    await page.locator('#outside').click()
    await panel('question').locator('.katex').first().waitFor()
    const stored = await page.evaluate(() => window.mathQA.state.entry.question)
    assert(stored.includes(String.raw`$\frac{1}{2}$`) && stored.includes('补充条件'))
    assert(!stored.includes('katex') && !stored.includes('data-editor-math-source'))
    assert(stored.includes('<strong>计算</strong>'))

    const size = page.getByRole('combobox', { name: '调整图片大小', exact: true })
    assert.equal(await size.count(), 0)
    await panel('question').getByAltText('测试图').click()
    await size.waitFor()
    await size.click()
    await page.getByRole('option', { name: '50%', exact: true }).click()
    assert.equal(
      await panel('question')
        .getByAltText('测试图')
        .evaluate((el) => el.style.width),
      '50%',
    )
    assert(!(await page.evaluate(() => window.mathQA.state.entry.question)).includes('katex'))

    const insert = page.getByRole('button', { name: '插入图片', exact: true })
    assert.equal(await page.getByRole('menuitem', { name: '截屏', exact: true }).count(), 0)
    await insert.click()
    await page.getByRole('menuitem', { name: '截屏', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: '导入图片', exact: true }).waitFor()
    await insert.press('Escape')
    assert.equal(await insert.getAttribute('aria-expanded'), 'false')
    await insert.focus()
    await insert.press('ArrowDown')
    assert.equal(
      await page
        .getByRole('menuitem', { name: '截屏', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    )
    await page.keyboard.press('Escape')

    for (const id of ['material', 'wrong', 'correct']) {
      await panel(id).click({ position: { x: 12, y: 12 } })
      await insert.click()
      await page.getByRole('menuitem', { name: '截屏', exact: true }).waitFor()
      await page.getByRole('menuitem', { name: '导入图片', exact: true }).waitFor()
      await insert.click()
    }

    const more = page.getByRole('button', { name: '更多编辑选项', exact: true })
    assert.equal(await page.getByTestId('panel-layout-toggle').isVisible(), false)
    await more.click()
    await page.getByTestId('panel-layout-toggle').click()
    assert.equal(
      await page
        .locator('.editor-layout')
        .getAttribute('class')
        .then((value) => value.includes('layout-editing')),
      true,
    )
    await more.click()
    await page.getByTestId('panel-layout-toggle').click()
    await page.locator('#outside').click()

    const safe = await page.evaluate(() =>
      window.mathQA.sanitizeHtml(
        '<p>$x^2$<img src=x onerror="alert(1)"><script>alert(2)</script></p>',
      ),
    )
    assert(safe.includes('katex') && !safe.includes('onerror') && !safe.includes('<script'))
    const invalid = await page.evaluate(() =>
      window.mathQA.sanitizeHtml(String.raw`<p>$\notARealCommand{x}$，未结束 $x 与价格 \$5</p>`),
    )
    assert(invalid.includes('notARealCommand') && !invalid.includes('katex-error'))
    for (const width of [858, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await panel('material').locator('.katex').first().waitFor()
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Toolbar or formula overflows the page',
      )
    }
    assert.deepEqual(errors, [])
    console.log(
      'Math/tools passed: four delimiters in all fields, safe readonly rendering, source round trip, edit/preview without dirtying, image resizing, conditional controls, insertion and layout menus, keyboard, 858/390px.',
    )
  } finally {
    await browser.close()
    await server.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
