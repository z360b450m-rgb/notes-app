import { onBeforeUnmount, watch } from 'vue'
import { renderEditorMath, restoreEditorMath } from '@/utils/editorMath'

/** Owns the read/edit DOM lifecycle without emitting content changes. */
export function useMathPreview(getEditor: () => HTMLElement | null) {
  let editor: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let editing = false

  function showPreview() {
    if (!editor?.isConnected || editor.contains(document.activeElement)) return
    const active = document.activeElement
    if (
      editing &&
      active instanceof Element &&
      active.closest(
        '[data-editor-toolbar], .editor-formatting-group, [data-ui-menu], dialog, [role="dialog"]',
      )
    )
      return
    renderEditorMath(editor)
    editor.dataset.mathMode = 'reading'
    editing = false
  }
  function schedulePreview() {
    queueMicrotask(showPreview)
  }
  function startEditing() {
    if (!editor || editor.contentEditable === 'false') return
    restoreEditorMath(editor)
    editor.dataset.mathMode = 'editing'
    editing = true
  }
  function editFormula(event: PointerEvent) {
    const formula =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-editor-math-source]')
        : null
    if (!editor || !formula || editor.contentEditable === 'false' || event.button !== 0) return
    event.preventDefault()
    const source = restoreEditorMath(editor, formula)
    editor.focus()
    if (source) {
      const range = document.createRange()
      range.selectNodeContents(source)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }
  function detach() {
    observer?.disconnect()
    editor?.removeEventListener('focus', startEditing)
    editor?.removeEventListener('blur', schedulePreview)
    editor?.removeEventListener('pointerdown', editFormula)
    document.removeEventListener('focusin', schedulePreview)
    document.removeEventListener('pointerup', schedulePreview)
    editor = null
    editing = false
  }
  watch(
    getEditor,
    (value) => {
      detach()
      editor = value
      if (!editor) return
      editor.addEventListener('focus', startEditing)
      editor.addEventListener('blur', schedulePreview)
      editor.addEventListener('pointerdown', editFormula)
      document.addEventListener('focusin', schedulePreview)
      document.addEventListener('pointerup', schedulePreview)
      observer = new MutationObserver(schedulePreview)
      observer.observe(editor, { childList: true, characterData: true, subtree: true })
      schedulePreview()
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(detach)
}
