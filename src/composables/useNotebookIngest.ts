import { API_BASE, fetchApi } from '@/services/apiConfig'
import { inject, onScopeDispose, ref, type InjectionKey } from 'vue'
import { getAccessToken } from '@/services/auth'
import type { createBackgroundTasks } from './useBackgroundTasks'
import { useBackgroundTasks } from './useBackgroundTasks'

export type IndexResult = {
  id: string
  task_id?: string
  kb_id: string
  notebook_id: string
  notebook_name?: string
  status: string
  indexed_count: number
  report: {
    total: number
    added: number
    updated: number
    deleted: number
    skipped: number
    processed: number
    pending: number
    failed: number
    failures: { entry_id: string; message: string }[]
  }
}

export const notebookIngestKey: InjectionKey<ReturnType<typeof createNotebookIngest>> =
  Symbol('notebookIngest')
export function useNotebookIngest() {
  return inject(notebookIngestKey, null) ?? createNotebookIngest(useBackgroundTasks(), () => {})
}

export function createNotebookIngest(
  tasks: ReturnType<typeof createBackgroundTasks> | null,
  onOpen: (kbId: string, notebookId: string) => void,
  onComplete: () => void = () => {},
) {
  const sources = ref<{ id: string; name: string; deleted: boolean }[]>([])
  const indexes = ref<IndexResult[]>([])
  const error = ref('')
  const submitting = ref(false)
  const controller = new AbortController()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const tracked = new Set<string>()
  let loading: Promise<void> | undefined
  async function request(path: string, body?: unknown) {
    const token = getAccessToken()
    if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后执行入库')
    const response = await fetchApi(`${API_BASE}/knowledge${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json()
    if (!response.ok)
      throw Object.assign(
        new Error(typeof data.detail === 'string' ? data.detail : '入库请求失败，请重试'),
        { status: response.status },
      )
    return data
  }
  function update(item: IndexResult) {
    const wasRunning = indexes.value.some((row) => row.id === item.id && row.status === 'running')
    indexes.value = [...indexes.value.filter((row) => row.id !== item.id), item]
    clearTimeout(timers.get(item.id))
    const taskId = `index:${item.task_id || item.id}`
    const running = item.status === 'running'
    if (wasRunning && !running) onComplete()
    if (running || tracked.has(taskId)) {
      tracked.add(taskId)
      const name =
        item.notebook_name ||
        sources.value.find((book) => book.id === item.notebook_id)?.name ||
        '错题本'
      tasks?.update({
        id: taskId,
        title: `${name} · ${running ? '入库中' : item.status === 'completed' ? '入库完成' : '入库需要处理'}`,
        detail: running
          ? `已处理 ${item.report.processed} / ${item.report.pending} 项变更`
          : `新增 ${item.report.added} · 更新 ${item.report.updated} · 删除 ${item.report.deleted} · 失败 ${item.report.failed}`,
        state: running ? 'running' : item.status === 'completed' ? 'completed' : 'warning',
        progress: running
          ? item.report.pending
            ? Math.min(100, (item.report.processed / item.report.pending) * 100)
            : undefined
          : 100,
        open: () => onOpen(item.kb_id, item.notebook_id),
      })
      if (!running) tracked.delete(taskId)
    }
    if (running && !controller.signal.aborted)
      timers.set(
        item.id,
        setTimeout(() => void poll(item.id), 1000),
      )
  }
  async function poll(id: string) {
    try {
      update(await request(`/ingest/${encodeURIComponent(id)}`))
      error.value = ''
    } catch (cause) {
      if (controller.signal.aborted) return
      error.value = cause instanceof Error ? cause.message : '读取入库状态失败'
      const item = indexes.value.find((row) => row.id === id)
      const task = tasks?.tasks.value.find((row) => row.id === `index:${item?.task_id || id}`)
      if (task) {
        task.detail = `${error.value}，正在重试获取进度…`
        task.progress = undefined
        if (
          cause instanceof Error &&
          'status' in cause &&
          [401, 403, 404].includes(Number(cause.status))
        ) {
          task.state = 'failed'
          task.title = '入库任务状态不可用'
          task.detail = error.value
          return
        }
      }
      timers.set(
        id,
        setTimeout(() => void poll(id), 4000),
      )
    }
  }
  async function refresh() {
    if (loading) return loading
    loading = (async () => {
      try {
        const data = await request('/notebooks')
        sources.value = data.items
        for (const item of data.indexes as IndexResult[]) update(item)
        error.value = ''
      } catch (cause) {
        if (!controller.signal.aborted)
          error.value = cause instanceof Error ? cause.message : '读取错题本失败'
      }
    })()
    try {
      await loading
    } finally {
      loading = undefined
    }
  }
  async function execute(kbId: string, notebookId: string, remove = false) {
    if (
      submitting.value ||
      indexes.value.some(
        (row) => row.kb_id === kbId && row.notebook_id === notebookId && row.status === 'running',
      )
    )
      return
    submitting.value = true
    error.value = ''
    try {
      update(await request('/ingest', { kb_id: kbId, notebook_id: notebookId, remove }))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '入库失败'
    } finally {
      submitting.value = false
    }
  }
  onScopeDispose(() => {
    controller.abort()
    timers.forEach(clearTimeout)
    timers.clear()
  })
  return { sources, indexes, error, submitting, refresh, execute }
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
