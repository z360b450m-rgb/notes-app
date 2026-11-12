import { ref, type ComputedRef, type Ref } from 'vue'

interface BatchActionsFeatureOptions {
  selectedIds: Ref<Set<string>>
  selectedCount: ComputedRef<number>
  batchDelete: (ids: string[]) => void | Promise<void>
  batchTag: (ids: string[], tags: string[]) => void | Promise<void>
  batchExport: (ids: string[]) => void | Promise<void>
  showToast: (message: string) => void
}

export function useBatchActionsFeature(options: BatchActionsFeatureOptions) {
  const showBatchDeleteConfirm = ref(false)

  function handleBatchDelete() {
    showBatchDeleteConfirm.value = true
  }

  async function confirmBatchDelete() {
    const count = options.selectedCount.value
    showBatchDeleteConfirm.value = false
    try {
      await options.batchDelete(Array.from(options.selectedIds.value))
      options.showToast(`已删除 ${count} 条错题`)
    } catch {
      options.showToast('删除未完成，请重试')
    }
  }

  function cancelBatchDelete() {
    showBatchDeleteConfirm.value = false
  }

  async function handleBatchTag(tags: string[]) {
    const count = options.selectedCount.value
    try {
      await options.batchTag(Array.from(options.selectedIds.value), tags)
      options.showToast(`已为 ${count} 条错题添加标签`)
    } catch {
      options.showToast('部分题目暂时无法加载，请重试添加标签')
    }
  }

  async function handleBatchExport() {
    try {
      await options.batchExport(Array.from(options.selectedIds.value))
    } catch {
      options.showToast('部分题目内容无法加载，请重试导出')
    }
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
