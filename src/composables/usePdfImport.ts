import { onUnmounted, ref, watch, type Ref } from 'vue'
import type { createBackgroundTasks } from './useBackgroundTasks'
import { importPdf, type PdfImportResult } from '@/services/pdfImport'
import type { PdfDraft } from '@/services/pdfQuestionDraft'
import {
  savePdfDraft,
  confirmPdfDraft,
  getPdfDraft,
  getPdfImportStatus,
  cancelPdfImport,
} from '@/services/shopkeeperPdfAdapter'

export function usePdfImport(options: {
  activeNotebookId: Ref<string | null>
  loadEntries: () => Promise<void>
  loadNotebooks: () => Promise<void>
  showToast: (message: string) => void
  tasks?: ReturnType<typeof createBackgroundTasks>
  openNotebook?: (id: string) => Promise<void>
}) {
  const showPdfImport = ref(false)
  const pdfImportLoading = ref(false)
  const pdfImportProgress = ref('')
  const pdfImportError = ref('')
  const pdfImportResult = ref<PdfImportResult | null>(null)
  const pdfImportDraft = ref<PdfDraft | null>(null)
  const pdfImportConfirming = ref(false)
  let controller: AbortController | undefined
  let targetNotebookId: string | null = null
  let pendingImport: Promise<PdfImportResult> | undefined
  const pdfImportCancelling = ref(false)
  let parseJobId: string | undefined
  let taskId = ''
  let fileName = ''
  function updateTask() {
    if (!taskId || !targetNotebookId) return
    const notebookId = targetNotebookId
    const completed = pdfImportResult.value?.status === 'completed'
    const running = pdfImportLoading.value || pdfImportConfirming.value || pdfImportCancelling.value
    options.tasks?.update({
      id: taskId,
      title: `${fileName} · ${running ? (pdfImportConfirming.value ? '题目录入中' : 'PDF 处理中') : completed ? '导入完成' : pdfImportError.value ? '处理需要重试' : pdfImportDraft.value ? '识别完成，待校对' : '解析已停止'}`,
      detail:
        pdfImportError.value ||
        (running
          ? pdfImportProgress.value || '正在保存所选题目…'
          : completed
            ? `已导入 ${pdfImportResult.value?.importedCount} 道题目`
            : pdfImportDraft.value
              ? '请校对题目并确认录入，题目尚未保存。'
              : '可打开导入窗口重新选择文件。'),
      state: running
        ? 'running'
        : completed
          ? 'completed'
          : pdfImportError.value
            ? 'failed'
            : 'warning',
      actionLabel: completed
        ? '查看错题本 ↗'
        : pdfImportDraft.value && !running
          ? '去校对题目 ↗'
          : undefined,
      open: async () => {
        if (completed && options.openNotebook) {
          await options.openNotebook(notebookId)
          showPdfImport.value = false
        } else showPdfImport.value = true
      },
    })
  }
  watch(
    [
      pdfImportLoading,
      pdfImportConfirming,
      pdfImportCancelling,
      pdfImportProgress,
      pdfImportError,
      pdfImportResult,
      pdfImportDraft,
    ],
    updateTask,
  )

  function handleBackgroundPdfImport() {
    showPdfImport.value = false
  }

  function handleOpenPdfImport() {
    if (
      pdfImportLoading.value ||
      pdfImportConfirming.value ||
      pdfImportCancelling.value ||
      (pdfImportDraft.value && pdfImportResult.value?.status !== 'completed')
    ) {
      showPdfImport.value = true
      return
    }
    if (!options.activeNotebookId.value) {
      options.showToast('请先选择目标错题本')
      return
    }
    targetNotebookId = options.activeNotebookId.value
    pdfImportError.value = ''
    pdfImportProgress.value = ''
    pdfImportResult.value = null
    pdfImportDraft.value = null
    pendingImport = undefined
    parseJobId = undefined
    taskId = ''
    showPdfImport.value = true
  }

  async function handleClosePdfImport() {
    if (pdfImportConfirming.value || pdfImportCancelling.value) return
    if (pdfImportLoading.value && pendingImport) {
      pdfImportCancelling.value = true
      pdfImportProgress.value = '正在停止 PDF 解析…'
      const retryCancellation = controller?.signal.aborted && parseJobId
      controller?.abort()
      try {
        if (retryCancellation) await cancelPdfImport(retryCancellation)
        else await pendingImport
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          pdfImportError.value = error instanceof Error ? error.message : '停止解析失败，请重试'
          return
        }
      } finally {
        pdfImportCancelling.value = false
      }
      pdfImportLoading.value = false
      pdfImportProgress.value = ''
    } else {
      controller?.abort()
    }
    showPdfImport.value = false
  }

  async function handleSubmitPdfImport(file: File) {
    if (pdfImportLoading.value || pdfImportCancelling.value || pdfImportResult.value) return
    if (!targetNotebookId) return
    taskId = `pdf:${Date.now()}`
    fileName = file.name
    controller = new AbortController()
    const signal = controller.signal
    pdfImportLoading.value = true
    pdfImportError.value = ''
    pdfImportProgress.value = '正在提交 PDF…'
    try {
      pendingImport = importPdf({
        file,
        notebookId: targetNotebookId,
        signal,
        onTask: (jobId) => {
          parseJobId = jobId
        },
        onProgress: (message) => {
          if (!signal.aborted) pdfImportProgress.value = message
        },
        onDraft: (draft) => {
          if (!signal.aborted) pdfImportDraft.value = draft
        },
      })
      const result = await pendingImport
      pdfImportResult.value = result
      if (result.status === 'completed') {
        options.showToast(`已导入 ${result.importedCount} 道题目`)
        try {
          await options.loadNotebooks()
          await options.loadEntries()
        } catch {
          pdfImportError.value = '题目已保存，但列表刷新失败，请刷新页面查看'
        }
      }
    } catch (error) {
      if (!signal.aborted || !(error instanceof DOMException && error.name === 'AbortError'))
        pdfImportError.value = error instanceof Error ? error.message : 'PDF 导入失败，请重试'
    } finally {
      if (!pdfImportCancelling.value) {
        pdfImportLoading.value = false
        pdfImportProgress.value = ''
        pendingImport = undefined
      }
    }
  }

  async function handleConfirmPdfImport(keys: string[]) {
    const draft = pdfImportDraft.value
    if (
      !draft ||
      !keys.length ||
      pdfImportConfirming.value ||
      draft.notebook_id !== targetNotebookId
    )
      return
    controller = new AbortController()
    const signal = controller.signal
    pdfImportConfirming.value = true
    pdfImportError.value = ''
    try {
      const status = await getPdfImportStatus(draft.id, signal)
      const current = status.status === 'committed' ? draft : await savePdfDraft(draft, signal)
      pdfImportDraft.value = current
      const result = await confirmPdfDraft(current, keys, signal)
      pdfImportResult.value = result
      if (result.status === 'completed') {
        options.showToast(`已导入 ${result.importedCount} 道题目`)
        try {
          await options.loadNotebooks()
          await options.loadEntries()
        } catch {
          pdfImportError.value = '题目已保存，但列表刷新失败，请刷新页面查看'
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        pdfImportResult.value = {
          status: 'submitted',
          taskId: draft.id,
          message: '确认结果暂未核实，请重试确认或重新加载任务。',
        }
        pdfImportError.value = error instanceof Error ? error.message : '确认录入失败，请重试'
      }
    } finally {
      pdfImportConfirming.value = false
    }
  }

  async function handleReloadPdfDraft() {
    if (!pdfImportDraft.value || pdfImportConfirming.value || pdfImportLoading.value) return
    controller = new AbortController()
    pdfImportLoading.value = true
    pdfImportProgress.value = '正在重新加载草稿…'
    try {
      pdfImportDraft.value = await getPdfDraft(pdfImportDraft.value.id, controller.signal)
      pdfImportError.value = ''
    } catch (error) {
      pdfImportError.value = error instanceof Error ? error.message : '草稿加载失败'
    } finally {
      pdfImportLoading.value = false
      pdfImportProgress.value = ''
    }
  }

  onUnmounted(() => controller?.abort())

  return {
    showPdfImport,
    pdfImportLoading,
    pdfImportProgress,
    pdfImportError,
    pdfImportResult,
    pdfImportDraft,
    pdfImportConfirming,
    pdfImportCancelling,
    handleOpenPdfImport,
    handleBackgroundPdfImport,
    handleClosePdfImport,
    handleSubmitPdfImport,
    handleConfirmPdfImport,
    handleReloadPdfDraft,
  }
}
