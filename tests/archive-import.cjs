const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const JSZip = require('jszip')

const root = path.resolve(__dirname, '..')
function compile(entry, mockDb = false) {
  const output = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    alias: {
      ...(mockDb ? { '@/services/db': 'archive-test-db' } : {}),
      '@': path.join(root, 'src'),
    },
    ...(mockDb
      ? {
          external: ['archive-test-db'],
        }
      : {}),
  }).outputFiles[0].text
  const compiled = new Module(path.join(__dirname, 'archive-test-bundle.cjs'), module)
  compiled.paths = module.paths
  compiled.require = (name) => {
    if (mockDb && name === 'archive-test-db') {
      return {
        entryRepository: global.archiveRepositories.entries,
        notebookRepository: global.archiveRepositories.notebooks,
        questionGroupRepository: global.archiveRepositories.groups,
        reviewLogRepository: global.archiveRepositories.logs,
      }
    }
    return module.require(name)
  }
  compiled._compile(output, path.join(__dirname, 'archive-test-bundle.cjs'))
  return compiled.exports
}
const { importBrowserArchive } = compile('src/services/archiveImport.ts')

function setup() {
  const saved = { notebooks: new Map(), entries: new Map(), groups: new Map(), logs: new Map() }
  const writes = []
  const repo = (kind) => ({
    getAll: async (notebookId) =>
      [...saved[kind].values()].filter(
        (x) =>
          !notebookId ||
          (kind === 'logs' ? saved.entries.get(x.entryId)?.notebookId : x.notebookId) ===
            notebookId,
      ),
    put: async (...args) => {
      const value = args.at(-1)
      if (args.length === 2) assert.equal(args[0], value.notebookId)
      writes.push(kind)
      saved[kind].set(value.id, structuredClone(value))
    },
  })
  const repositories = {
    notebooks: repo('notebooks'),
    entries: repo('entries'),
    groups: repo('groups'),
    logs: {
      ...repo('logs'),
      add: async (_nb, log) => {
        assert.ok(saved.entries.has(log.entryId))
        writes.push('logs')
        saved.logs.set(log.id, structuredClone(log))
      },
    },
  }
  saved.notebooks.set('current', { id: 'current', name: '当前本' })
  return { saved, writes, repositories }
}
function fixture() {
  return {
    notebooks: [
      { id: 'nb1', name: '数学', instructions: '先读材料' },
      { id: 'nb2', name: '物理' },
    ],
    questionGroups: [
      {
        id: 'g1',
        notebookId: 'nb1',
        material: '<img src="images/nb1/a.png">',
        drawings: { material: 'images/nb1/a.png' },
      },
    ],
    entries: [
      {
        id: 'e1',
        notebookId: 'nb1',
        title: '题目',
        groupId: 'g1',
        subQuestionOrder: 2,
        question: '<img src="images/nb1/a.png"><img src="https://example.com/a.png">',
        wrongAnswer: "<img src='./images/nb1/a.png'>",
        correctAnswer: '<img src="images/flat.jpg">',
        drawings: { question: 'images/nb1/a.png' },
        drawing: 'images/flat.jpg',
        folder: '第一章',
        tags: ['几何'],
        reviewCount: 9,
        wrongCount: 4,
        masteryLevel: 3,
        consecutivePasses: 2,
        nextReviewDate: 1234,
        lastReviewDate: 123,
        easeFactor: 2,
        interval: 8,
      },
      { id: 'e2', notebookId: 'nb2', question: '第二本题目' },
    ],
    reviewLogs: [
      {
        id: 'l1',
        entryId: 'e1',
        timestamp: 100,
        quality: 4,
        answerText: '答案',
        sessionId: 'session',
      },
    ],
  }
}
function archive(data) {
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(data))
  zip.file('images/nb1/a.png', Buffer.from('png-image'))
  zip.file('images/flat.jpg', Buffer.from('jpg-image'))
  return zip
}

