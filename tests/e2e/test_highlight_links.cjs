// Run with Playwright available on NODE_PATH; no backend or dev server required.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const script = buildSync({
  stdin: {
    contents: `
      import { createApp } from 'vue'
      import { useRichTextSizing } from './src/composables/useRichTextSizing'
      createApp({ setup() {
        window.formatting = useRichTextSizing(() => document.querySelector('#editor'), () => {})
        return () => null
      }}).mount('#harness')
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
}).outputFiles[0].text

async function run() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.HIGHLIGHT_TEST_BROWSER
      ? { executablePath: process.env.HIGHLIGHT_TEST_BROWSER }
      : {}),
  })
  try {
    const page = await browser.newPage()
    await page.setContent(
      `<style>${fs.readFileSync(path.join(root, 'src/style.css'), 'utf8')}</style>
       <div id="harness"></div><div id="editor" class="md-content" contenteditable="true"></div>`,
    )
    await page.addScriptTag({ content: script })
    for (const dark of [false, true]) {
      for (const partial of [false, true]) {
        const result = await page.evaluate(
          ({ dark, partial }) => {
            document.documentElement.classList.toggle('dark', dark)
            const editor = document.querySelector('#editor')
            editor.innerHTML =
              '前文<a data-entry-link="question-1"><strong>链接文字</strong></a>后文'
            const link = editor.querySelector('a')
            const select = (start, end) => {
              const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT)
              const node = walker.nextNode()
              const range = document.createRange()
              range.setStart(node, start)
              range.setEnd(node, end)
              editor.focus()
              getSelection().removeAllRanges()
              getSelection().addRange(range)
              window.formatting.captureSelection()
            }
            const colors = () =>
              [link, ...link.querySelectorAll('*')].map(
                (element) => getComputedStyle(element).color,
              )
            select(0, 4)
            window.formatting.applyHighlight('#fff59d')
            const highlightedColors = colors()
            select(0, partial ? 2 : 4)
            window.formatting.applyHighlight('transparent')
            return {
              highlightedColors,
              clearedColors: colors(),
              html: window.formatting.serializeHtml(),
              text: editor.textContent,
              target: link.dataset.entryLink,
              staleHighlights: [...editor.querySelectorAll('.text-highlight')].some(
                (element) => !element.style.backgroundColor,
              ),
            }
          },
          { dark, partial },
        )
        const expected = dark ? 'rgb(96, 165, 250)' : 'rgb(37, 99, 235)'
        assert.ok(result.highlightedColors.every((color) => color === expected))
        assert.ok(result.clearedColors.every((color) => color === expected))
        assert.equal(result.target, 'question-1')
        assert.equal(result.text, '前文链接文字后文')
        assert.match(result.html, /<strong\b/)
        assert.equal(result.staleHighlights, false)
        if (partial) assert.match(result.html, /background-color/)
        else assert.doesNotMatch(result.html, /background-color|text-highlight/)
      }
    }
    console.log('Highlight link regression checks passed (light/dark, full/partial clear).')
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
