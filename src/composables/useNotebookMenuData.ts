import { computed, ref, watch, onScopeDispose, type Ref } from 'vue'
import type { Notebook } from '@/types'
import { getNotebookOverview } from '@/services/db'
import type { NotebookOverview } from '@/services/notebookOverview'

/** A dashboard holds aggregates only; unavailable counts remain unknown. */
export function useNotebookMenuData(notebooks: Ref<Notebook[]>) {
  const overview = ref<NotebookOverview>({ items: [], subjects: [], reviewDays: [] })
  const loading = ref(false)
  const error = ref('')
  let sequence = 0
  onScopeDispose(() => ++sequence)
  // Renaming/reordering a notebook must not refetch unchanged statistics.
  const ids = computed(() =>
    notebooks.value
      .map((notebook) => notebook.id)
      .sort()
      .join('\n'),
  )
  const countsByNotebook = computed(() => {
    const activeIds = new Set(notebooks.value.map((notebook) => notebook.id))
    return Object.fromEntries(
      overview.value.items
        .filter((item) => activeIds.has(item.notebookId))
        .map((item) => [item.notebookId, item]),
    )
  })
  const hasEntries = (id: string) => !!countsByNotebook.value[id]
  const entriesReady = computed(() => notebooks.value.every((notebook) => hasEntries(notebook.id)))

  async function reload() {
    const current = ++sequence
    loading.value = true
    error.value = ''
    try {
      const result = await getNotebookOverview(notebooks.value.map((notebook) => notebook.id))
      if (current !== sequence) return
      overview.value = result
      if (result.stale)
        error.value = '暂时无法连接后台，当前显示缓存或本地统计。恢复连接后可重新读取。'
      else if (!entriesReady.value) error.value = '部分统计暂时未能读取，请重试。'
    } catch {
      if (current !== sequence) return
      error.value = '统计暂时未能读取，已保留上次成功的数据。请重试。'
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  watch(ids, () => void reload(), { immediate: true })
  return {
    countsByNotebook,
    subjects: computed(() => overview.value.subjects),
    reviewDays: computed(() => overview.value.reviewDays),
    loading,
    error,
    reload,
    hasEntries,
    hasReviews: hasEntries,
    entriesReady,
    reviewsReady: entriesReady,
  }
}
