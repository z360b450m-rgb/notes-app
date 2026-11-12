import { computed, ref, type Ref } from 'vue'
import type { NoteEntry } from '@/types'
import { entryRepository } from '@/services/db'
import { useBackup } from '@/composables/useBackup'
import { countMultipleChoiceEntries, parsePastedText } from '@/utils/parsePastedText'

interface ImportFeatureOptions {
  entries: Ref<NoteEntry[]>
  getFullEntries?: () => Promise<NoteEntry[]>
  activeNotebookId: Ref<string | null>
  loadEntries: () => Promise<void>
  loadNotebooks: () => Promise<void>
  showToast: (message: string) => void
  resetFilters: () => void
}

export function useImportFeature(options: ImportFeatureOptions) {
  const { exportData, importData, importModalVisible, handleImportOption } = useBackup(
    () => options.getFullEntries?.() ?? options.entries.value,
    () => options.activeNotebookId.value ?? '',
    async () => {
      await options.loadNotebooks()
      await options.loadEntries()
    },
    options.showToast,
  )

  const showBatchImport = ref(false)
  const batchImportText = ref('')
  const batchImportLoading = ref(false)
  const batchImportSubject = ref('未分类')
  const batchImportSource = ref('批量导入')
  const batchImportTags = ref('')
  const batchImportPreview = computed(() =>
    parsePastedText(batchImportText.value, options.activeNotebookId.value || '__preview__'),
  )
  const batchImportChoiceCount = computed(() =>
    countMultipleChoiceEntries(batchImportPreview.value),
  )

  async function handleImportArchive() {
    await importData()
    options.resetFilters()
  }

  function handleOpenBatchImport() {
    batchImportText.value = ''
    batchImportSubject.value = '未分类'
    batchImportSource.value = '批量导入'
    batchImportTags.value = ''
    showBatchImport.value = true
  }

  async function handleConfirmBatchImport() {
    const notebookId = options.activeNotebookId.value
    if (!batchImportText.value.trim() || !notebookId) return

    batchImportLoading.value = true
    try {
      const parsed = parsePastedText(batchImportText.value, notebookId)
      if (parsed.length === 0) {
        options.showToast('没有识别到题目，请确认每题以 1.、2)、（3）等序号开头')
        return
      }
      const tags = batchImportTags.value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
      const now = Date.now()
      for (const [index, item] of parsed.entries()) {
        const entry: NoteEntry = {
          id: 'cuoti_' + now + '_' + Math.random().toString(36).slice(2, 7) + '_' + index,
          notebookId,
          title: (item.question || '').slice(0, 40),
          question: item.question || '',
          wrongAnswer: item.wrongAnswer || '',
          correctAnswer: item.correctAnswer || '',
          subject: batchImportSubject.value.trim() || item.subject || '未分类',
          source: batchImportSource.value.trim() || item.source || '批量导入',
          tags: Array.from(new Set([...(item.tags || []), ...tags])),
          masteryLevel: 0,
          consecutivePasses: 0,
          nextReviewDate: 0,
          createdAt: now + index,
          updatedAt: now + index,
        }
        await entryRepository.put(notebookId, JSON.parse(JSON.stringify(entry)))
      }
      await options.loadEntries()
      options.resetFilters()
      options.showToast(`已导入 ${parsed.length} 道错题`)
      showBatchImport.value = false
    } catch (error) {
      console.error('Batch import failed:', error)
      options.showToast('批量导入失败，请重试')
    } finally {
      batchImportLoading.value = false
    }
  }

  return {
    exportData,
    importModalVisible,
    handleImportOption,
    handleImportArchive,
    showBatchImport,
    batchImportText,
    batchImportLoading,
    batchImportSubject,
    batchImportSource,
    batchImportTags,
    batchImportPreview,
    batchImportChoiceCount,
    handleOpenBatchImport,
    handleConfirmBatchImport,
  }
}