test('desktop archive preserves notebooks, group links, nested images, drawings and review history', async () => {
  const { repositories, saved, writes } = setup()
  const zip = await JSZip.loadAsync(await archive(fixture()).generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(await importBrowserArchive(zip, 'current', true, repositories), {
    imported: 2,
    skipped: 0,
  })
  assert.equal(saved.notebooks.get('nb1').instructions, '先读材料')
  assert.equal(saved.entries.get('e1').notebookId, 'nb1')
  assert.equal(saved.entries.get('e2').notebookId, 'nb2')
  const e = saved.entries.get('e1')
  assert.equal(e.groupId, 'g1')
  assert.equal(e.subQuestionOrder, 2)
  assert.equal(e.folder, '第一章')
  assert.match(e.question, /data:image\/png;base64,cG5nLWltYWdl/)
  assert.match(e.question, /https:\/\/example.com\/a.png/)
  assert.match(e.wrongAnswer, /src='data:image\/png/)
  assert.match(e.correctAnswer, /data:image\/jpeg/)
  assert.match(e.drawings.question, /^data:image\/png/)
  assert.match(e.drawing, /^data:image\/jpeg/)
  assert.match(saved.groups.get('g1').material, /data:image\/png/)
  assert.match(saved.groups.get('g1').drawings.material, /^data:image\/png/)
  assert.equal(e.reviewCount, 9)
  assert.equal(e.nextReviewDate, 1234)
  assert.deepEqual(saved.logs.get('l1'), fixture().reviewLogs[0])
  assert.ok(writes.indexOf('groups') < writes.indexOf('entries'))
  await importBrowserArchive(zip, '', true, repositories)
  assert.equal(saved.logs.size, 1)
  assert.equal(writes.filter((x) => x === 'logs').length, 1)
})

test('reset mode resets all scheduling fields and does not import review history', async () => {
  const { repositories, saved } = setup()
  await importBrowserArchive(archive(fixture()), '', false, repositories)
  const e = saved.entries.get('e1')
  for (const key of ['reviewCount', 'wrongCount', 'masteryLevel', 'consecutivePasses', 'interval'])
    assert.equal(e[key], 0)
  assert.equal(e.easeFactor, 2.5)
  assert.equal(e.nextReviewDate, undefined)
  assert.equal(e.lastReviewDate, undefined)
  assert.equal(saved.logs.size, 0)
})

test('legacy arrays go into the selected notebook, skip invalid items and restore flat images', async () => {
  const { repositories, saved } = setup()
  const zip = archive([
    null,
    {},
    { id: 'old', notebookId: 'old-nb', question: '<img src="images/flat.jpg">' },
  ])
  assert.deepEqual(await importBrowserArchive(zip, 'current', true, repositories), {
    imported: 1,
    skipped: 2,
  })
  assert.equal(saved.entries.get('old').notebookId, 'current')
  assert.match(saved.entries.get('old').question, /data:image\/jpeg/)
})

test('malformed archives and missing image files fail before writing data', async () => {
  for (const data of [
    null,
    {},
    { entries: [], notebooks: {} },
    { ...fixture(), questionGroups: [null] },
    { ...fixture(), entries: [{ id: 'e', notebookId: 'missing', question: '题目' }] },
    {
      ...fixture(),
      entries: [{ id: 'e', notebookId: 'nb1', question: '<img src="images/missing.png">' }],
    },
  ]) {
    const { repositories, writes } = setup()
    await assert.rejects(importBrowserArchive(archive(data), '', true, repositories))
    assert.equal(writes.length, 0)
  }
  const { repositories, writes } = setup()
  await assert.rejects(importBrowserArchive(new JSZip(), '', true, repositories), /data.json/)
  await assert.rejects(
    importBrowserArchive(archive([{ id: 'e', question: '' }]), '', true, repositories),
    /选择/,
  )
  assert.equal(writes.length, 0)
})

test('browser picker waits for import completion and refreshes notebooks before entries', async (t) => {
  const { repositories, saved } = setup()
  const previous = {
    window: global.window,
    document: global.document,
    repos: global.archiveRepositories,
  }
  global.window = {}
  global.archiveRepositories = repositories
  let picker
  global.document = { createElement: () => (picker = { click() {} }) }
  t.after(() => {
    global.window = previous.window
    global.document = previous.document
    global.archiveRepositories = previous.repos
  })
  const { useImportFeature } = compile('src/features/import/useImportFeature.ts', true)
  const events = []
  const feature = useImportFeature({
    entries: { value: [] },
    activeNotebookId: { value: null },
    loadNotebooks: async () => {
      assert.ok(saved.notebooks.has('nb1'))
      events.push('notebooks')
    },
    loadEntries: async () => events.push('entries'),
    showToast: (message) => events.push(message),
    resetFilters: () => events.push('filters'),
  })
  let finished = false
  const pending = feature.handleImportArchive().then(() => {
    finished = true
  })
  feature.handleImportOption(true)
  await new Promise(setImmediate)
  assert.equal(finished, false)
  picker.files = [await archive(fixture()).generateAsync({ type: 'nodebuffer' })]
  await picker.onchange()
  await pending
  assert.deepEqual(events.slice(0, 2), ['notebooks', 'entries'])
  assert.match(events[2], /成功导入 2 条错题/)
  assert.equal(events[3], 'filters')
})

test(
  'user-provided desktop archive imports completely',
  { skip: !process.env.CTB_ARCHIVE_PATH },
  async () => {
    const { repositories, saved } = setup()
    const zip = await JSZip.loadAsync(fs.readFileSync(process.env.CTB_ARCHIVE_PATH))
    const source = JSON.parse(await zip.file('data.json').async('string'))
    const result = await importBrowserArchive(zip, '', true, repositories)
    assert.equal(result.imported, source.entries.length)
    const entryIds = new Set(source.entries.map((entry) => entry.id))
    const linkedLogs = source.reviewLogs.filter((log) => entryIds.has(log.entryId))
    assert.equal(result.skipped, source.reviewLogs.length - linkedLogs.length)
    assert.equal(saved.notebooks.size - 1, source.notebooks.length)
    assert.equal(saved.groups.size, source.questionGroups.length)
    assert.equal(saved.logs.size, linkedLogs.length)
    for (const entry of saved.entries.values()) {
      for (const key of ['question', 'wrongAnswer', 'correctAnswer'])
        assert.doesNotMatch(entry[key], /src=["'](?:\.\/)?images\//)
      for (const drawing of Object.values(entry.drawings || {}))
        assert.ok(!drawing.startsWith('images/'))
    }
  },
)
