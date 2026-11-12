import katex from 'katex'

const delimiters = [
  ['$$', '$$', true],
  ['\\[', '\\]', true],
  ['\\(', '\\)', false],
  ['$', '$', false],
] as const

function escaped(text: string, at: number) {
  let slashes = 0
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++
  return slashes % 2 === 1
}

function findClosing(text: string, from: number, close: string) {
  let braces = 0
  for (let i = from; i < text.length; i++) {
    if (braces <= 0 && text.startsWith(close, i) && !escaped(text, i)) return i
    if (text[i] === '\\') i++
    else if (text[i] === '{') braces++
    else if (text[i] === '}') braces--
  }
  return -1
}

/** Only the displayed DOM changes. Original delimiters and TeX stay on the wrapper. */
export function renderEditorMath(root: HTMLElement, editable = true) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(
        'code, pre, a, script, style, textarea, .katex, [data-editor-math-source]',
      )
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)
  for (const textNode of nodes) {
    const text = textNode.data
    const fragment = document.createDocumentFragment()
    let tail = 0
    let changed = false
    for (let i = 0; i < text.length; i++) {
      if (escaped(text, i)) continue
      const delimiter = delimiters.find(([open]) => text.startsWith(open, i))
      if (!delimiter) continue
      const [open, close, displayMode] = delimiter
      const end = findClosing(text, i + open.length, close)
      if (end === -1) continue
      const formula = text.slice(i + open.length, end)
      const stop = end + close.length
      if (formula.trim() && formula.length <= 16000) {
        const span = document.createElement('span')
        try {
          katex.render(formula, span, {
            displayMode,
            throwOnError: true,
            trust: false,
            maxExpand: 1000,
            maxSize: 20,
            output: 'htmlAndMathml',
            strict: 'ignore',
          })
          span.dataset.editorMathSource = text.slice(i, stop)
          span.contentEditable = 'false'
          span.className = displayMode ? 'editor-math editor-math-block' : 'editor-math'
          if (editable) span.title = '点击内容编辑公式'
          fragment.append(document.createTextNode(text.slice(tail, i)), span)
          tail = stop
          changed = true
        } catch {
          // Incomplete or unsupported formulas remain editable source text.
        }
      }
      i = stop - 1
    }
    if (changed) {
      fragment.append(document.createTextNode(text.slice(tail)))
      textNode.replaceWith(fragment)
    }
  }
}

/** Also used on a clone before serialization so KaTeX markup is never persisted. */
export function restoreEditorMath(root: HTMLElement, selected?: HTMLElement): Text | null {
  let selectedText: Text | null = null
  root.querySelectorAll<HTMLElement>('[data-editor-math-source]').forEach((formula) => {
    const text = document.createTextNode(formula.dataset.editorMathSource || '')
    if (formula === selected) selectedText = text
    formula.replaceWith(text)
  })
  return selectedText
}

export function renderMathHtml(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  renderEditorMath(container, false)
  return container.innerHTML
}
