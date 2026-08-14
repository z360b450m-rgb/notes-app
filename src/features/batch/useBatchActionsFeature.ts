import { ref, type ComputedRef, type Ref } from 'vue'

interface BatchActionsFeatureOptions {
  selectedIds: Ref<Set<string>>
  selectedCount: ComputedRef<number>
  batchDelete: (ids: string[]) => void | Promise<void>
  batchTag: (ids: string[], tags: string[]) => void | Promise<void>
  batchExport: (ids: string[]) => void
  showToast: (message: string) => void
}

export function useBatchActionsFeature(options: BatchActionsFeatureOptions) {
  const showBatchDeleteConfirm = ref(false)

  function handleBatchDelete() {
    showBatchDeleteConfirm.value = true
  }

  function confirmBatchDelete() {
    const count = options.selectedCount.value
    showBatchDeleteConfirm.value = false
    void options.batchDelete(Array.from(options.selectedIds.value))
    options.showToast(`已删除 ${count} 条错题`)
  }

  function cancelBatchDelete() {
    showBatchDeleteConfirm.value = false
  }

  function handleBatchTag(tags: string[]) {
    const count = options.selectedCount.value
    void options.batchTag(Array.from(options.selectedIds.value), tags)
    options.showToast(`已为 ${count} 条错题添加标签`)
  }

  function handleBatchExport() {
    options.batchExport(Array.from(options.selectedIds.value))
  }

  return {
    showBatchDeleteConfirm,
    handleBatchDelete,
    confirmBatchDelete,
    cancelBatchDelete,
    handleBatchTag,
    handleBatchExport,
  }
}
