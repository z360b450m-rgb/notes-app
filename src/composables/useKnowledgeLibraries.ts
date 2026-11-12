import { computed, inject, onScopeDispose, ref, type InjectionKey } from 'vue'
import { getStoredUser } from '@/services/auth'
import { importKnowledgeFile, libraryRequest } from '@/services/knowledgeDocumentImport'
import { useBackgroundTasks, type createBackgroundTasks } from './useBackgroundTasks'

export interface KnowledgeLibrary {
  id: string
  name: string
  description: string
  updatedAt: number
  archived: boolean
  status:
    | 'empty'
    | 'uploading'
    | 'processing'
    | 'ready'
    | 'failed'
    | 'cancelling'
    | 'cancelled'
    | 'cancel_failed'
    | 'deleting'
    | 'delete_failed'
  stage: string
  error: string
  charCount: number
  chunkCount: number
  entityCount: number
  relationCount: number
  source?: { fileName: string; format: 'pdf' | 'md'; size: number; pageCount?: number } | null
}

export function useKnowledgeLibraries() {
  return inject(knowledgeLibrariesKey, null) ?? createKnowledgeLibraries()
}

export const knowledgeLibrariesKey: InjectionKey<ReturnType<typeof createKnowledgeLibraries>> =
  Symbol('knowledgeLibraries')

