import { computed, ref, type Ref } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import { entryRepository } from '@/services/db'
import { useBackup } from '@/composables/useBackup'
import { countMultipleChoiceEntries, parsePastedText } from '@/utils/parsePastedText'
import { parsePdfFile, type PdfParseProgress } from '@/utils/parsePdf'

interface ImportFeatureOptions {
  entries: Ref<NoteEntry[]>
  questionGroups: Ref<QuestionGroup[]>
  activeNotebookId: Ref<string | null>
  loadEntries: () => Promise<void>
  loadNotebooks: () => Promise<void>
  showToast: (message: string) => void
  resetFilters: () => void
}

export function useImportFeature(options: ImportFeatureOptions) {
  const { exportData, importData, importModalVisible, handleImportOption } = useBackup(
    () => options.entries.value,
    () => options.questionGroups.value,
    () => options.activeNotebookId.value ?? '',
    options.loadEntries,
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

  const showPdfImport = ref(false)
  const pdfFile = ref<File | null>(null)
  const pdfImportLoading = ref(false)
  const pdfProgress = ref<PdfParseProgress>({ current: 0, total: 0 })
  const pdfParsedPreview = ref<Partial<NoteEntry>[]>([])
  const pdfError = ref('')
  const showPdfReview = ref(false)

  async function handleImportArchive() {
    await importData()
    await options.loadNotebooks()
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

  function handleOpenPdfImport() {
    pdfFile.value = null
    pdfImportLoading.value = false
    pdfProgress.value = { current: 0, total: 0 }
    pdfParsedPreview.value = []
    pdfError.value = ''
    showPdfImport.value = true
  }

  async function handlePdfFileSelected(file: File) {
    const notebookId = options.activeNotebookId.value
    if (!notebookId) return

    pdfFile.value = file
    pdfImportLoading.value = true
    pdfError.value = ''
    pdfParsedPreview.value = []

    try {
      const parsed = await parsePdfFile(file, notebookId, (progress) => {
        pdfProgress.value = progress
      })
      pdfParsedPreview.value = parsed
      if (parsed.length === 0) {
        pdfError.value = '未能从此 PDF 中解析出题目，请确认 PDF 中包含带序号的题目文本。'
      } else {
        showPdfImport.value = false
        showPdfReview.value = true
      }
    } catch (error: unknown) {
      pdfError.value =
        (error instanceof Error ? error.message : undefined) || 'PDF 解析失败，请确认文件格式正确'
    } finally {
      pdfImportLoading.value = false
    }
  }

  async function handleConfirmPdfReview(reviewedEntries: Partial<NoteEntry>[]) {
    const notebookId = options.activeNotebookId.value
    if (!notebookId || reviewedEntries.length === 0) return

    pdfImportLoading.value = true
    try {
      const now = Date.now()
      for (const [index, item] of reviewedEntries.entries()) {
        const entry: NoteEntry = {
          id: 'cuoti_' + now + '_' + Math.random().toString(36).slice(2, 7) + '_' + index,
          notebookId,
          title: (item.question || '').replace(/<[^>]*>/g, '').slice(0, 40),
          question: item.question || '',
          wrongAnswer: item.wrongAnswer || '',
          correctAnswer: item.correctAnswer || '',
          subject: item.subject || '未分类',
          source: 'PDF导入',
          tags: item.tags || [],
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
      options.showToast(`已导入 ${reviewedEntries.length} 道错题`)
      showPdfReview.value = false
      pdfParsedPreview.value = []
    } catch (error) {
      console.error('PDF import failed:', error)
      options.showToast('导入失败，请重试')
    } finally {
      pdfImportLoading.value = false
    }
  }

  function handleCancelPdfReview() {
    showPdfReview.value = false
    pdfParsedPreview.value = []
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
    showPdfImport,
    pdfFile,
    pdfImportLoading,
    pdfProgress,
    pdfParsedPreview,
    pdfError,
    showPdfReview,
    handleOpenPdfImport,
    handlePdfFileSelected,
    handleConfirmPdfReview,
    handleCancelPdfReview,
  }
}
