const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright')

// Isolated data and controllable storage: never edits the signed-in user's notes.
async function run() {
  const { createServer } = await import('vite')
  const code = `
    import { createApp, h, reactive, provide } from 'vue'
    import Workspace from '/src/components/Workspace.vue'
    import AppToast from '/src/components/AppToast.vue'
    import { useEntries } from '/src/composables/useEntries.ts'
    import { entryRepository } from '/src/services/db.ts'
    import '/src/style.css'
    import '/src/ui-theme.css'
    import '/src/workspace-ui.css'
    import '/src/interaction-ui.css'
    import '/src/review-ui.css'
    createApp({setup() {
      const f = useEntries(() => 'workspace-test')
      provide('toast', f.showToast)
      const notes = ['材料分析与增长率', '平均数比较'].map((title, i) => ({
        id: 'entry-' + i, notebookId: 'workspace-test', title,
        question: '<p>根据下列材料，选择正确的计算方法。</p>' + '<p>阅读材料后，先判断基期，再计算增长率。</p>'.repeat(20),
        wrongAnswer: '', correctAnswer: '<p>先判断基期，再计算增长率。</p>',
        subject: '数学', source: '练习资料', tags: [], createdAt: 1, updatedAt: 1,
      }))
      f.entries.value = notes
      f.activeId.value = notes[0].id
      let finishSave
      entryRepository.put = () => new Promise((resolve, reject) => {
        finishSave = (fail) => fail ? reject(new Error('Test storage failure')) : resolve()
      })
      entryRepository.deleteSnapshot = async () => {}
      entryRepository.putSnapshot = async () => {}
      const state = reactive({ mode: 'edit', empty: false, filtered: false })
      window.workspaceQA = {
        state, markDirty: f.markDirty, save: f.saveEntry,
        finish: (fail = false) => finishSave(fail),
        select: (id) => { f.activeId.value = id; f.isDirty.value = false },
        toast: f.showToast,
      }
      const defaults = {
        notebookName: '资料分析错题本', questionGroups: [], activeGroup: null,
        activeGroupEntries: [], answersHidden: false, selectedIds: new Set(), selectedCount: 0,
        subjectMap: { '数学': 2 }, tagMap: {}, sourceMap: {}, masteryMap: {},
        dueCount: 2, searchQuery: '', sortKey: 'updatedAt', sortDir: 'desc',
        progress: '1 / 2', progressPercent: 50, drawingEnabled: false,
        activeTool: 'pen', penColor: '#000000', penSize: 2, eraserSize: 10,
        canUndo: false, canRedo: false, showDeleteModal: false, showBatchDeleteConfirm: false,
        showUnsavedModal: false, requireSaveBeforeClose: false, statsOpen: false,
        settingsOpen: false, stats: {}, isElectron: false, isDark: false,
        currentCard: null, answered: false, elapsedMs: 0, reviewedToday: 0,
        isReviewing: false, sessionDone: false, sessionRecords: [], totalSessionMs: 0,
        reviewQueue: [], activeSubject: '__all__', activeTag: null, activeSource: null,
        activeFolder: null, activeMastery: '__all__', allSubjects: ['数学'],
        allTags: [], allSources: [], allFolders: [], installedPluginIds: [], availablePlugins: [],
      }
      return () => h('div', [h(Workspace, {
        ...defaults, mode: state.mode,
        entries: state.empty ? [] : f.entries.value,
        filteredEntries: state.empty || state.filtered ? [] : f.entries.value,
        activeId: f.activeId.value, activeEntry: f.activeEntry.value,
        isDirty: f.isDirty.value, entrySaving: f.entrySaving.value,
        entrySaveError: f.entrySaveError.value, canGoPrev: f.activeId.value !== 'entry-0',
        canGoNext: f.activeId.value !== 'entry-1',
        onSave: () => f.saveEntry(), onSelect: window.workspaceQA.select,
        onPrev: () => window.workspaceQA.select('entry-0'),
        onNext: () => window.workspaceQA.select('entry-1'),
        onMarkDirty: f.markDirty,
      }), h(AppToast, { message: f.toastMsg.value, onDismiss: () => f.toastMsg.value = '' })])
    }}).mount('#app')
  `
  const server = await createServer({
    cacheDir: path.join(os.tmpdir(), 'renote-workspace-feedback-vite'),
    root: path.resolve(__dirname, '../..'),
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'workspace-feedback-fixture',
        resolveId: (id) => (id === '/__workspace_entry.js' ? id : undefined),
        load: (id) => (id === '/__workspace_entry.js' ? code : undefined),
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__workspace_qa') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
              '<div id="app"></div><script type="module" src="/__workspace_entry.js"></script>',
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
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:8000/**', (route) => route.fulfill({ json: [] }))
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__workspace_qa')
    const status = page.locator('.entry-save-status')
    await status.getByText('已保存', { exact: true }).waitFor()
    assert.equal(
      await page.getByTestId('toggle-filter-panel').getAttribute('aria-expanded'),
      'false',
    )
    await page.getByTestId('toggle-filter-panel').click()
    await page.locator('#workspace-filters').waitFor({ state: 'visible' })
    await page.getByTestId('toggle-filter-panel').click()
    await page.locator('#workspace-filters').waitFor({ state: 'hidden' })

    await page.evaluate(() => window.workspaceQA.markDirty())
    await status.getByText('有未保存的修改', { exact: true }).waitFor()
    await status.getByRole('button', { name: '保存', exact: true }).click()
    await status.getByText('保存中…', { exact: true }).waitFor()
    await page.evaluate(() => window.workspaceQA.finish(true))
    await status.getByRole('button', { name: '重试保存', exact: true }).waitFor()
    await status.getByRole('button', { name: '重试保存', exact: true }).click()
    await status.getByText('保存中…', { exact: true }).waitFor()
    // Editing during a save must leave the new revision unsaved.
    await page.evaluate(() => {
      window.workspaceQA.markDirty()
      window.workspaceQA.finish()
    })
    await status.getByText('有未保存的修改', { exact: true }).waitFor()
    await status.getByRole('button', { name: '保存', exact: true }).click()
    await status.getByText('保存中…', { exact: true }).waitFor()
    // A late failure for another entry must not mark the new entry as failed.
    await page.evaluate(() => {
      window.workspaceQA.select('entry-1')
      window.workspaceQA.finish(true)
    })
    await status.getByText('已保存', { exact: true }).waitFor()
    await page.evaluate(() => window.workspaceQA.select('entry-0'))
    await status.getByRole('button', { name: '重试保存', exact: true }).click()
    await status.getByText('保存中…', { exact: true }).waitFor()
    await page.evaluate(() => window.workspaceQA.finish())
    await status.getByText('已保存', { exact: true }).waitFor()

    // Advancing the clock catches the original premature 500ms dismissal.
    await page.clock.install()
    await page.evaluate(() => window.workspaceQA.toast('已保存测试内容'))
    await page.clock.runFor(2000)
    assert.equal(await page.locator('.app-toast').isVisible(), true)
    await page.clock.runFor(2300)
    await page.locator('.app-toast').waitFor({ state: 'hidden' })

    for (const width of [858, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole('button', { name: '展开侧栏', exact: true }).waitFor()
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
      await page.getByRole('button', { name: '关闭题目侧栏', exact: true }).waitFor()
      await page.locator('.entry-item').first().click()
      await page.getByRole('button', { name: '展开侧栏', exact: true }).waitFor()
      assert.equal(
        await page.locator('.editor-layout').evaluate((el) => getComputedStyle(el).display),
        'flex',
      )
      assert(
        await page
          .locator('.workspace-main')
          .evaluate((el) => el.getBoundingClientRect().width > innerWidth * 0.8),
      )
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Page overflows horizontally',
      )
      const reading = page.locator('.editor-layout')
      await page
        .locator('[data-panel-id="question"] .panel-body')
        .hover({ position: { x: 30, y: 40 } })
      await page.mouse.wheel(0, 300)
      await page.waitForFunction(() => document.querySelector('.editor-layout').scrollTop > 0)
      // Scrolling an answer continues reading instead of unexpectedly changing the question.
      const title = await page.locator('.entry-context-title h1').innerText()
      await page
        .locator('[data-panel-id="correct"] .panel-body')
        .hover({ position: { x: 30, y: 30 } })
      await page.mouse.wheel(0, 300)
      await page.clock.runFor(250)
      await page.mouse.wheel(0, 300)
      assert.equal(await page.locator('.entry-context-title h1').innerText(), title)
      await reading.evaluate((el) => {
        el.scrollTop = 0
      })
    }
    await page.evaluate(() => {
      window.workspaceQA.select(null)
      window.workspaceQA.state.filtered = true
    })
    await page.getByRole('heading', { name: '没有找到匹配的错题', exact: true }).waitFor()
    await page.evaluate(() => (window.workspaceQA.state.empty = true))
    await page.getByRole('heading', { name: '记录第一道错题', exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log(
      'Workspace feedback passed: saved/dirty/saving/error/retry, revision protection, entry isolation, toast timing, filters, 858/390px layout, empty states.',
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