export function createKnowledgeLibraries(
  tasks: ReturnType<typeof createBackgroundTasks> | null = useBackgroundTasks(),
) {
  const libraryMode = ref<'insert' | 'manage' | null>(null)
  const selectedLibraries = ref<string[]>([])
  const selectionInitialized = ref(false)
  function selectLibraries(ids: string[]) {
    selectedLibraries.value = ids
    selectionInitialized.value = true
  }
  const focusLibraryId = ref('')
  const focusNotebookId = ref('')
  const focusVersion = ref(0)
  function openLibrary(id: string, notebookId = '') {
    focusLibraryId.value = id
    focusNotebookId.value = notebookId
    focusVersion.value++
    libraryMode.value = 'manage'
  }
  const libraries = ref<KnowledgeLibrary[]>([])
  const error = ref('')
  const importing = ref(false)
  const importProgress = ref('')
  const activeImportId = ref('')
  const actionIds = ref<string[]>([])
  let importController: AbortController | undefined
  let stopBatch = false
  const importResults = ref<{ fileName: string; success: boolean; detail: string }[]>([])
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let refreshVersion = 0
  const tracked = new Set<string>()
  function trackLibrary(item: KnowledgeLibrary) {
    const running = ['uploading', 'processing', 'cancelling', 'deleting'].includes(item.status)
    if (!running && !tracked.has(item.id)) return
    tracked.add(item.id)
    tasks?.update({
      id: `document:${item.id}`,
      title: `${item.name} · ${running ? '资料入库中' : item.status === 'ready' ? '入库完成' : '入库已停止'}`,
      detail:
        item.error ||
        item.stage ||
        (running ? '正在处理学习资料' : `已保存 ${item.chunkCount} 段资料`),
      state: running
        ? 'running'
        : item.status === 'ready'
          ? 'completed'
          : item.status === 'cancelled'
            ? 'warning'
            : 'failed',
      open: () => openLibrary(item.id),
    })
    if (!running) tracked.delete(item.id)
  }
  // Explicitly requested cleanup: no migration and no reads/writes of browser library contents.
  try {
    localStorage.removeItem(`review-knowledge-libraries-v1:${getStoredUser()?.id ?? 'local'}`)
  } catch {
    error.value = '旧本地知识库资料清理失败，请在浏览器设置中检查存储权限。'
  }
  async function refresh() {
    const version = ++refreshVersion
    clearTimeout(timer)
    try {
      const result = await libraryRequest('', {}, controller.signal)
      if (!Array.isArray(result?.items)) throw new Error('知识库列表响应无效')
      if (version !== refreshVersion) return
      libraries.value = result.items
      libraries.value.forEach(trackLibrary)
      for (const id of tracked) {
        if (!libraries.value.some((item) => item.id === id)) {
          tasks?.dismiss(`document:${id}`)
          // A deletion is not a successful ingestion.
          const task = tasks?.tasks.value.find((item) => item.id === `document:${id}`)
          if (task) {
            task.state = 'warning'
            task.title = '资料已删除'
            task.detail = '该资料的入库任务已停止'
            tasks?.dismiss(task.id)
          }
          tracked.delete(id)
        }
      }
      error.value = ''
    } catch (cause) {
      if (!controller.signal.aborted)
        error.value = cause instanceof Error ? cause.message : '知识库读取失败'
    }
    if (
      !controller.signal.aborted &&
      libraries.value.some((item) =>
        ['uploading', 'processing', 'cancelling', 'deleting'].includes(item.status),
      )
    )
      timer = setTimeout(refresh, 1500)
  }
  async function save(input: { id?: string; name: string; description: string }) {
    if (!input.name.trim()) {
      error.value = '请输入知识库名称'
      return false
    }
    try {
      const existing = libraries.value.find((item) => item.id === input.id)
      await libraryRequest(
        input.id ? `/${input.id}` : '',
        {
          method: input.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name.trim(),
            description: input.description.trim(),
            ...(existing ? { archived: existing.archived } : {}),
          }),
        },
        controller.signal,
      )
      await refresh()
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败'
      return false
    }
  }
  async function archive(id: string) {
    const item = libraries.value.find((row) => row.id === id)
    if (!item) return false
    try {
      await libraryRequest(
        `/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name,
            description: item.description,
            archived: !item.archived,
          }),
        },
        controller.signal,
      )
      await refresh()
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '更新失败'
      return false
    }
  }
  async function cancelImport(id = activeImportId.value) {
    if (!id || actionIds.value.includes(id)) return
    actionIds.value.push(id)
    try {
      await libraryRequest(`/${id}/cancel`, { method: 'POST' }, controller.signal)
      if (id === activeImportId.value) {
        stopBatch = true
        importController?.abort()
        importProgress.value = '正在取消导入并清理半成品…'
      }
      await refresh()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '取消失败，请重试'
    } finally {
      actionIds.value = actionIds.value.filter((value) => value !== id)
    }
  }
  async function deleteLibrary(id: string) {
    if (actionIds.value.includes(id)) return
    actionIds.value.push(id)
    try {
      await libraryRequest(`/${id}`, { method: 'DELETE' }, controller.signal)
      if (id === activeImportId.value) {
        stopBatch = true
        importController?.abort()
      }
      await refresh()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '删除失败，请重试'
    } finally {
      actionIds.value = actionIds.value.filter((value) => value !== id)
    }
  }
  async function importFiles(files: File[]) {
    if (importing.value) return
    importing.value = true
    stopBatch = false
    importResults.value = []
    try {
      const batchId = `document-batch:${Date.now()}`
      const completedFiles = () => importResults.value.length
      for (const file of files) {
        if (stopBatch || controller.signal.aborted) break
        importController = new AbortController()
        activeImportId.value = ''
        let uploadAccepted = false
        if (files.length > 1)
          tasks?.update({
            id: batchId,
            title: '学习资料批量入库',
            detail: `已处理 ${completedFiles()} / ${files.length} 个文件 · ${file.name}`,
            state: 'running',
            progress: (completedFiles() / files.length) * 100,
            open: () => {
              libraryMode.value = 'manage'
            },
          })
        try {
          importProgress.value = `正在上传 ${file.name}`
          const created = await importKnowledgeFile(file, importController.signal, (id) => {
            activeImportId.value = id
            void refresh()
          })
          trackLibrary(created)
          uploadAccepted = true
          const deadline = Date.now() + 30 * 60 * 1000
          let item: KnowledgeLibrary | undefined
          do {
            await refresh()
            item = libraries.value.find((row) => row.id === created.id)
            if (!item)
              throw new Error(stopBatch ? '已停止本次导入' : error.value || '无法读取资料入库状态')
            importProgress.value = `${file.name} · ${item.stage || '处理中'}`
            if (files.length > 1)
              tasks?.update({
                id: batchId,
                title: '学习资料批量入库',
                detail: `已处理 ${completedFiles()} / ${files.length} 个文件 · ${importProgress.value}`,
                state: 'running',
                progress: (completedFiles() / files.length) * 100,
                open: () => {
                  libraryMode.value = 'manage'
                },
              })
            if (!['processing', 'cancelling', 'deleting'].includes(item.status)) break
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                clearTimeout(pollTimer)
                reject(new Error('已停止等待，服务端任务可在下次打开时查看'))
              }
              const pollTimer = setTimeout(() => {
                controller.signal.removeEventListener('abort', onAbort)
                resolve()
              }, 1500)
              controller.signal.addEventListener('abort', onAbort, { once: true })
            })
          } while (!controller.signal.aborted && Date.now() < deadline)
          if (item?.status !== 'ready')
            throw new Error(
              item?.status === 'cancelled'
                ? '已取消导入'
                : item?.error || '入库仍在进行，请稍后查看知识库状态',
            )
          importResults.value.push({
            fileName: file.name,
            success: true,
            detail: `入库完成 · ${item.chunkCount} 段资料 · ${item.entityCount} 个知识实体`,
          })
        } catch (cause) {
          importResults.value.push({
            fileName: file.name,
            success: false,
            detail: stopBatch
              ? '已停止本次导入，剩余文件未导入'
              : cause instanceof Error
                ? cause.message
                : '资料入库失败',
          })
          if (!uploadAccepted && activeImportId.value && !stopBatch && !controller.signal.aborted)
            await cancelImport(activeImportId.value)
          if (controller.signal.aborted) break
        }
      }
      const succeeded = importResults.value.filter((item) => item.success).length
      if (files.length > 1 || !activeImportId.value)
        tasks?.update({
          id: batchId,
          title: '学习资料入库结束',
          detail: `成功 ${succeeded} / ${files.length} 个文件${stopBatch ? '，已取消剩余文件' : succeeded < files.length ? '，请查看未完成文件' : '，全部入库完成'}`,
          state: succeeded === files.length ? 'completed' : 'warning',
          open: () => {
            libraryMode.value = 'manage'
          },
        })
    } finally {
      importing.value = false
      activeImportId.value = ''
      importProgress.value = ''
    }
  }
  void refresh()
  onScopeDispose(() => {
    controller.abort()
    importController?.abort()
    clearTimeout(timer)
  })
  return {
    libraryMode,
    selectedLibraries,
    selectionInitialized,
    selectLibraries,
    focusLibraryId,
    focusNotebookId,
    focusVersion,
    openLibrary,
    libraries,
    available: computed(() =>
      libraries.value.filter((item) => !item.archived && ['ready', 'empty'].includes(item.status)),
    ),
    error,
    refresh,
    save,
    archive,
    importing,
    importProgress,
    importResults,
    importFiles,
    activeImportId,
    actionIds,
    cancelImport,
    deleteLibrary,
  }
}
