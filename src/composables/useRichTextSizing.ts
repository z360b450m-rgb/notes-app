import { computed, onBeforeUnmount, ref } from 'vue'

const FONT_COMMAND_SIZES: Record<string, string> = {
  '13': '3',
  '16': '4',
  '18': '5',
  '24': '6',
  '32': '7',
}

function rangeBelongsToEditor(range: Range, editor: HTMLElement): boolean {
  const node = range.commonAncestorContainer
  return editor.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode)
}

export function useRichTextSizing(
  getEditor: () => HTMLElement | null,
  onContentChange: () => void,
) {
  const selectedImage = ref<HTMLImageElement | null>(null)
  const hasSelectedImage = computed(() => !!selectedImage.value && selectedImage.value.isConnected)
  let savedRange: Range | null = null

  function clearSelectedImage() {
    selectedImage.value?.classList.remove('image-size-selected')
    selectedImage.value = null
  }

  function captureSelection() {
    const editor = getEditor()
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (rangeBelongsToEditor(range, editor)) savedRange = range.cloneRange()
  }

  function handleEditorClick(event: MouseEvent) {
    const editor = getEditor()
    const target = event.target
    if (!editor || !(target instanceof HTMLElement)) return

    if (target instanceof HTMLImageElement && editor.contains(target)) {
      clearSelectedImage()
      selectedImage.value = target
      target.classList.add('image-size-selected')
    } else {
      clearSelectedImage()
    }
    captureSelection()
  }

  function restoreSelectionOrSelectAll(editor: HTMLElement): Selection | null {
    const selection = window.getSelection()
    if (!selection) return null
    editor.focus()
    selection.removeAllRanges()

    if (savedRange && rangeBelongsToEditor(savedRange, editor) && !savedRange.collapsed) {
      selection.addRange(savedRange)
      return selection
    }

    const range = document.createRange()
    range.selectNodeContents(editor)
    selection.addRange(range)
    return selection
  }

  function normalizeFontElements(editor: HTMLElement) {
    for (const font of Array.from(editor.querySelectorAll('font[size]'))) {
      const size = font.getAttribute('size') || '4'
      const px =
        Object.entries(FONT_COMMAND_SIZES).find(([, commandSize]) => commandSize === size)?.[0] ||
        '16'
      const span = document.createElement('span')
      span.style.fontSize = `${px}px`
      while (font.firstChild) span.appendChild(font.firstChild)
      font.replaceWith(span)
    }
  }

  function applyFontSize(px: string) {
    const editor = getEditor()
    const commandSize = FONT_COMMAND_SIZES[px]
    if (!editor || !commandSize || !restoreSelectionOrSelectAll(editor)) return

    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand('fontSize', false, commandSize)
    normalizeFontElements(editor)
    captureSelection()
    onContentChange()
  }

  function applyImageWidth(width: string) {
    const image = selectedImage.value
    if (!image || !image.isConnected) return

    if (width === 'auto') {
      image.style.removeProperty('width')
    } else {
      image.style.width = `${width}%`
    }
    image.style.height = 'auto'
    image.style.maxWidth = '100%'
    onContentChange()
  }

  function serializeHtml(): string {
    const editor = getEditor()
    if (!editor) return ''
    const clone = editor.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.image-size-selected').forEach((image) => {
      image.classList.remove('image-size-selected')
    })
    return clone.innerHTML
  }

  function resetSizingState() {
    clearSelectedImage()
    savedRange = null
  }

  onBeforeUnmount(resetSizingState)

  return {
    hasSelectedImage,
    captureSelection,
    handleEditorClick,
    applyFontSize,
    applyImageWidth,
    serializeHtml,
    resetSizingState,
  }
}
