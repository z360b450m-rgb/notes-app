import MarkdownIt from 'markdown-it'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })

// 公式先作为独立token解析，避免下划线、反斜杠被Markdown提前处理。
markdown.inline.ruler.before('escape', 'learning_math', (state, silent) => {
  const start = state.pos
  const source = state.src
  const delimiters = [
    ['$$', '$$', true],
    ['\\[', '\\]', true],
    ['\\(', '\\)', false],
    ['$', '$', false],
  ] as const
  for (const [open, close, display] of delimiters) {
    if (!source.startsWith(open, start)) continue
    const contentStart = start + open.length
    let end = source.indexOf(close, contentStart)
    if (close.startsWith('$')) {
      while (end !== -1) {
        let escapes = 0
        for (let i = end - 1; i >= contentStart && source[i] === '\\'; i--) escapes++
        if (escapes % 2 === 0) break
        end = source.indexOf(close, end + close.length)
      }
    }
    if (end === -1) {
      if (!state.env.pending) return false
      if (!silent) state.push('math_pending', '', 0)
      state.pos = source.length
      return true
    }
    const content = source.slice(contentStart, end).trim()
    if (!content) return false
    if (!silent) {
      const token = state.push('learning_math', '', 0)
      token.content = content
      token.meta = { display }
    }
    state.pos = end + close.length
    return true
  }
  return false
})

// 独立行公式作为块级内容，避免将div嵌入段落。
markdown.block.ruler.before('fence', 'learning_math_block', (state, startLine, endLine, silent) => {
  const line = state.src.slice(
    state.bMarks[startLine] + state.tShift[startLine],
    state.eMarks[startLine],
  )
  if (state.sCount[startLine] >= 4) return false
  const open = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : ''
  if (!open) return false
  const close = open === '$$' ? '$$' : '\\]'
  let content = ''
  let lastLine = startLine
  for (; lastLine < endLine; lastLine++) {
    const text =
      lastLine === startLine
        ? line.slice(open.length)
        : state.src.slice(state.bMarks[lastLine] + state.tShift[lastLine], state.eMarks[lastLine])
    const end = text.indexOf(close)
    if (end !== -1) {
      if (text.slice(end + close.length).trim()) return false
      content += text.slice(0, end)
      break
    }
    content += text + '\n'
  }
  if (lastLine === endLine || !content.trim()) return false
  if (silent) return true
  const token = state.push('learning_math', '', 0)
  token.block = true
  token.content = content.trim()
  token.meta = { display: true }
  token.map = [startLine, lastLine + 1]
  state.line = lastLine + 1
  return true
})

markdown.renderer.rules.learning_math = (tokens, index) => {
  const token = tokens[index]
  const math = katex.renderToString(token.content, {
    displayMode: token.meta.display,
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
    maxSize: 20,
    output: 'htmlAndMathml',
  })
  return token.block ? `<div class="answer-formula">${math}</div>\n` : math
}
markdown.renderer.rules.math_pending = () => '<span class="formula-pending">公式生成中…</span>'

export function renderLearningAnswer(text: string, pending = false): string {
  // 只处理显示副本，原始答案及数学语义保持不变。
  const normalized = text.replace(/\r\n?/g, '\n').split('\u0000').join('')
  return DOMPurify.sanitize(markdown.render(normalized, { pending }))
}
