import { ref, watch } from 'vue'

interface EditorPreferences {
  autoSave: boolean
  fontSize: number
  defaultNotebookId: string
}
const key = 'cuoti-editor-preferences'
const defaults: EditorPreferences = { autoSave: true, fontSize: 24, defaultNotebookId: '' }
function load(): EditorPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}')
    return {
      autoSave: typeof value.autoSave === 'boolean' ? value.autoSave : true,
      fontSize: Number.isFinite(value.fontSize) ? Math.min(48, Math.max(12, value.fontSize)) : 24,
      defaultNotebookId: typeof value.defaultNotebookId === 'string' ? value.defaultNotebookId : '',
    }
  } catch {
    return { ...defaults }
  }
}
const preferences = ref(load())
watch(
  preferences,
  (value) => {
    localStorage.setItem(key, JSON.stringify(value))
    document.documentElement.style.setProperty('--editor-font-size', value.fontSize + 'px')
  },
  { deep: true, immediate: true },
)
export function useEditorPreferences() {
  return { preferences }
}
