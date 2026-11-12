// Deterministic service checks: no live API, credentials, or user-data writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadService(file, fetch, timer = setTimeout) {
  const storage = new Map([
    ['notes_app_access_token', 'test-token'],
    ['notes_app_current_user', JSON.stringify({ id: 'test-owner' })],
  ])
  const exports = {}
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../../src/services', file), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText
  const context = vm.createContext({
    exports,
    fetch,
    Headers,
    AbortController,
    setTimeout: timer,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    require(name) {
      if (name === './entrySummary') {
        const helpers = {}
        const source = ts.transpileModule(
          fs.readFileSync(path.join(__dirname, '../../src/services/entrySummary.ts'), 'utf8'),
          {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          },
        ).outputText
        vm.runInNewContext(source, { exports: helpers })
        return helpers
      }
      if (name.endsWith('/auth'))
        return { getAccessToken: () => 'test-token', getStoredUser: () => ({ id: 'test-owner' }) }
      if (name.endsWith('/imageStorage')) return { toRemoteHtml: async (html) => html }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  vm.runInContext(source, context)
  return { api: exports, storage }
}

const queueKey = 'offline_pending_sync_queue_v1:test-owner'
const notebook = (id) => ({
  id,
  name: id,
  description: '',
  instructions: '',
  createdAt: 1,
  updatedAt: 1,
})
const queued = (id, timestamp = 1) => ({
  id: `notebook:${id}`,
  action: 'put_notebook',
  payload: notebook(id),
  timestamp,
})
const json = (value = {}, status = 200) => new Response(JSON.stringify(value), { status })

async function run() {
  let probes = 0
  const empty = loadService('apiAdapter.ts', async () => {
    probes++
    return json()
  })
  await empty.api.flushPendingQueue()
  assert.equal(probes, 0, 'An empty queue must not probe the API')

  let release
  let notifyStarted
  const held = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    notifyStarted = resolve
  })
  const slow = loadService('apiAdapter.ts', async (_url, init) => {
    if (init.method === 'PATCH') {
      notifyStarted()
      await held
    }
    return json()
  })
  slow.storage.set(
    queueKey,
    JSON.stringify(Array.from({ length: 20 }, (_, i) => queued(`nb-${i}`))),
  )
  const flushing = slow.api.flushPendingQueue()
  await started
  const local = [notebook('nb-0')]
  const fallback = { getAll: async () => local, put: async () => {}, delete: async () => {} }
  let deadline
  const reads = Promise.all([
    slow.api.smartNotebookRepository(fallback).getAll(),
    slow.api.smartEntryRepository(fallback).getAll('nb-0'),
    slow.api.smartQuestionGroupRepository(fallback).getAll('nb-0'),
  ])
  try {
    const results = await Promise.race([
      reads,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Reads waited for background sync')), 1000)
      }),
    ])
    assert(
      results[0].some((item) => item.id === 'nb-0'),
      'Keep cached metadata available during sync',
    )
    assert.equal(results[0].length, 20, 'Pending notebook creations must remain visible')
    results.slice(1).forEach((result) => assert.equal(result, local))
    // A newer edit queued while the old request is in flight must survive.
    const items = JSON.parse(slow.storage.get(queueKey))
    items[0].timestamp = 2
    slow.storage.set(queueKey, JSON.stringify(items))
  } finally {
    clearTimeout(deadline)
    release()
    await flushing
  }
  assert.deepEqual(
    JSON.parse(slow.storage.get(queueKey)).map((item) => item.timestamp),
    [2],
  )

  let writes = 0
  const failing = loadService('apiAdapter.ts', async (_url, init) => {
    if (init.method === 'PATCH') return json({}, ++writes === 1 ? 200 : 503)
    return json()
  })
  failing.storage.set(
    queueKey,
    JSON.stringify(Array.from({ length: 20 }, (_, i) => queued(`nb-${i}`))),
  )
  assert.equal(await failing.api.flushPendingQueue(), 1)
  assert.equal(writes, 2, 'Stop retrying the whole queue when the backend fails')
  assert.equal(
    JSON.parse(failing.storage.get(queueKey)).length,
    19,
    'Failed and unattempted writes must remain queued',
  )

  const hanging = (_url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  const auth = loadService('auth.ts', hanging, (callback) => setTimeout(callback, 20))
  await assert.rejects(
    auth.api.fetchCurrentUser(),
    (error) => error.message.includes('超时') && error.status === undefined,
  )
  assert.equal(auth.api.getAccessToken(), 'test-token', 'Network failure must retain the session')
  const unauthorized = loadService('auth.ts', async () => json({ detail: 'expired' }, 401))
  await assert.rejects(unauthorized.api.fetchCurrentUser(), (error) => error.status === 401)
  // Include response-body stalls in the auth timeout, not just response headers.
  const stalledBody = loadService(
    'auth.ts',
    async (url, init) => ({ ok: true, json: () => hanging(url, init) }),
    (callback) => setTimeout(callback, 20),
  )
  await assert.rejects(stalledBody.api.fetchCurrentUser(), (error) =>
    error.message.includes('超时'),
  )
  const stalledEntry = loadService(
    'apiAdapter.ts',
    async (url, init) => ({ ok: true, json: () => hanging(url, init) }),
    (callback) => setTimeout(callback, 20),
  )
  await assert.rejects(
    stalledEntry.api.smartEntryRepository({ getSummaries: async () => [] }).getSummaries('n1'),
  )
  console.log(
    'PASS: nonblocking reads, empty queues, bounded retry batches, concurrent edits, auth/body timeouts and session retention',
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
