/** Insert clipboard text into a contenteditable element without carrying HTML formatting. */
export function pastePlainText(event: ClipboardEvent, editor: HTMLElement | null): boolean {
  if (!editor || !event.clipboardData) return false

  event.preventDefault()
  const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
  if (!text) return true

  editor.focus()
  const selection = window.getSelection()
  if (!selection) return true

  let range: Range
  if (selection.rangeCount > 0) {
    const currentRange = selection.getRangeAt(0)
    const ancestor =
      currentRange.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? currentRange.commonAncestorContainer
        : currentRange.commonAncestorContainer.parentNode
    if (ancestor && editor.contains(ancestor)) range = currentRange
    else {
      range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }
  } else {
    range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.deleteContents()
  const fragment = document.createDocumentFragment()
  let lastNode: Node | null = null
  text.split('\n').forEach((line, index) => {
    if (index > 0) {
      lastNode = document.createElement('br')
      fragment.appendChild(lastNode)
    }
    if (line) {
      lastNode = document.createTextNode(line)
      fragment.appendChild(lastNode)
    }
  })

  if (!lastNode) return true
  range.insertNode(fragment)
  range.setStartAfter(lastNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}
