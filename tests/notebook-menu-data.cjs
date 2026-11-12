const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const tick = () => new Promise((resolve) => setImmediate(resolve))
async function run() {
  let calls = 0
  let releaseFirst
  let mode = 'pending'
  const getNotebookOverview = async (ids) => {
    calls++
    if (mode === 'pending')
      return new Promise((resolve) => {
        releaseFirst = resolve
      })
    if (mode === 'fail') throw new Error('offline')
    return {
      items: ids.map((notebookId) => ({
        notebookId,
        entryCount: notebookId === 'empty' ? 0 : 132,
        dueCount: notebookId === 'empty' ? 0 : 119,
        reviewedToday: 0,
      })),
      subjects: [],
      reviewDays: [],
    }
  }
  const exports = {}
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/composables/useNotebookMenuData.ts'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'vue') return vue
      if (name === '@/services/db') return { getNotebookOverview }
      throw new Error(name)
    },
  })
  const ids = ['a', 'b', 'empty', ...Array.from({ length: 9 }, (_, i) => `book${i}`)]
  const books = vue.ref(ids.map((id) => ({ id })))
  const scope = vue.effectScope()
  const data = scope.run(() => exports.useNotebookMenuData(books))
  assert.equal(calls, 1, 'Twelve notebooks must use one aggregate read')
  assert.equal(data.loading.value, true)
  assert.equal(data.entriesReady.value, false, 'Pending must not mean zero')
  mode = 'ok'
  releaseFirst(await getNotebookOverview(ids))
  await tick()
  assert.equal(data.hasEntries('empty'), true)
  assert.equal(data.countsByNotebook.value.empty.entryCount, 0)
  assert.equal(data.countsByNotebook.value.a.entryCount, 132)
  assert.equal(data.countsByNotebook.value.a.dueCount, 119)
  assert.equal(data.entriesReady.value, true)
  assert.equal(data.reviewsReady.value, true)
  assert.equal(data.loading.value, false)
  const beforeReorder = calls
  books.value = [...books.value].reverse()
  await tick()
  assert.equal(calls, beforeReorder, 'Reordering must not reload statistics')
  mode = 'fail'
  await data.reload()
  assert.equal(data.countsByNotebook.value.a.entryCount, 132, 'Failed refresh retains known counts')
  assert.ok(data.error.value)
  books.value = [{ id: 'a' }]
  await tick()
  assert.deepEqual(
    Object.keys(data.countsByNotebook.value),
    ['a'],
    'Removed notebooks are excluded',
  )
  mode = 'ok'
  await data.reload()
  assert.equal(data.error.value, '')
  scope.stop()

  const raceScope = vue.effectScope()
  mode = 'pending'
  const raceBooks = vue.ref([{ id: 'old' }])
  const raceData = raceScope.run(() => exports.useNotebookMenuData(raceBooks))
  const releaseOld = releaseFirst
  mode = 'ok'
  raceBooks.value = [{ id: 'new' }]
  await tick()
  releaseOld({ items: [{ notebookId: 'old', entryCount: 999 }], subjects: [], reviewDays: [] })
  await tick()
  assert.equal(
    raceData.countsByNotebook.value.new.entryCount,
    132,
    'Stale responses cannot overwrite new counts',
  )
  raceScope.stop()
  console.log(
    'PASS: one aggregate read, unknown vs zero, retry, retained counts, reorder and request races',
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
