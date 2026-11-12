const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright')

async function run() {
  const { createServer } = await import('vite')
  const root = path.resolve(__dirname, '../..')
  const code = `
    import { createApp, h, provide, ref } from 'vue'
    import NotebookMenu from '/src/components/NotebookMenu.vue'
    import { createReviewAgentChats, reviewAgentChatsKey } from '/src/composables/useReviewAgentChats.ts'
    import '/src/style.css'
    import '/src/ui-theme.css'
    import '/src/review-ui.css'
    import '/src/interaction-ui.css'
    createApp({setup() {
      provide(reviewAgentChatsKey, createReviewAgentChats())
      const visible = ref(true)
      window.historyNavigation = {
        leave: () => { visible.value = false },
        returnToReview: () => { visible.value = true },
      }
      return () => visible.value
        ? h(NotebookMenu, { initialNav: 'review' })
        : h('div', { id: 'question-workspace' }, '错题工作区')
    }}).mount('#app')
  `
  const server = await createServer({
    root,
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'review-history-navigation-fixture',
        resolveId(id) {
          if (id === '/__history_entry.js') return id
        },
        load(id) {
          if (id === '/__history_entry.js') return code
        },
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__history_navigation') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end('<div id="app"></div><script type="module" src="/__history_entry.js"></script>')
          })
        },
      },
    ],
  })
  await server.listen()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:8000/**', (route) =>
      route.fulfill({
        json: { items: [], subjects: [], reviewDays: [] },
      }),
    )
    const key = 'review-agent-chats-v1:local'
    const saved = {
      activeId: 'saved-chat',
      chats: [
        {
          id: 'saved-chat',
          title: '保留的复习对话',
          updatedAt: 1000,
          titleSource: 'manual',
          messages: [
            { role: 'user', text: '之前的提问', choices: [] },
            { role: 'assistant', text: '之前的回复仍在', choices: [] },
          ],
        },
      ],
    }
    await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
      key,
      saved,
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__history_navigation`)
    const sidebar = page.locator('.notebook-navigation')
    const history = sidebar.getByRole('complementary', { name: '聊天记录', exact: true })
    const assertHistory = async () => {
      await history.waitFor({ state: 'visible', timeout: 5000 })
      await history.getByRole('button', { name: '聊天操作：保留的复习对话' }).waitFor()
      await history.getByRole('button', { name: /新对话/ }).waitFor()
      await page.getByText('之前的回复仍在', { exact: true }).waitFor()
    }
    await assertHistory()
    await sidebar.getByRole('button', { name: '首页', exact: true }).click()
    await history.waitFor({ state: 'detached' })
    await sidebar.getByRole('button', { name: '开始复习', exact: true }).click()
    await assertHistory()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => window.historyNavigation.leave())
      await page.locator('#question-workspace').waitFor()
      // Leaving page transitions may temporarily retain an old target with this ID.
      await page.evaluate(() => {
        const oldTarget = document.createElement('div')
        oldTarget.id = 'review-agent-navigation'
        oldTarget.dataset.staleHistoryTarget = 'true'
        document.body.prepend(oldTarget)
        window.historyNavigation.returnToReview()
      })
      await assertHistory()
      assert.equal(await page.locator('[data-stale-history-target] .agent-history').count(), 0)
      await page.evaluate(() => document.querySelector('[data-stale-history-target]').remove())
    }
    const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
    assert.equal(after.activeId, saved.activeId)
    assert.deepEqual(after.chats[0].messages, saved.chats[0].messages)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: initial review, tab switch and return from workspace show saved history on desktop/mobile without targeting a leaving page.',
    )
  } finally {
    await browser?.close()
    await server.close()
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
