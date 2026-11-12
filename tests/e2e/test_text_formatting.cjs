// NODE_PATH may point to the bundled runtime's node_modules for Playwright.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { chromium } = require('playwright')

async function run() {
  const root = path.resolve(__dirname, '../..')
  const result = await build({
    stdin: {
      contents: `import { createApp, h } from 'vue'
        import Controls from './src/components/RichTextSizeControls.vue'
        import { useRichTextSizing } from './src/composables/useRichTextSizing'
        createApp({setup() {
          const f = useRichTextSizing(() => document.querySelector('#editor'), () => {})
          window.formatting = f
          return () => h(Controls, {
            imageSelected: false, imageWidth: 'auto', textSelected: f.hasTextSelection.value,
            bold: f.isBold.value, boldMixed: f.boldMixed.value, highlightColor: f.highlightColor.value,
            onPreserveSelection: f.captureSelection, onToggleBold: f.toggleBold, onHighlight: f.applyHighlight,
          })
        }}).mount('#toolbar')`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    alias: { '@': path.join(root, 'src') },
    write: false,
    format: 'iife',
    plugins: [
      {
        name: 'vue',
        setup(builder) {
          builder.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
            const { descriptor } = parse(fs.readFileSync(filename, 'utf8'))
            return {
              contents: compileScript(descriptor, { id: 'test-controls', inlineTemplate: true })
                .content,
              loader: 'ts',
              resolveDir: path.dirname(filename),
            }
          })
        },
      },
    ],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="toolbar"></div><div id="editor" contenteditable="true"></div>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    async function select(html, start, end) {
      await page.evaluate(
        ({ html, start, end }) => {
          const editor = document.querySelector('#editor')
          if (html !== null) {
            editor.innerHTML = html
            window.formatting.resetSizingState()
          }
          editor.focus()
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
          const nodes = []
          let node
          while ((node = walker.nextNode())) nodes.push(node)
          const locate = (offset) => {
            for (const n of nodes) {
              if (offset <= n.length) return [n, offset]
              offset -= n.length
            }
            return [editor, editor.childNodes.length]
          }
          const range = document.createRange()
          range.setStart(...locate(start))
          range.setEnd(...locate(end))
          getSelection().removeAllRanges()
          getSelection().addRange(range)
          window.formatting.captureSelection()
        },
        { html, start, end },
      )
    }
    const bold = page.getByRole('button', { name: '切换加粗', exact: true })
    const pen = page.getByRole('button', { name: '切换荧光笔', exact: true })
    const palette = page.getByRole('button', { name: '选择荧光颜色', exact: true })
    const state = () =>
      page.evaluate(() => ({
        bold: window.formatting.isBold.value,
        mixed: window.formatting.boldMixed.value,
        color: window.formatting.highlightColor.value,
        html: window.formatting.serializeHtml(),
        selected: getSelection().toString(),
        text: document.querySelector('#editor').textContent,
      }))

    await select('普通文字', 4, 4)
    await palette.click()
    await page.getByRole('button', { name: '蓝色', exact: true }).click()
    await page.waitForTimeout(100)
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal(await pen.getAttribute('aria-pressed'), 'true')
    assert.equal((await state()).color, '#bfdbfe')
    await bold.click()
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal(await pen.getAttribute('aria-pressed'), 'true')
    await pen.click()
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal(await pen.getAttribute('aria-pressed'), 'false')
    await select(null, 0, 0)
    await palette.click()
    await page.getByRole('button', { name: '黄色', exact: true }).click()

    await select('<strong>函数的</strong>最大值', 0, 6)
    assert.equal((await state()).mixed, true)
    await bold.click()
    assert.equal((await state()).bold, true)
    assert.equal((await state()).mixed, false)
    assert.equal((await state()).selected, '函数的最大值')
    await bold.click()
    assert.equal((await state()).bold, false)
    await page.keyboard.press('Control+z')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).bold, true)

    await select('<span style="background-color:#fff59d">函数的</span>最大值', 0, 6)
    assert.equal((await state()).color, 'mixed')
    await pen.click()
    assert.equal((await state()).color, '#fff59d')
    await pen.click()
    assert.equal((await state()).color, 'transparent')
    await palette.click()
    await page.getByRole('button', { name: '绿色', exact: true }).click()
    assert.equal((await state()).color, '#bbf7d0')
    assert.equal((await state()).selected, '函数的最大值')
    await pen.click()
    await pen.click()
    assert.equal((await state()).color, '#bbf7d0')
    await page.keyboard.press('Control+z')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).color, 'transparent')

    await select('前文', 2, 2)
    await bold.click()
    await page.keyboard.type('B')
    assert.match((await state()).html, /<strong>B<\/strong>/)
    await page.evaluate(() => window.formatting.captureSelection())
    await bold.click()
    await page.keyboard.type('N')
    assert.equal((await state()).text, '前文BN')
    assert.doesNotMatch((await state()).html, /<strong>BN/)
    await palette.click()
    await page.getByRole('button', { name: '蓝色', exact: true }).click()
    await page.keyboard.type('H')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).color, '#bfdbfe')
    await pen.click()
    await page.keyboard.type('C')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).color, 'transparent')
    assert.equal((await state()).text, '前文BNHC')
    assert.doesNotMatch((await state()).html, /\u200B/)

    await select('<strong><span style="background-color:#fff59d">前后</span></strong>', 1, 1)
    await pen.click()
    await page.keyboard.type('X')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).color, 'transparent')
    assert.equal((await state()).bold, true)
    assert.equal((await state()).text, '前X后')
    await select(null, 0, 1)
    assert.equal((await state()).color, '#fff59d')
    await select(null, 2, 3)
    assert.equal((await state()).color, '#fff59d')

    await select('<span style="background-color:#fff59d">前后</span>', 1, 1)
    await pen.click()
    await bold.click()
    await page.keyboard.type('Y')
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).color, 'transparent')
    assert.equal((await state()).bold, true)

    await select('<span style="background-color:#fff59d">前后</span>', 1, 1)
    await pen.click()
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', '粘贴\n文字')
      document
        .querySelector('#editor')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        )
    })
    assert.equal((await state()).color, 'transparent')
    assert.equal((await state()).text, '前粘贴文字后')

    await select('<span style="background-color:#fff59d">前后</span>', 1, 1)
    await pen.click()
    await page.evaluate(() =>
      document
        .querySelector('#editor')
        .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    )
    const session = await page.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', {
      text: '中文',
      selectionStart: 2,
      selectionEnd: 2,
    })
    await session.send('Input.insertText', { text: '中文' })
    await page.evaluate(() => window.formatting.captureSelection())
    assert.equal((await state()).text, '前中文后')
    assert.equal((await state()).color, 'transparent')
    await session.detach()

    await select('前文', 2, 2)
    await page.evaluate(() => window.formatting.insertInternalLink('target', '关联题目'))
    await page.keyboard.type('after')
    assert.equal(await page.locator('#editor a').textContent(), '关联题目')
    assert.equal((await state()).text, '前文关联题目after')
    await select('选中文字', 0, 4)
    await page.evaluate(() => window.formatting.insertInternalLink('target', '关联题目'))
    await page.keyboard.type('后续')
    assert.equal(await page.locator('#editor a').textContent(), '选中文字')
    assert.equal((await state()).text, '选中文字后续')
    await select('<a data-entry-link="target">链接</a>', 2, 2)
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', '粘贴后文')
      document
        .querySelector('#editor')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        )
    })
    assert.equal(await page.locator('#editor a').textContent(), '链接')
    assert.equal((await state()).text, '链接粘贴后文')
    await select('<a data-entry-link="target">链接</a>', 2, 2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('newline')
    assert.equal(await page.locator('#editor a').count(), 1)
    assert.equal(await page.locator('#editor a').textContent(), '链接')
    await select('<a data-entry-link="target"><strong>链接</strong></a>', 2, 2)
    await page.keyboard.type('tail')
    assert.equal(await page.locator('#editor a').textContent(), '链接')
    await page.keyboard.press('Control+z')
    assert.equal(await page.locator('#editor a').textContent(), '链接')
    await select('<a data-entry-link="target">链接</a>', 1, 1)
    await page.keyboard.type('inside')
    assert.equal(await page.locator('#editor a').textContent(), '链inside接')

    await select('<a data-entry-link="target">链接</a>', 2, 2)
    const ime = await page.context().newCDPSession(page)
    await ime.send('Input.imeSetComposition', { text: '后文', selectionStart: 2, selectionEnd: 2 })
    await ime.send('Input.insertText', { text: '后文' })
    assert.equal(await page.locator('#editor a').textContent(), '链接')
    assert.equal((await state()).text, '链接后文')
    await ime.detach()

    await select('快捷键', 0, 3)
    await page.keyboard.press('Control+b')
    await page.waitForFunction(() => window.formatting.isBold.value)
    await select(null, 0, 0)
    await palette.click()
    await page.keyboard.press('Escape')
    assert.equal(await palette.getAttribute('aria-expanded'), 'false')
    if (process.env.FORMATTING_TEST_SCREENSHOT) {
      const assets = path.join(root, 'dist/assets')
      const css = fs.readdirSync(assets).find((name) => name.endsWith('.css'))
      await page.addStyleTag({ content: fs.readFileSync(path.join(assets, css), 'utf8') })
      await page.addStyleTag({
        content: '#toolbar {padding:16px} #editor {padding:24px;min-height:160px}',
      })
      await page.setViewportSize({ width: 736, height: 420 })
      await select('<strong>函数的</strong>最大值', 0, 6)
      await palette.click()
      await page.screenshot({ path: process.env.FORMATTING_TEST_SCREENSHOT })
      await page.setViewportSize({ width: 360, height: 420 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      )
    }
    console.log(
      'Text formatting checks passed: mixed selection, palette, typing, paste, IME, Ctrl+B, undo, Escape, link boundaries.',
    )
  } finally {
    await browser.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
