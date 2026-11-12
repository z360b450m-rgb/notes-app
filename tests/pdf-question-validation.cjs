const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const source = fs.readFileSync(path.join(__dirname, '../src/services/pdfQuestionDraft.ts'), 'utf8')
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
function question(overrides = {}) {
  return {
    stem: 'Which graph is correct?',
    kind: 'choice',
    option_mode: 'text',
    asset_keys: [],
    options: [
      { key: 'A', text: 'first' },
      { key: 'B', text: 'second' },
    ],
    ...overrides,
  }
}

test('a combined graphical option image needs no fabricated textual options', async () => {
  const { pdfQuestionIssues } = await modulePromise
  assert.deepEqual(
    pdfQuestionIssues(question({ option_mode: 'image', options: [], asset_keys: ['figure'] })),
    [],
  )
  assert.deepEqual(pdfQuestionIssues(question({ option_mode: 'image', options: [] })), [
    '图形选项缺少本题原图',
  ])
  assert.match(
    pdfQuestionIssues(question({ options: [], asset_keys: ['figure'] }))[0],
    /0 个文字选项/,
  )
})

test('text option problems specify duplicate and empty option letters', async () => {
  const { pdfQuestionIssues } = await modulePromise
  assert.deepEqual(
    pdfQuestionIssues(
      question({
        options: [
          { key: 'A', text: 'first' },
          { key: 'A', text: 'second' },
          { key: 'B', text: ' ' },
        ],
      }),
    ),
    ['选项字母重复：A', '选项内容为空：B'],
  )
  assert.match(
    pdfQuestionIssues(question({ options: [{ key: '', text: 'first' }] })).join(';'),
    /选项字母/,
  )
})

test('edited invalid options in image mode still need correction; subjective questions need no options', async () => {
  const { pdfQuestionIssues } = await modulePromise
  assert.match(
    pdfQuestionIssues(question({ option_mode: 'image', options: [{ key: 'A', text: '' }] })).join(
      ';',
    ),
    /选项内容为空：A/,
  )
  assert.deepEqual(pdfQuestionIssues(question({ kind: 'free_response', options: [] })), [])
})
