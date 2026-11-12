const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright')

// Fresh browser storage and stubbed services: never reads or writes the user's account.
async function run() {
  const { createServer } = await import('vite')
  const code = `
    import { createApp, h, reactive, ref, provide } from 'vue'
    import AuthScreen from '/src/components/AuthScreen.vue'
    import NotebookMenu from '/src/components/NotebookMenu.vue'
    import AgentChatHistoryItem from '/src/components/AgentChatHistoryItem.vue'
    import AgentChatActionDialog from '/src/components/AgentChatActionDialog.vue'
    import KnowledgeLibraryDialog from '/src/components/KnowledgeLibraryDialog.vue'
    import PdfImportDialog from '/src/components/PdfImportDialog.vue'
    import ReviewPanel from '/src/components/ReviewPanel.vue'
    import PluginManager from '/src/plugins/PluginManager.vue'
    import VocabularyPanel from '/src/plugins/english-vocabulary/VocabularyPanel.vue'
    import SettingsPanel from '/src/components/SettingsPanel.vue'
    import StatsPanel from '/src/components/StatsPanel.vue'
    import BackgroundTaskCenter from '/src/components/BackgroundTaskCenter.vue'
    import { createBackgroundTasks, backgroundTasksKey } from '/src/composables/useBackgroundTasks.ts'
    import { useNotebooks } from '/src/composables/useNotebooks.ts'
    import { notebookRepository } from '/src/services/db.ts'
    import { notebookPluginService } from '/src/plugins/service.ts'
    import { usePluginLaunchFeature } from '/src/features/plugins/usePluginLaunchFeature.ts'
    import { createReviewAgentChats, reviewAgentChatsKey } from '/src/composables/useReviewAgentChats.ts'
    import '/src/style.css'
    import '/src/ui-theme.css'
    import '/src/workspace-ui.css'
    import '/src/review-ui.css'
    import '/src/interaction-ui.css'
    const entry = { id:'q', notebookId:'qa', title:'比重趋势', question:'选择正确答案。<br>A. 持续上升<br>B. 先降后升', correctAnswer:'B', wrongAnswer:'A', tags:[], subject:'数学', createdAt:1, updatedAt:1 }
    const draft = { id:'draft', notebook_id:'qa', filename:'fixture.pdf', status:'ready', revision:1, message:'', draft:{ schema_version:'pdf-question-draft-v1', page_count:1,
      groups:[{key:'g',title:'资料一',material_text:'公共材料',asset_keys:[],question_keys:[],decision:'suggested',warnings:[]}],
      questions:[{key:'q',source_number:'1',title:'比重趋势',stem:'选择正确答案。',kind:'choice',options:[{key:'A',text:'持续上升'},{key:'B',text:'先降后升'}],asset_keys:[],group_key:null,source_pages:[1],correct_answer:'B',explanation:'分析比重',student_answer:'',warnings:[],answer_status:'provided',standalone_material_text:'',standalone_asset_keys:[]}], assets:[], notices:[] } }
    createApp({ setup() {
      provide(reviewAgentChatsKey, createReviewAgentChats())
      const background = createBackgroundTasks()
      provide(backgroundTasksKey, background)
      window.backgroundQA = background
      const stats = {totalCount:ref(1),dueCount:ref(1),reviewedToday:ref(0),totalReviews:ref(1),subjectBars:ref([]),weeklyActivity:ref([]),masteryBuckets:ref([]),dueReviewHistory:ref([{id:'session',completedAt:Date.now(),reviewedCount:1,totalCount:1,totalElapsedMs:1000,entries:[{entryId:'q',title:entry.title,subject:'数学',tags:[],question:entry.question,correctAnswer:'B',wrongAnswer:'A',quality:1,elapsedMs:1000}]}]),freeReviewHistory:ref([])}
      const s = reactive({ mode:'auth', open:true, chatMode:'', busy:false, error:'', title:'保留的聊天', events:[], calls:0, installations:[], draft, submitting:false, dark:false })
      window.moduleQA = s
      window.showModule = mode => { s.open = true; s.mode = mode; s.chatMode = ''; s.error = ''; s.busy = false }
      const pending = () => { s.calls++; return new Promise((resolve,reject) => { window.finishOperation = error => error ? reject(new Error(error)) : resolve() }) }
      notebookRepository.put = pending
      notebookRepository.delete = pending
      useNotebooks().notebooks.value = [{id:'qa',name:'测试错题本',description:'交互回归',sortOrder:0,createdAt:1,updatedAt:1}]
      notebookPluginService.listInstalled = async () => s.installations
      notebookPluginService.install = async () => { await pending(); s.installations = [{notebookId:'qa',pluginId:'english-vocabulary',version:'1',enabled:true,installedAt:1,settings:{}}] }
      notebookPluginService.uninstall = async (notebookId, pluginId, deleteData) => { s.events.push(['uninstall',deleteData]); await pending(); s.installations = [] }
      const plugins = usePluginLaunchFeature({activeNotebookId:ref('qa'),entries:ref([]),loadEntries:async()=>{},showToast:message=>s.events.push(['toast',message])})
      const log = (event,value) => s.events.push([event,value])
      return () => h('div',{class:'workspace-ui',style:'min-height:100vh;padding:20px'},[
        s.mode === 'auth' && h(AuthScreen),
        s.mode === 'notebooks' && h(NotebookMenu,{onEnter:id=>log('enter',id)}),
        s.mode === 'chat' && h('div',{style:'width:280px'},[h(AgentChatHistoryItem,{title:s.title,detail:'今天',active:true,expanded:false,disabled:false,onRename:()=>s.chatMode='rename',onDelete:()=>s.chatMode='delete',onSelect:()=>log('select-chat')}),
          s.chatMode && h(AgentChatActionDialog,{mode:s.chatMode,title:s.title,busy:s.busy,error:s.error,onClose:()=>s.chatMode='',onConfirm:title=>{s.busy=true;log('rename',title)}})]),
        s.mode === 'knowledge' && s.open && h(KnowledgeLibraryDialog,{mode:'insert',libraries:[{id:'lib',name:'数学知识库',description:'例题与笔记',status:'ready',archived:false,charCount:100}],selected:[],error:'',importing:false,importProgress:'',importResults:[],onClose:()=>s.open=false,onInsert:ids=>log('insert-libraries',ids)}),
        s.mode === 'pdf' && s.open && h(PdfImportDialog,{loading:false,progress:'',error:'',result:null,draft:s.draft,onClose:()=>s.open=false,onConfirm:keys=>log('pdf-confirm',keys)}),
        s.mode === 'review' && h(ReviewPanel,{entry,answered:false,submitting:s.submitting,elapsedMs:0,progress:'1 / 1',progressPercent:0,dueCount:1,reviewedToday:0,isReviewing:true,sessionDone:false,sessionRecords:[],totalSessionMs:0,reviewQueue:[entry],entries:[entry],onRate:(rating,note,outcome)=>{s.submitting=true;log('answer',outcome)}}),
        s.mode === 'plugins' && s.open && h(PluginManager,{notebookName:'测试错题本',installations:plugins.installedPlugins.value,pendingId:plugins.pendingPluginId.value,pendingOperation:plugins.pendingPluginOperation.value,actionError:plugins.pluginActionError.value,onClose:()=>s.open=false,onInstall:plugins.installPlugin,onUninstall:plugins.uninstallPlugin}),
        s.mode === 'vocabulary' && h(VocabularyPanel,{notebookId:'qa',notebookName:'测试错题本',archiveMistake:async()=>{}}),
        s.mode === 'settings' && h(SettingsPanel,{isDark:s.dark,isElectron:false,userEmail:'qa@example.com',onToggleDark:()=>s.dark=!s.dark}),
        s.mode === 'stats' && h(StatsPanel,{stats}),
        s.mode === 'tasks' && h(BackgroundTaskCenter),
      ])
    }}).mount('#app')
  `
  const server = await createServer({
    root: path.resolve(__dirname, '../..'),
    appType: 'custom',
    cacheDir: path.join(os.tmpdir(), 'renote-all-modules-vite'),
    optimizeDeps: { entries: [] },
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'all-module-interactions-fixture',
        resolveId: (id) => (id === '/__module_qa.js' ? id : undefined),
        load: (id) => (id === '/__module_qa.js' ? code : undefined),
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__module_qa') return next()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end('<div id="app"></div><script type="module" src="/__module_qa.js"></script>')
          })
        },
      },
    ],
  })
  await server.listen()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(10000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('Browser:', error.message)
    })
    await page.route(/https?:\/\/(localhost|127\.0\.0\.1):8000\//, (route) =>
      route.fulfill({ json: { items: [], subjects: [], reviewDays: [] } }),
    )
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__module_qa', {
      timeout: 60000,
    })
    const show = (mode) => page.evaluate((mode) => window.showModule(mode), mode)
    const state = (key) => page.evaluate((key) => window.moduleQA[key], key)
    const focus = async (locator) =>
      page.waitForFunction((el) => document.activeElement === el, await locator.elementHandle())

    const account = page.getByRole('radiogroup', { name: '账户操作' })
    await account.getByRole('radio', { name: '登录', exact: true }).focus()
    await page.keyboard.down('ArrowRight')
    await page.waitForFunction(() =>
      document.querySelector('[role="radio"][data-state="checked"]')?.textContent.includes('注册'),
    )
    await page.keyboard.up('ArrowRight')
    await page.getByRole('heading', { name: '创建你的账号' }).waitFor()
    await page.getByLabel('邮箱', { exact: true }).fill('qa@example.com')
    await page.getByLabel('邮箱验证码').fill('123456')
    await page.getByLabel('密码', { exact: true }).fill('password123')
    await page.getByLabel('确认密码').fill('different123')
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor()
    await account.getByRole('radio', { name: '登录', exact: true }).click()
    assert.equal(await page.getByRole('alert').count(), 0)

    await show('notebooks')
    await page.getByRole('button', { name: '错题本操作：测试错题本' }).click()
    await page.getByRole('menuitem', { name: '编辑错题本' }).click()
    const edit = page.getByRole('dialog', { name: '编辑错题本', exact: true })
    await edit.waitFor()
    await edit.getByRole('textbox').first().fill('改名测试')
    const calls = await state('calls')
    await edit.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => window.moduleQA.calls > 0)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    assert.equal(await state('calls'), calls + 1)
    assert.equal(await edit.getByRole('button', { name: '取消' }).isDisabled(), true)
    await page.evaluate(() => window.finishOperation('保存失败，请重试'))
    await edit.getByRole('alert').filter({ hasText: '保存失败' }).waitFor()
    assert.equal(await edit.getByRole('textbox').first().inputValue(), '改名测试')
    await edit.getByRole('button', { name: '取消' }).click()
    await edit.waitFor({ state: 'detached' })
    assert.equal(
      (await state('events')).some((event) => event[0] === 'enter'),
      false,
    )

    await show('chat')
    const chatTrigger = page.getByRole('button', { name: '聊天操作：保留的聊天' })
    await chatTrigger.focus()
    await chatTrigger.press('ArrowDown')
    await page.getByRole('menuitem', { name: '重命名聊天' }).click()
    const chat = page.getByRole('dialog', { name: '重命名聊天' })
    await chat.getByRole('textbox', { name: '聊天名称' }).fill('新聊天名称')
    await chat.getByRole('button', { name: '保存', exact: true }).click()
    assert.equal(await chat.getByRole('button', { name: '正在保存…' }).isDisabled(), true)
    await page.evaluate(() => {
      window.moduleQA.busy = false
      window.moduleQA.error = '重命名失败'
    })
    await chat.getByRole('alert').waitFor()
    await page.keyboard.press('Escape')
    await chat.waitFor({ state: 'detached' })
    await focus(chatTrigger)

    await show('knowledge')
    const knowledge = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('radiogroup', { name: '知识库模式' }) })
    await knowledge.getByRole('checkbox', { name: '选择 数学知识库' }).check()
    await knowledge.getByRole('radio', { name: '管理知识库', exact: true }).click()
    await knowledge.getByRole('radio', { name: '插入知识库', exact: true }).click()
    assert.equal(
      await knowledge.getByRole('checkbox', { name: '选择 数学知识库' }).isChecked(),
      true,
    )
    await knowledge.getByRole('button', { name: '确认选择' }).click()
    assert.deepEqual((await state('events')).at(-1), ['insert-libraries', ['lib']])
    await page.keyboard.press('Escape')
    await knowledge.waitFor({ state: 'detached' })

    await show('pdf')
    const pdf = page.getByRole('dialog')
    await pdf.getByRole('combobox', { name: '第1题题型' }).click()
    await page.getByRole('option', { name: '非选择题', exact: true }).click()
    assert.equal((await state('draft')).draft.questions[0].kind, 'free_response')
    await pdf.getByRole('combobox', { name: '第1题公共材料' }).click()
    await page.getByRole('option', { name: '资料一', exact: true }).click()
    assert.equal((await state('draft')).draft.questions[0].group_key, 'g')
    assert.equal(await page.getByTestId('pdf-import-confirm').isDisabled(), true)
    await pdf.getByRole('checkbox', { name: /我已对照原 PDF/ }).check()
    assert.equal(
      await page.getByTestId('pdf-import-confirm').evaluate((el) => {
        const probe = document.createElement('i')
        probe.style.backgroundColor = 'var(--neo-accent)'
        el.append(probe)
        const accent = getComputedStyle(probe).backgroundColor
        probe.remove()
        return getComputedStyle(el).backgroundColor === accent
      }),
      true,
      'PDF primary action must retain the shared orange accent',
    )
    await page.getByTestId('pdf-import-confirm').click()
    assert.deepEqual((await state('events')).at(-1), ['pdf-confirm', ['q']])
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-module-pdf.png') })
    await page.keyboard.press('Escape')
    await pdf.waitFor({ state: 'detached' })

    await show('review')
    const answers = page.getByRole('radiogroup', { name: '选择答案' })
    await answers.getByRole('radio').first().focus()
    await page.keyboard.down('ArrowDown')
    await page.waitForFunction(() =>
      document
        .querySelector(
          '[role="radiogroup"][aria-label="选择答案"] [role="radio"][data-state="checked"]',
        )
        ?.textContent.includes('先降后升'),
    )
    await page.keyboard.up('ArrowDown')
    assert.equal(await answers.getByRole('radio').nth(1).getAttribute('aria-checked'), 'true')
    await page.getByTestId('submit-review-answer').click()
    const outcome = (await state('events')).at(-1)[1]
    assert.equal(outcome.selectedChoice, 'B')
    assert.equal(outcome.isCorrect, true)
    assert.equal(await page.getByTestId('submit-review-answer').isDisabled(), true)

    await show('plugins')
    const manager = page.getByRole('dialog', { name: '添加功能', exact: true })
    await manager.getByRole('button', { name: '安装', exact: true }).click()
    const installingCalls = await state('calls')
    assert.equal(await manager.getByRole('button', { name: '安装中…' }).isDisabled(), true)
    await page.keyboard.press('Escape')
    assert.equal(await manager.isVisible(), true)
    await page.evaluate(() => window.finishOperation('安装失败，请重试'))
    await manager.getByRole('alert').waitFor()
    assert.equal(await state('calls'), installingCalls)
    await manager.getByRole('button', { name: '安装', exact: true }).click()
    await page.evaluate(() => window.finishOperation())
    await manager.getByRole('button', { name: '卸载', exact: true }).click()
    const uninstall = page.getByRole('dialog', { name: /卸载语言学习/ })
    await uninstall.waitFor()
    await focus(uninstall.getByRole('button', { name: '取消' }))
    await uninstall.getByRole('radio', { name: /卸载并删除插件数据/ }).check()
    await uninstall.getByRole('button', { name: '确认卸载' }).click()
    await page.evaluate(() => window.finishOperation('卸载失败，请重试'))
    await uninstall.getByRole('alert').waitFor()
    assert.equal(
      await uninstall.getByRole('radio', { name: /卸载并删除插件数据/ }).isChecked(),
      true,
    )
    await uninstall.getByRole('button', { name: '确认卸载' }).click()
    await page.evaluate(() => window.finishOperation())
    await uninstall.waitFor({ state: 'detached' })
    await page.waitForFunction(() =>
      document.activeElement?.closest('[role="dialog"]')?.textContent.includes('添加功能'),
    )

    await show('vocabulary')
    await page.getByRole('button', { name: '新建词库', exact: true }).click()
    const archive = page.getByRole('dialog', { name: '新建词库', exact: true })
    await archive.getByRole('textbox').fill('交互测试词库')
    await archive.getByRole('button', { name: '创建', exact: true }).click()
    await archive.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '新增单词', exact: true }).click()
    const word = page.getByRole('dialog', { name: '新增单词', exact: true })
    await word.getByLabel('英语单词 *', { exact: true }).fill('example')
    await word.getByLabel('中文释义 *', { exact: true }).fill('例子')
    await word.getByRole('button', { name: '保存单词' }).click()
    await word.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '删除当前词库' }).click()
    const deleting = page.getByRole('dialog', { name: /删除词库/ })
    await focus(deleting.getByRole('button', { name: '取消' }))
    await page.keyboard.press('Escape')
    await deleting.waitFor({ state: 'detached' })
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-module-vocabulary.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: path.join(os.tmpdir(), 'renote-module-vocabulary-dark.png') })

    await show('settings')
    const autosave = page.getByRole('switch', { name: '自动保存', exact: true })
    const checked = await autosave.getAttribute('aria-checked')
    await autosave.click()
    assert.notEqual(await autosave.getAttribute('aria-checked'), checked)
    await page.getByRole('switch', { name: '切换深色模式' }).click()
    assert.equal(
      await page.getByRole('switch', { name: '切换深色模式' }).getAttribute('aria-checked'),
      'true',
    )

    await show('stats')
    const scope = page.getByRole('radiogroup', { name: '复习记录范围' })
    await scope.getByRole('radio', { name: '自由复习' }).click()
    await page.getByText('暂无已完成的自由复习', { exact: true }).waitFor()
    await scope.getByRole('radio', { name: '到期复习' }).click()
    await page.getByRole('button', { name: /点击查看全部题目/ }).click()
    const detail = page.getByRole('dialog', { name: '本次复习详情' })
    await detail.waitFor()
    await page.keyboard.press('Escape')
    await detail.waitFor({ state: 'detached' })

    await show('tasks')
    await page.evaluate(() =>
      window.backgroundQA.update({
        id: 'import',
        title: 'PDF 导入',
        detail: '正在识别',
        state: 'running',
        progress: 35,
        open: () => window.moduleQA.events.push(['task-open']),
      }),
    )
    const tasks = page.getByRole('complementary', { name: '后台任务', exact: true })
    await tasks.getByRole('button', { name: '展开', exact: true }).click()
    await tasks.getByRole('progressbar', { name: 'PDF 导入', exact: true }).waitFor()
    assert.equal(await tasks.getByRole('button', { name: '关闭任务通知', exact: true }).count(), 0)
    await tasks.getByRole('button', { name: '关闭任务通知面板' }).click()
    assert.equal(await page.evaluate(() => window.backgroundQA.tasks.value.length), 1)
    await page.evaluate(() =>
      window.backgroundQA.update({
        id: 'import',
        title: 'PDF 导入',
        detail: '识别完成',
        state: 'completed',
        open: () => window.moduleQA.events.push(['task-open']),
      }),
    )
    await tasks.getByRole('button', { name: '关闭任务通知', exact: true }).click()
    assert.equal(await page.evaluate(() => window.backgroundQA.tasks.value.length), 0)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: auth mode/error reset, notebook async failure, chat menus/focus, knowledge selection, PDF modal selects, review keyboard choice, plugin pending/retry/data policy, vocabulary forms and safe cancel.',
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
