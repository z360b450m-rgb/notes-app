const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const output = buildSync({
  entryPoints: [path.join(root, 'src/composables/useKnowledgeLibraries.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': path.join(root, 'src') },
  write: false,
}).outputFiles[0].text
const compiled = new Module(path.join(__dirname, 'knowledge-import-bundle.cjs'))
compiled._compile(output, path.join(__dirname, 'knowledge-import-bundle.cjs'))
const { useKnowledgeLibraries } = compiled.exports

function setup(t) {
  const storage = new Map([
    ['notes_app_access_token', 'test-token'],
    ['notes_app_current_user', JSON.stringify({ id: 'alice' })],
  ])
  const previousStorage = global.localStorage
  const previousFetch = global.fetch
  global.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  t.after(() => {
    global.localStorage = previousStorage
    global.fetch = previousFetch
  })
  return { storage, libraries: useKnowledgeLibraries() }
}

test('PDF learning import preserves full Markdown and page metadata alongside Markdown imports', async (t) => {
  const { libraries, storage } = setup(t)
  const content =
    '# 学习资料\n\n| 公式 | 含义 |\n| --- | --- |\n| F=ma | 牛顿定律 |\n\n![图表](http://localhost:8000/image)'
  global.fetch = async (url, init) => {
    assert.equal(url, 'http://localhost:8000/api/knowledge/documents/import')
    assert.equal(init.headers.Authorization, 'Bearer test-token')
    assert.equal(init.body.get('file').name, '教材.PDF')
    return Response.json({ content, page_count: 300 })
  }
  await libraries.importFiles([
    new File(['%PDF-1.7'], '教材.PDF'),
    new File(['# Markdown 原文'], '讲义.md'),
  ])
  assert.deepEqual(
    libraries.importResults.value.map((x) => x.success),
    [true, true],
  )
  const pdf = libraries.libraries.value[0]
  assert.equal(pdf.name, '教材')
  assert.equal(pdf.content, content)
  assert.equal(pdf.source.format, 'pdf')
  assert.equal(pdf.source.pageCount, 300)
  assert.equal(JSON.parse(storage.get('review-knowledge-libraries-v1:alice'))[0].content, content)
})

test('PDF at 100 MB is accepted and a larger file is rejected before upload', async (t) => {
  const { libraries } = setup(t)
  let calls = 0
  global.fetch = async () => {
    calls++
    return Response.json({ content: '# 完整学习资料', page_count: 1 })
  }
  const file = new File(['%PDF-1.7'], 'large.pdf')
  Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 })
  await libraries.importFiles([file, { name: 'oversized.pdf', size: 100 * 1024 * 1024 + 1 }])
  assert.equal(calls, 1)
  assert.deepEqual(
    libraries.importResults.value.map((x) => x.success),
    [true, false],
  )
  assert.match(libraries.importResults.value[1].detail, /100 MB/)
})

test('failed PDF parsing never creates a knowledge library and the next file can import', async (t) => {
  const { libraries } = setup(t)
  global.fetch = async () => Response.json({ detail: 'PDF 页数需为 1—300 页' }, { status: 422 })
  await libraries.importFiles([new File(['%PDF'], '教材.pdf'), new File(['# 讲义'], '讲义.md')])
  assert.deepEqual(
    libraries.importResults.value.map((x) => x.success),
    [false, true],
  )
  assert.equal(libraries.libraries.value.length, 1)
  assert.equal(libraries.libraries.value[0].source.format, 'md')
  assert.equal(libraries.importing.value, false)
})
