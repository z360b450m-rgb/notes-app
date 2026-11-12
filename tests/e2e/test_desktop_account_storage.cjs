// Run actual storage IPC handlers with Electron's window shell mocked.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

async function run() {
  const tempPrefix = path.join(os.tmpdir(), 'cuotiben-account-storage-')
  const temporary = fs.mkdtempSync(tempPrefix)
  const legacy = path.join(temporary, 'documents', '错题本')
  const handlers = new Map()
  const mainPath = path.resolve(__dirname, '../../electron/main.cjs')
  const mainRequire = createRequire(mainPath)
  const logger = { transports: { file: {}, console: {} }, warn() {}, error() {}, info() {} }
  try {
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(
      path.join(legacy, 'notebooks.json'),
      JSON.stringify([
        { id: 'alice-nb', name: 'alice notebook' },
        { id: 'bob-nb', name: 'bob notebook' },
      ]),
    )
    for (const owner of ['alice', 'bob']) {
      fs.writeFileSync(
        path.join(legacy, `notebook_${owner}-nb.json`),
        JSON.stringify({
          entries: [
            { id: owner + '-entry', notebookId: owner + '-nb', question: owner + ' secret' },
          ],
          questionGroups: [],
          snapshots: [],
          reviewLogs: [],
        }),
      )
      for (const folder of ['images', path.join('plugins', 'english-vocabulary', 'notebooks')]) {
        const dir = path.join(legacy, folder, owner + '-nb')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'preserve.txt'), owner)
      }
    }
    vm.runInNewContext(
      fs.readFileSync(mainPath, 'utf8'),
      {
        __dirname: path.dirname(mainPath),
        Buffer,
        URL,
        Response,
        AbortSignal,
        process: { platform: process.platform, on() {} },
        require(name) {
          if (name === 'electron')
            return {
              app: {
                getPath: (kind) => path.join(temporary, kind),
                on() {},
                whenReady: () => ({ then() {} }),
              },
              ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
              protocol: { registerSchemesAsPrivileged() {} },
            }
          if (name === 'electron-log') return logger
          return mainRequire(name)
        },
        async fetch(url, options) {
          const owner = options.headers.Authorization.replace('Bearer ', '')
          if (!['alice', 'bob'].includes(owner)) return { ok: false }
          return {
            ok: true,
            json: async () =>
              url.endsWith('/users/me') ? { id: owner } : { items: [{ id: owner + '-nb' }] },
          }
        },
      },
      { filename: mainPath },
    )
    const call = (channel, ...args) => handlers.get(channel)(null, ...args)
    await assert.rejects(call('storage:setUser', 'invalid'), /Login expired/)
    for (const owner of ['alice', 'bob', 'alice']) {
      await call('storage:setUser', owner)
      const currentDir = path.join(legacy, 'users', owner)
      assert.equal(call('storage:getDataDir'), currentDir)
      assert.deepEqual(
        Array.from(call('storage:getAllNotebooks'), (nb) => nb.id),
        [owner + '-nb'],
      )
      assert.equal(call('storage:getAll', owner + '-nb')[0].question, owner + ' secret')
      const list = call('storage:getEntrySummaries', owner + '-nb')
      assert.equal(list[0].question, '')
      assert.equal(list[0].isSummary, true)
      assert.deepEqual(Array.from(call('storage:searchEntryIds', owner + '-nb', 'secret')), [
        owner + '-entry',
      ])
      assert.equal(call('storage:get', owner + '-nb', owner + '-entry').question, owner + ' secret')
      assert.throws(() => call('storage:put', list[0]), /unloaded/)
      assert(fs.existsSync(path.join(currentDir, `notebook_summary_${owner}-nb.json`)))
      const other = owner === 'alice' ? 'bob' : 'alice'
      assert.equal(call('storage:getAll', other + '-nb').length, 0)
      const timestamp = Date.now()
      call('storage:deleteReviewLogsByEntry', owner + '-nb', owner + '-entry')
      call('storage:addReviewLog', owner + '-nb', {
        id: 'review',
        entryId: owner + '-entry',
        timestamp,
      })
      call('storage:addReviewLog', owner + '-nb', { id: 'orphan', entryId: 'missing', timestamp })
      const readFile = fs.readFileSync
      fs.readFileSync = function (filename, ...args) {
        assert.notEqual(
          path.resolve(filename),
          path.join(currentDir, `notebook_${owner}-nb.json`),
          'A warm dashboard must use the small summary cache, not the full notebook file',
        )
        return readFile.call(this, filename, ...args)
      }
      let overview
      try {
        overview = call('storage:getNotebookOverview', [owner + '-nb', other + '-nb'])
      } finally {
        fs.readFileSync = readFile
      }
      assert.equal(overview.items.length, 1, 'Desktop overview must respect account ownership')
      assert.equal(overview.items[0].entryCount, 1)
      assert.equal(overview.items[0].reviewedToday, 1, 'Orphan logs must not affect counts')
      assert(!JSON.stringify(overview).includes('secret'), 'IPC sends aggregate numbers only')
      const localState = call('storage:getNotebookOverview', [owner + '-nb'], true)
      assert.equal(localState.entries[0].id, owner + '-entry')
      assert.equal(localState.reviews.length, 1)
      assert(
        !JSON.stringify(localState).includes('secret'),
        'Sync reconciliation excludes question content',
      )
      for (const folder of ['images', path.join('plugins', 'english-vocabulary', 'notebooks')]) {
        assert.equal(
          fs.readFileSync(path.join(currentDir, folder, owner + '-nb', 'preserve.txt'), 'utf8'),
          owner,
        )
      }
      if (owner === 'alice') call('storage:markIndexedDBMigrated')
      assert.equal(call('storage:isIndexedDBMigrated'), owner === 'alice')
    }
    assert(fs.existsSync(path.join(legacy, 'notebook_alice-nb.json')), 'Legacy files preserved')
    console.log(
      'PASS: desktop account directories, ownership-confirmed migration, images/plugins and per-user migration flags',
    )
  } finally {
    const resolved = path.resolve(temporary)
    assert(
      resolved.startsWith(path.resolve(tempPrefix)),
      'Cleanup must remain inside this test temporary directory',
    )
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
