const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright')

// Local fixture only: these interactions never touch the signed-in user's notes.
async function run() {
  const { createServer } = await import('vite')
  const code = `
    import { createApp, h, reactive } from 'vue'
    import AppToolbar from '/src/components/AppToolbar.vue'
    import AppSidebar from '/src/components/AppSidebar.vue'
    import FilterItemRow from '/src/components/FilterItemRow.vue'
    import MetadataSelect from '/src/components/MetadataSelect.vue'
    import TagMultiSelect from '/src/components/TagMultiSelect.vue'
    import DeleteModal from '/src/components/DeleteModal.vue'
    import UnsavedModal from '/src/components/UnsavedModal.vue'
    import QuestionGroupConfirmModal from '/src/components/QuestionGroupConfirmModal.vue'
    import '/src/style.css'
    import '/src/ui-theme.css'
    import '/src/workspace-ui.css'
    import '/src/review-ui.css'
    import '/src/interaction-ui.css'
    const notes = ['比重变化趋势', '平均数比较'].map((title, index) => ({
      id: 'note-' + index, title, question: '<p>根据材料回答问题。</p>', subject: '数学',
      folder: '练习', tags: [], createdAt: 1, updatedAt: 1,
    }))
    createApp({ setup() {
      const s = reactive({ dirty: false, activeId: 'note-0', subject: '', tags: [],
        allTags: ['数学', '资料分析'], selectedIds: new Set(['note-0']),
        sortKey: 'updatedAt', sortDir: 'desc', deleteOpen: false, unsavedOpen: false,
        groupOpen: false, busy: false, error: '', requireSave: false, events: [] })
      window.interactionQA = s
      const log = (name, value) => s.events.push([name, value])
      return () => h('div', { class: 'workspace-ui qa-shell' }, [
        h(AppToolbar, { sidebarCollapsed: false, activeId: s.activeId, searchQuery: '', mode: 'edit',
          dueCount: 3, progress: '1 / 2', statsOpen: false, isDirty: s.dirty, drawingEnabled: false,
          onDelete: () => s.deleteOpen = true, onSave: () => log('save'),
          onImportText: () => log('import-text'), onExportJson: () => log('export-json') }),
        h('div', { class: 'qa-panels' }, [
          h('div', { class: 'qa-sidebar' }, [h(AppSidebar, {
            notebookName: '资料分析', collapsed: false, entries: notes, questionGroups: [],
            filteredEntries: notes, activeId: s.activeId, activeSubject: '__all__', activeTag: null,
            activeMastery: '__all__', sortKey: s.sortKey, sortDir: s.sortDir, subjectMap: { '数学': 2 },
            tagMap: {}, masteryMap: {}, allSubjects: ['数学'], allTags: s.allTags, allSources: [],
            activeSource: null, sourceMap: {}, allFolders: ['练习'], activeFolder: null,
            selectedIds: s.selectedIds, selectedCount: s.selectedIds.size, installedPluginIds: [], availablePlugins: [],
            onSelectAll: ids => s.selectedIds = new Set(ids), onDeselectAll: () => s.selectedIds = new Set(),
            onSetSort: key => { if (key === s.sortKey) s.sortDir = s.sortDir === 'asc' ? 'desc' : 'asc'; else { s.sortKey = key; s.sortDir = 'desc' } },
            onBatchTag: tags => log('batch-tags', tags), onAddTag: name => s.allTags.push(name),
            onDeleteFolder: folder => log('delete-folder', folder),
          })]),
          h('section', { class: 'qa-form' }, [
            h('h1', '比重变化趋势'),
            h('p', '2020～2022 年，马铃薯出口量占产量的比重呈现何种变化趋势？'),
            h('div', { class: 'qa-fields' }, [
              h(MetadataSelect, { label: '板块', placeholder: '未分类', modelValue: s.subject,
                options: ['数学', '资料分析'], 'onUpdate:modelValue': value => s.subject = value }),
              h(TagMultiSelect, { allTags: s.allTags, modelValue: s.tags,
                'onUpdate:modelValue': value => s.tags = value, onAddTag: name => s.allTags.push(name) }),
            ]),
            h(FilterItemRow, { label: '数学', count: 2, selected: true, manageable: true,
              onEdit: () => log('rename'), onDelete: () => log('delete-subject') }),
            h('div', { class: 'qa-buttons' }, [
              h('button', { id: 'open-unsaved', class: 'ui-button', onClick: () => s.unsavedOpen = true }, '离开编辑'),
              h('button', { id: 'open-group', class: 'ui-button', onClick: () => s.groupOpen = true }, '转为题组'),
            ]),
          ]),
        ]),
        h(DeleteModal, { visible: s.deleteOpen, onCancel: () => s.deleteOpen = false,
          onConfirm: () => { log('delete'); s.deleteOpen = false } }),
        h(UnsavedModal, { visible: s.unsavedOpen, busy: s.busy, error: s.error, requireSave: s.requireSave,
          onCancel: () => s.unsavedOpen = false,
          onSave: () => { s.busy = true; log('save-and-proceed') },
          onDiscard: () => { log('discard'); s.unsavedOpen = false } }),
        h(QuestionGroupConfirmModal, { visible: s.groupOpen, onCancel: () => s.groupOpen = false,
          onConfirm: () => { log('convert-group'); s.groupOpen = false } }),
      ])
    }}).mount('#app')
  `
  const server = await createServer({
    root: path.resolve(__dirname, '../..'),
    appType: 'custom',
    cacheDir: path.join(os.tmpdir(), 'renote-interaction-modules-vite'),
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'interaction-module-fixture',
        resolveId: (id) => (id === '/__interactions.js' ? id : undefined),
        load: (id) => (id === '/__interactions.js' ? code : undefined),
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__interactions') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
              '<style>.qa-shell{min-height:100vh}.qa-panels{display:flex;height:calc(100vh - 58px)}.qa-sidebar{height:100%;flex-shrink:0}.qa-form{flex:1;min-width:0;padding:32px}.qa-form h1{font-size:22px;font-weight:600;margin-bottom:18px}.qa-form p{line-height:1.8;margin-bottom:24px}.qa-fields{display:flex;gap:10px;max-width:400px;margin-bottom:30px}.qa-buttons{display:flex;gap:8px;margin-top:30px}@media(max-width:600px){.qa-sidebar{display:none}.qa-form{padding:20px}}</style><div id="app"></div><script type="module" src="/__interactions.js"></script>',
            )
          })
        },
      },
    ],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 780 } })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    page.setDefaultTimeout(15000)
    async function expectFocus(locator) {
      await page.waitForFunction(
        (element) => element === document.activeElement,
        await locator.elementHandle(),
      )
    }
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__interactions', {
      timeout: 60000,
    })
    const more = page.getByRole('button', { name: '更多', exact: true })
    await more.focus()
    await more.press('ArrowDown')
    const commands = page.getByRole('menu', { name: '更多', exact: true })
    await commands.waitFor()
    assert.equal(await commands.getByRole('menuitem', { name: '保存' }).isDisabled(), true)
    await page.waitForFunction(() => document.activeElement?.textContent.includes('导出归档'))
    await page.keyboard.press('End')
    assert((await page.locator(':focus').innerText()).includes('删除'))
    await page.keyboard.press('Escape')
    await expectFocus(more)
    await more.click()
    await commands.getByRole('menuitem', { name: '导入文本', exact: true }).click()
    assert.equal(await page.evaluate(() => window.interactionQA.events.at(-1)[0]), 'import-text')
    await more.click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '删除错题', exact: true })
    await deletion.waitFor()
    await expectFocus(deletion.getByRole('button', { name: '取消' }))
    await page.keyboard.press('Shift+Tab')
    await expectFocus(deletion.getByRole('button', { name: '确认删除' }))
    await page.keyboard.press('Escape')
    await deletion.waitFor({ state: 'hidden' })
    await expectFocus(more)
    assert.equal(
      await page.evaluate(() => window.interactionQA.events.some((e) => e[0] === 'delete')),
      false,
    )

    const filterMenu = page.locator('.qa-form').getByRole('button', { name: '数学的操作' })
    await filterMenu.focus()
    await filterMenu.press('ArrowDown')
    await page.getByRole('menuitem', { name: '重命名', exact: true }).press('Enter')
    assert.equal(await page.evaluate(() => window.interactionQA.events.at(-1)[0]), 'rename')

    await page.getByRole('combobox', { name: '板块', exact: true }).click()
    await page.getByRole('option', { name: '数学', exact: true }).click()
    assert.equal(await page.evaluate(() => window.interactionQA.subject), '数学')
    const tags = page.locator('.qa-form').getByRole('button', { name: '选择标签' })
    await tags.click()
    const search = page.getByRole('combobox', { name: '搜索或新建标签' })
    await search.press('ArrowDown')
    await search.press('Enter')
    assert.deepEqual(await page.evaluate(() => [...window.interactionQA.tags]), ['数学'])
    await search.press('ArrowDown')
    await search.press('Enter')
    assert.deepEqual(await page.evaluate(() => [...window.interactionQA.tags]), [
      '数学',
      '资料分析',
    ])
    await search.fill('增长率')
    await search.press('Enter')
    assert.deepEqual(await page.evaluate(() => [...window.interactionQA.tags]), [
      '数学',
      '资料分析',
      '增长率',
    ])
    await page.getByRole('button', { name: '移除标签：数学' }).click()
    assert.deepEqual(await page.evaluate(() => [...window.interactionQA.tags]), [
      '资料分析',
      '增长率',
    ])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '删除文件夹：练习', exact: true }).click()
    const folder = page.getByRole('dialog', { name: '删除文件夹：练习', exact: true })
    await folder.getByText(/题目将移至未归档/).waitFor()
    assert.equal(
      await page.evaluate(() => window.interactionQA.events.some((e) => e[0] === 'delete-folder')),
      false,
    )
    await folder.getByRole('button', { name: '确认删除' }).click()
    assert.deepEqual(await page.evaluate(() => window.interactionQA.events.at(-1)), [
      'delete-folder',
      '练习',
    ])

    const selectAll = page.getByRole('checkbox', { name: '全选题目' })
    assert.equal(await selectAll.getAttribute('aria-checked'), 'mixed')
    await selectAll.click()
    assert.equal(await selectAll.getAttribute('aria-checked'), 'true')
    await page.getByRole('combobox', { name: '排序方式' }).click()
    await page.getByRole('option', { name: '标题', exact: true }).click()
    assert.equal(await page.evaluate(() => window.interactionQA.sortKey), 'title')
    await page.getByRole('button', { name: '改为升序', exact: true }).click()
    assert.equal(await page.evaluate(() => window.interactionQA.sortDir), 'asc')
    await page.getByRole('button', { name: '批量管理', exact: true }).click()
    await page.getByRole('menuitem', { name: '批量标签', exact: true }).click()
    const batch = page.getByRole('dialog', { name: '批量添加标签', exact: true })
    await batch.waitFor()
    await batch.getByRole('button', { name: '选择标签' }).click()
    await page.getByRole('option', { name: '数学', exact: true }).click()
    await page.keyboard.press('Escape')
    await batch.getByRole('button', { name: '添加标签', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.interactionQA.events.at(-1)), [
      'batch-tags',
      ['数学'],
    ])

    await page.locator('#open-unsaved').click()
    const unsaved = page.getByRole('dialog', { name: '未保存的更改', exact: true })
    await unsaved.getByRole('button', { name: '保存', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(await unsaved.isVisible(), true)
    assert.equal(
      await unsaved.getByRole('button', { name: '保存中…', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.interactionQA.busy = false
      window.interactionQA.error = '保存失败，请重试'
    })
    await unsaved.getByRole('alert').getByText('保存失败，请重试').waitFor()
    await unsaved.getByRole('button', { name: '取消' }).click()
    await expectFocus(page.locator('#open-unsaved'))
    await page.evaluate(() => {
      window.interactionQA.requireSave = true
      window.interactionQA.error = ''
    })
    await page.locator('#open-unsaved').click()
    assert.equal(await page.getByRole('button', { name: '不保存', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    await page.locator('#open-group').click()
    await page.getByRole('button', { name: '确认转化', exact: true }).click()
    assert.equal(await page.evaluate(() => window.interactionQA.events.at(-1)[0]), 'convert-group')

    const resize = page.getByRole('separator', { name: '调整侧边栏宽度' })
    await resize.focus()
    for (let index = 0; index < 6; index++) await resize.press('ArrowLeft')
    assert.equal(await resize.getAttribute('aria-valuenow'), '220')
    assert(
      await page.locator('.sidebar-action-tray').evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    await resize.press('Home')

    await more.click()
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-interaction-light.png') })
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.locator('#open-unsaved').click()
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-interaction-dark.png') })
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--neo-accent').trim(),
      ),
      '#eda17d',
    )
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await more.click()
    const bounds = await commands.boundingBox()
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-interaction-mobile.png') })
    assert.deepEqual(errors, [])
    console.log(
      'Interaction modules passed: command keyboard/disabled/focus, field and tag selection/create/remove, folder confirmation, partial/all selection, sorting, batch tags inside modal, save error/busy/focus trap, mandatory-save mode, conversion, dark theme and 390px.',
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
