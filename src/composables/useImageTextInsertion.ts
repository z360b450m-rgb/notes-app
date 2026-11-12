import { ref, watch, onUnmounted } from 'vue'
import { saveImage } from '@/services/imageStorage'
import { insertImageText } from '@/utils/imageTextInsert'

export function useImageTextInsertion(context: () => string, notebook: () => string) {
  const inserting = ref(false)
  const insertionError = ref('')
  let revision = 0
  function cancelInsertion() {
    revision++
    inserting.value = false
    insertionError.value = ''
  }
  watch(context, cancelInsertion, { flush: 'sync' })
  onUnmounted(cancelInsertion)
  async function insert(
    editor: HTMLElement | null,
    text: string,
    image: string | undefined,
    range: Range | null,
    onInput: () => void,
  ): Promise<boolean> {
    if (!editor || inserting.value) return false
    const current = ++revision
    const identity = context()
    inserting.value = true
    insertionError.value = ''
    try {
      const imageUrl = image ? (await saveImage(notebook(), image)).displayUrl : undefined
      if (current !== revision || identity !== context() || !editor.isConnected) return false
      insertImageText(editor, text, imageUrl, range)
      onInput()
      return true
    } catch {
      if (current === revision) insertionError.value = '插入失败，请重试。识别文字仍保留在这里。'
      return false
    } finally {
      if (current === revision) inserting.value = false
    }
  }
  return { insert, inserting, insertionError, cancelInsertion }
}
