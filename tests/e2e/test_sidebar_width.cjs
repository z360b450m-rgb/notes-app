const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { chromium } = require('playwright')

async function run() {
  const root = path.resolve(__dirname, '../..')
  const script = buildSync({
    stdin: {
      resolveDir: root,
      contents: `
    import { createApp, h } from 'vue'
    import { useSidebarWidth } from './src/composables/useSidebarWidth'
    createApp({setup() {
      const f=useSidebarWidth(); window.widthState=f
      return ()=>h('div', {class:'sidebar-hover-host', style:{'--sidebar-width': f.sidebarWidth.value+'px'},
        'data-resizing': f.resizingSidebar.value}, [h('aside'), h('div', {id:'edge', role:'separator', tabindex:0,
        style:'position:absolute;right:-4px;top:0;bottom:0;width:8px;cursor:col-resize',
        onPointerdown:f.startSidebarResize,onPointermove:f.moveSidebarResize,onPointerup:f.stopSidebarResize,
        onPointercancel:f.stopSidebarResize,onLostpointercapture:f.stopSidebarResize,onKeydown:f.resizeSidebarByKey})])
    }}).mount('#app')`,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
  }).outputFiles[0].text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.route('http://sidebar.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    async function mount() {
      await page.goto('http://sidebar.test/')
      await page.addStyleTag({
        content:
          fs.readFileSync(path.join(root, 'src/ui-theme.css'), 'utf8') +
          '#app .sidebar-hover-host {height:700px;transition:none} #app .sidebar-hover-host > aside {transition:none}',
      })
      await page.addScriptTag({ content: script })
    }
    await mount()
    const width = () => page.locator('aside').evaluate((e) => e.getBoundingClientRect().width)
    assert.equal(await width(), 280)
    assert.equal(
      await page.locator('#edge').evaluate((e) => getComputedStyle(e).cursor),
      'col-resize',
    )
    async function drag(delta) {
      const box = await page.locator('#edge').boundingBox()
      await page.mouse.move(box.x + box.width / 2, 200)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + delta, 200, { steps: 5 })
      await page.mouse.up()
    }
    await drag(90)
    assert.equal(await width(), 370)
    assert.equal(await page.evaluate(() => document.body.style.cursor), '')
    await mount()
    assert.equal(await width(), 370)
    await drag(1000)
    assert.equal(await width(), 480)
    await drag(-1000)
    assert.equal(await width(), 220)
    await page.locator('#edge').focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await width(), 230)
    await page.keyboard.press('Home')
    assert.equal(await width(), 280)
    console.log(
      'Sidebar width checks passed: invisible edge, drag, limits, persistence, keyboard, cursor cleanup.',
    )
  } finally {
    await browser.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
