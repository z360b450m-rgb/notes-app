/** Keep the insertion position while a modal owns the browser selection. */
export function captureEditorRange(editor: HTMLElement | null): Range | null {
  const selection = window.getSelection()
  if (!editor || !selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null
}

/** OCR is untrusted plain text: never insert it as HTML. */
export function insertImageText(
  editor: HTMLElement,
  text: string,
  imageUrl: string | undefined,
  savedRange: Range | null,
) {
  const fragment = document.createDocumentFragment()
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!text) break
    fragment.appendChild(document.createTextNode(line))
    fragment.appendChild(document.createElement('br'))
  }
  if (imageUrl) {
    const image = document.createElement('img')
    image.src = imageUrl
    image.className = 'max-w-full rounded-md'
    fragment.appendChild(image)
    fragment.appendChild(document.createElement('br'))
  }
  const last = fragment.lastChild
  if (!last) return
  const range =
    savedRange && editor.contains(savedRange.commonAncestorContainer)
      ? savedRange
      : document.createRange()
  if (range !== savedRange) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  range.deleteContents()
  range.insertNode(fragment)
  range.setStartAfter(last)
  range.collapse(true)
  editor.focus()
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
