const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const source = fs.readFileSync(path.join(__dirname, '../src/services/pdfImport.ts'), 'utf8')
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function request(overrides = {}) {
  return {
    file: new File(['%PDF-1.7'], 'questions.pdf', { type: 'application/pdf' }),
    notebookId: 'notebook-a',
    signal: new AbortController().signal,
    onProgress: () => {},
    ...overrides,
  }
}

test('an unregistered service reports unavailable and does not simulate success', async () => {
  const service = await modulePromise
  await assert.rejects(service.importPdf(request()), /服务暂不可用/)
})

test('the adapter receives the original file, frozen notebook and progress callback', async (t) => {
  const service = await modulePromise
  const progress = []
  const input = request({ onProgress: (message) => progress.push(message) })
  t.after(
    service.registerPdfImportHandler(async (value) => {
      assert.equal(value, input)
      value.onProgress('正在识别题目')
      return { status: 'submitted', taskId: 'job-123' }
    }),
  )
  assert.deepEqual(await service.importPdf(input), { status: 'submitted', taskId: 'job-123' })
  assert.deepEqual(progress, ['正在识别题目'])
})

test('invalid files and targets are rejected before invoking an adapter', async (t) => {
  const service = await modulePromise
  let calls = 0
  t.after(
    service.registerPdfImportHandler(async () => {
      calls++
      return { status: 'completed', importedCount: 1 }
    }),
  )
  await assert.rejects(service.importPdf(request({ notebookId: '' })), /选择目标错题本/)
  await assert.rejects(
    service.importPdf(request({ file: new File(['text'], 'file.md') })),
    /请选择 PDF/,
  )
  await assert.rejects(service.importPdf(request({ file: new File([], 'empty.pdf') })), /文件为空/)
  await assert.rejects(
    service.importPdf(request({ file: { name: 'large.pdf', size: 100 * 1024 * 1024 + 1 } })),
    /100 MB/,
  )
  assert.equal(calls, 0)
})

test('missing task identifiers and invalid saved counts cannot appear as success', async () => {
  const service = await modulePromise
  for (const result of [
    null,
    { status: 'submitted', taskId: '' },
    { status: 'completed', importedCount: -1 },
    { status: 'completed', importedCount: 1.5 },
    { status: 'ready_for_review', importedCount: 5 },
  ]) {
    const unregister = service.registerPdfImportHandler(async () => result)
    try {
      await assert.rejects(service.importPdf(request()), /无效结果/)
    } finally {
      unregister()
    }
  }
})

test('a canceled request does not report a late response as successful', async (t) => {
  const service = await modulePromise
  const controller = new AbortController()
  t.after(
    service.registerPdfImportHandler(async () => {
      controller.abort()
      return { status: 'completed', importedCount: 5 }
    }),
  )
  await assert.rejects(service.importPdf(request({ signal: controller.signal })), {
    name: 'AbortError',
  })
})
