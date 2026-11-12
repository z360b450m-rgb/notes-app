import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { restoreEditorMath } from '../utils/editorMath'

const HIGHLIGHT_COLORS = new Set(['#fff59d', '#bbf7d0', '#bfdbfe', '#fbcfe8', 'transparent'])
const BOLD_TYPING_MARKER = '\u200B'
export const rememberedHighlightColor = ref('#fff59d')

function rangeBelongsToEditor(range: Range, editor: HTMLElement): boolean {
  const node = range.commonAncestorContainer
  return editor.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode)
}

export function useRichTextSizing(
  getEditor: () => HTMLElement | null,
  onContentChange: () => void,
  onInternalLinkClick?: (targetId: string) => void,
) {
  const selectedImage = ref<HTMLImageElement | null>(null)
  const imageWidth = ref('auto')
  const hasSelectedImage = computed(() => !!selectedImage.value && selectedImage.value.isConnected)
  const hasTextSelection = ref(false)
  const isBold = ref(false)
  const boldMixed = ref(false)
  const highlightColor = ref('transparent')
  const selectedInternalLinkId = ref<string | null>(null)
  let savedRange: Range | null = null
  let clearTypingHighlight = false
  let pendingHighlightColor: string | null = null
  let typingCaret: Range | null = null
  let compositionRange: Range | null = null
  let composing = false
  let mountedEditor: HTMLElement | null = null
  let linkCompositionMarker: HTMLElement | null = null

  function leaveTrailingLink(): boolean {
    const editor = getEditor()
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return false
    const range = selection.getRangeAt(0)
    if (!rangeBelongsToEditor(range, editor)) return false
    const container = range.startContainer
    const element = container instanceof Element ? container : container.parentElement
    let link = element?.closest<HTMLElement>('[data-entry-link]') || null
    if (!link && container instanceof Element) {
      const previous = container.childNodes[range.startOffset - 1]
      if (previous instanceof HTMLElement && previous.matches('[data-entry-link]')) link = previous
    }
    if (!link || !editor.contains(link)) return false
    if (link.contains(container)) {
      const tail = document.createRange()
      tail.selectNodeContents(link)
      tail.setStart(container, range.startOffset)
      if (tail.toString() || tail.cloneContents().querySelector('img, br')) return false
    }
    range.setStartAfter(link)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    savedRange = range.cloneRange()
    selectedInternalLinkId.value = null
    return true
  }

  function sameCaret(a: Range, b: Range) {
    return (
      a.collapsed &&
      b.collapsed &&
      a.startContainer === b.startContainer &&
      a.startOffset === b.startOffset
    )
  }

  function handleBeforeInput(event: InputEvent) {
    const leavingLink =
      !event.isComposing && event.inputType.startsWith('insert') && leaveTrailingLink()
    if (
      leavingLink &&
      event.cancelable &&
      ['insertParagraph', 'insertLineBreak'].includes(event.inputType)
    ) {
      event.preventDefault()
      document.execCommand(
        'insertHTML',
        false,
        `<span data-link-typing="true">${BOLD_TYPING_MARKER}</span>`,
      )
      const marker = getEditor()?.querySelector<HTMLElement>('[data-link-typing]')
      document.execCommand(
        event.inputType === 'insertParagraph' ? 'insertParagraph' : 'insertLineBreak',
        false,
      )
      if (marker) clearLinkMarker(marker)
      captureSelection()
      onContentChange()
      return
    }
    if (
      (!clearTypingHighlight && !leavingLink) ||
      event.isComposing ||
      event.inputType !== 'insertText' ||
      !event.data ||
      !event.cancelable
    )
      return
    event.preventDefault()
    // Chromium inherits the surrounding span after hiliteColor('transparent') at a caret.
    // Native HTML insertion splits that span and preserves the browser's undo history.
    const span = document.createElement('span')
    if (clearTypingHighlight) span.style.backgroundColor = 'transparent'
    const content = document.queryCommandState('bold')
      ? span.appendChild(document.createElement('strong'))
      : span
    content.textContent = event.data
    document.execCommand('insertHTML', false, span.outerHTML)
    typingCaret = window.getSelection()?.getRangeAt(0).cloneRange() || null
    captureSelection()
    onContentChange()
  }

  function handlePaste(event: ClipboardEvent) {
    const leavingLink = leaveTrailingLink()
    if (
      (!clearTypingHighlight && !leavingLink) ||
      !event.clipboardData ||
      Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/'))
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    const span = document.createElement('span')
    if (clearTypingHighlight) span.style.backgroundColor = 'transparent'
    const content = document.queryCommandState('bold')
      ? span.appendChild(document.createElement('strong'))
      : span
    const lines = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').split('\n')
    lines.forEach((line, index) => {
      if (index) content.appendChild(document.createElement('br'))
      content.appendChild(document.createTextNode(line))
    })
    document.execCommand('insertHTML', false, span.outerHTML)
    typingCaret = window.getSelection()?.getRangeAt(0).cloneRange() || null
    captureSelection()
    onContentChange()
  }

  function handleCompositionStart() {
    composing = true
    if (leaveTrailingLink()) {
      // IME needs an actual text position outside the anchor, rather than its equivalent end boundary.
      document.execCommand(
        'insertHTML',
        false,
        `<span data-link-typing="true">${BOLD_TYPING_MARKER}</span>`,
      )
      linkCompositionMarker = getEditor()?.querySelector<HTMLElement>('[data-link-typing]') || null
    }
    compositionRange = clearTypingHighlight
      ? window.getSelection()?.getRangeAt(0).cloneRange() || null
      : null
  }

  function handleFormattingInput(event: InputEvent) {
    const editor = getEditor()
    if (editor && !event.isComposing) normalizeHighlights(editor)
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      pendingHighlightColor = null
      clearTypingHighlight = false
      typingCaret = null
    } else if (pendingHighlightColor !== null) {
      const selection = window.getSelection()
      if (
        selection?.rangeCount &&
        editor &&
        rangeBelongsToEditor(selection.getRangeAt(0), editor)
      ) {
        typingCaret = selection.getRangeAt(0).cloneRange()
      }
    }
  }

  function handleCompositionEnd() {
    composing = false
    const selection = window.getSelection()
    if (linkCompositionMarker) {
      clearLinkMarker(linkCompositionMarker)
      linkCompositionMarker = null
      captureSelection()
      onContentChange()
    }
    if (!compositionRange || !selection?.rangeCount) return
    const end = selection.getRangeAt(0)
    compositionRange.setEnd(end.endContainer, end.endOffset)
    selection.removeAllRanges()
    selection.addRange(compositionRange)
    document.execCommand('hiliteColor', false, 'transparent')
    selection.collapseToEnd()
    typingCaret = selection.getRangeAt(0).cloneRange()
    compositionRange = null
    captureSelection()
    onContentChange()
  }

  function clearLinkMarker(marker: HTMLElement) {
    const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const markerOffset = node.textContent?.indexOf(BOLD_TYPING_MARKER) ?? -1
      if (markerOffset >= 0) (node as Text).deleteData(markerOffset, 1)
      node = walker.nextNode()
    }
    marker.removeAttribute('data-link-typing')
    if (!marker.textContent && !marker.children.length) marker.remove()
  }

  function clearSelectedImage() {
    selectedImage.value?.classList.remove('image-size-selected')
    selectedImage.value = null
    imageWidth.value = 'auto'
  }

  function captureSelection() {
    const editor = getEditor()
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (rangeBelongsToEditor(range, editor)) {
      if (
        pendingHighlightColor !== null &&
        typingCaret &&
        !compositionRange &&
        !composing &&
        !sameCaret(range, typingCaret)
      ) {
        clearTypingHighlight = false
        pendingHighlightColor = null
        typingCaret = null
      }
      savedRange = range.cloneRange()
      hasTextSelection.value = !range.collapsed
      isBold.value = document.queryCommandState('bold')
      boldMixed.value = !range.collapsed && document.queryCommandIndeterm('bold')
      const colors = new Set<string>()
      const readColor = (node: Node): string => {
        let element =
          node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
        while (element && element !== editor) {
          const color = getComputedStyle(element).backgroundColor
          if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
            const probe = document.createElement('span')
            for (const candidate of HIGHLIGHT_COLORS) {
              probe.style.backgroundColor = candidate
              if (probe.style.backgroundColor === color) return candidate
            }
            return 'mixed'
          }
          element = element.parentElement
        }
        return 'transparent'
      }
      if (range.collapsed) {
        const color = document.queryCommandValue('hiliteColor')
        const probe = document.createElement('span')
        highlightColor.value = readColor(range.startContainer)
        for (const candidate of HIGHLIGHT_COLORS) {
          probe.style.backgroundColor = candidate
          if (probe.style.backgroundColor === color) highlightColor.value = candidate
        }
        if (pendingHighlightColor !== null) highlightColor.value = pendingHighlightColor
      } else {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node) {
          const part = document.createRange()
          part.selectNodeContents(node)
          if (
            node.textContent &&
            range.compareBoundaryPoints(Range.END_TO_START, part) < 0 &&
            range.compareBoundaryPoints(Range.START_TO_END, part) > 0
          )
            colors.add(readColor(node))
          node = walker.nextNode()
        }
        highlightColor.value = colors.size === 1 ? [...colors][0]! : 'mixed'
      }
    }
  }

  function handleEditorClick(event: MouseEvent) {
    const editor = getEditor()
    const target = event.target
    if (!editor || !(target instanceof HTMLElement)) return

    const internalLink = target.closest<HTMLElement>('[data-entry-link]')
    if (internalLink && editor.contains(internalLink)) {
      event.preventDefault()
      event.stopPropagation()
      const targetId = internalLink.dataset.entryLink?.trim()
      if (targetId) {
        const range = document.createRange()
        range.selectNodeContents(internalLink)
        savedRange = range
        hasTextSelection.value = true
        selectedInternalLinkId.value = targetId
        onInternalLinkClick?.(targetId)
      }
      return
    }
    selectedInternalLinkId.value = null

    if (target instanceof HTMLImageElement && editor.contains(target)) {
      clearSelectedImage()
      selectedImage.value = target
      const width = target.style.width.replace('%', '')
      imageWidth.value = ['25', '50', '75', '100'].includes(width) ? width : 'auto'
      target.classList.add('image-size-selected')
    } else {
      clearSelectedImage()
    }
    captureSelection()
  }

  function insertInternalLink(targetId: string, fallbackText: string): boolean {
    const editor = getEditor()
    if (!editor || !targetId.trim()) return false
    const selection = restoreEditorSelection(editor, false)
    if (!selection || selection.rangeCount === 0) return false

    const range = selection.getRangeAt(0)
    const existingLink =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as HTMLElement).closest<HTMLElement>('[data-entry-link]')
        : range.commonAncestorContainer.parentElement?.closest<HTMLElement>('[data-entry-link]')

    if (existingLink && editor.contains(existingLink)) {
      existingLink.dataset.entryLink = targetId
      if (existingLink.dataset.entryLinkLabel === 'auto') {
        existingLink.textContent = fallbackText.trim() || '关联题目'
      }
      selectedInternalLinkId.value = targetId
      range.setStartAfter(existingLink)
      range.collapse(true)
    } else {
      const link = document.createElement('a')
      link.dataset.entryLink = targetId
      link.setAttribute('role', 'link')
      link.setAttribute('tabindex', '0')
      if (range.collapsed) {
        link.dataset.entryLinkLabel = 'auto'
        link.textContent = fallbackText.trim() || '关联题目'
      } else {
        link.dataset.entryLinkLabel = 'custom'
        const content = range.extractContents()
        for (const nestedLink of Array.from(content.querySelectorAll('a'))) {
          nestedLink.replaceWith(...Array.from(nestedLink.childNodes))
        }
        link.appendChild(content)
      }
      range.insertNode(link)
      range.setStartAfter(link)
      range.collapse(true)
      selectedInternalLinkId.value = targetId
    }

    selection.removeAllRanges()
    selection.addRange(range)
    savedRange = range.cloneRange()
    hasTextSelection.value = false
    onContentChange()
    return true
  }

  function removeInternalLink(): boolean {
    const editor = getEditor()
    if (!editor || !savedRange || !rangeBelongsToEditor(savedRange, editor)) return false
    const container = savedRange.commonAncestorContainer
    const link =
      (container.nodeType === Node.ELEMENT_NODE
        ? (container as HTMLElement)
        : container.parentElement
      )?.closest<HTMLElement>('[data-entry-link]') || null
    if (!link || !editor.contains(link)) return false

    const parent = link.parentNode
    if (!parent) return false
    const fragment = document.createDocumentFragment()
    while (link.firstChild) fragment.appendChild(link.firstChild)
    const lastNode = fragment.lastChild
    parent.replaceChild(fragment, link)
    if (lastNode) {
      const range = document.createRange()
      range.setStartAfter(lastNode)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      savedRange = range.cloneRange()
    }
    selectedInternalLinkId.value = null
    hasTextSelection.value = false
    onContentChange()
    return true
  }

  function restoreEditorSelection(
    editor: HTMLElement,
    requireTextSelection = true,
  ): Selection | null {
    const selection = window.getSelection()
    if (!selection) return null
    editor.focus()
    selection.removeAllRanges()

    if (savedRange && rangeBelongsToEditor(savedRange, editor)) {
      if (requireTextSelection && savedRange.collapsed) return null
      selection.addRange(savedRange)
    } else {
      if (requireTextSelection) return null
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.addRange(range)
    }
    return selection
  }

  function normalizeHighlights(editor: HTMLElement) {
    for (const element of Array.from(
      editor.querySelectorAll<HTMLElement>('[style], .text-highlight'),
    )) {
      const color = element.style.backgroundColor.replace(/\s/g, '').toLowerCase()
      if (!color || color === 'transparent' || color === 'rgba(0,0,0,0)') {
        element.style.removeProperty('background-color')
        element.classList.remove('text-highlight')
      } else if (color) {
        element.classList.add('text-highlight')
      }
      if (element.style.length === 0) element.removeAttribute('style')
    }
  }

  function normalizeSerializedFormatting(root: HTMLElement) {
    root
      .querySelectorAll('[data-link-typing]')
      .forEach((marker) => marker.removeAttribute('data-link-typing'))
    for (const marker of Array.from(root.querySelectorAll('[data-bold-typing]'))) {
      marker.removeAttribute('data-bold-typing')
    }
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let textNode = textWalker.nextNode()
    while (textNode) {
      textNode.textContent = (textNode.textContent || '').replaceAll(BOLD_TYPING_MARKER, '')
      textNode = textWalker.nextNode()
    }

    for (const bold of Array.from(root.querySelectorAll('b'))) {
      const strong = document.createElement('strong')
      for (const attribute of Array.from(bold.attributes)) {
        strong.setAttribute(attribute.name, attribute.value)
      }
      while (bold.firstChild) strong.appendChild(bold.firstChild)
      bold.replaceWith(strong)
    }

    for (const font of Array.from(root.querySelectorAll('font'))) {
      const span = document.createElement('span')
      for (const attribute of Array.from(font.attributes)) {
        if (attribute.name !== 'size') span.setAttribute(attribute.name, attribute.value)
      }
      while (font.firstChild) span.appendChild(font.firstChild)
      font.replaceWith(span)
    }

    for (const span of Array.from(root.querySelectorAll('span'))) {
      if (span.style.length === 0) span.removeAttribute('style')
      if (span.attributes.length === 0) span.replaceWith(...Array.from(span.childNodes))
    }

    for (const element of Array.from(root.querySelectorAll('strong, span'))) {
      if (!element.textContent && element.children.length === 0) element.remove()
    }
  }

  function toggleBold() {
    const editor = getEditor()
    if (!editor || !restoreEditorSelection(editor, false)) return
    // Native editing keeps caret formatting and undo in the same browser transaction.
    document.execCommand('styleWithCSS', false, 'false')
    document.execCommand('bold', false)
    if (pendingHighlightColor !== null)
      typingCaret = window.getSelection()?.getRangeAt(0).cloneRange() || null
    captureSelection()
    onContentChange()
  }

  function applyHighlight(color: string) {
    const editor = getEditor()
    if (!editor || !HIGHLIGHT_COLORS.has(color) || !restoreEditorSelection(editor, false)) return
    if (color !== 'transparent') rememberedHighlightColor.value = color

    const caretOnly = window.getSelection()?.isCollapsed ?? true
    document.execCommand('styleWithCSS', false, 'true')
    const applied = document.execCommand('hiliteColor', false, color)
    if (!applied) document.execCommand('backColor', false, color)
    // Do not reset styleWithCSS after a caret command: Chromium uses it for pending typing styles.
    if (!caretOnly) normalizeHighlights(editor)
    captureSelection()
    clearTypingHighlight = !!savedRange?.collapsed && color === 'transparent'
    pendingHighlightColor = savedRange?.collapsed ? color : null
    typingCaret = pendingHighlightColor !== null ? savedRange!.cloneRange() : null
    if (savedRange?.collapsed) highlightColor.value = color
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
    imageWidth.value = width
    onContentChange()
  }

  function serializeHtml(): string {
    const editor = getEditor()
    if (!editor) return ''
    const clone = editor.cloneNode(true) as HTMLElement
    restoreEditorMath(clone)
    clone.querySelectorAll('.image-size-selected').forEach((image) => {
      image.classList.remove('image-size-selected')
    })
    clone.querySelectorAll('[data-entry-link-state]').forEach((link) => {
      link.removeAttribute('data-entry-link-state')
      link.removeAttribute('title')
    })
    normalizeSerializedFormatting(clone)
    normalizeHighlights(clone)
    return clone.innerHTML
  }

  function resetSizingState() {
    clearSelectedImage()
    savedRange = null
    clearTypingHighlight = false
    pendingHighlightColor = null
    typingCaret = null
    compositionRange = null
    composing = false
    linkCompositionMarker = null
    hasTextSelection.value = false
    isBold.value = false
    boldMixed.value = false
    highlightColor.value = 'transparent'
    selectedInternalLinkId.value = null
  }

  function detachEditor() {
    mountedEditor?.removeEventListener('beforeinput', handleBeforeInput)
    mountedEditor?.removeEventListener('input', handleFormattingInput)
    mountedEditor?.removeEventListener('paste', handlePaste, true)
    mountedEditor?.removeEventListener('compositionstart', handleCompositionStart)
    mountedEditor?.removeEventListener('compositionend', handleCompositionEnd)
  }
  watch(
    getEditor,
    (editor) => {
      detachEditor()
      mountedEditor = editor
      mountedEditor?.addEventListener('beforeinput', handleBeforeInput)
      mountedEditor?.addEventListener('input', handleFormattingInput)
      mountedEditor?.addEventListener('paste', handlePaste, true)
      mountedEditor?.addEventListener('compositionstart', handleCompositionStart)
      mountedEditor?.addEventListener('compositionend', handleCompositionEnd)
    },
    { immediate: true, flush: 'post' },
  )
  onMounted(() => document.addEventListener('selectionchange', captureSelection))
  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', captureSelection)
    detachEditor()
    resetSizingState()
  })

  return {
    hasSelectedImage,
    imageWidth,
    hasTextSelection,
    isBold,
    boldMixed,
    highlightColor,
    selectedInternalLinkId,
    captureSelection,
    handleEditorClick,
    insertInternalLink,
    removeInternalLink,
    toggleBold,
    applyHighlight,
    applyImageWidth,
    serializeHtml,
    resetSizingState,
  }
}
