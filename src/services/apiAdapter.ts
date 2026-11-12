import type { NoteEntry, Notebook, QuestionGroup, ReviewLog } from '@/types'
import type {
  EntryRepository,
  NotebookRepository,
  QuestionGroupRepository,
  ReviewLogRepository,
} from '@/services/repositories'
import { toRemoteHtml } from '@/services/imageStorage'
import { getAccessToken, getStoredUser } from '@/services/auth'
import { SYNC_COMPLETED_EVENT, type SyncCompleted } from './syncEvents'
import {
  aggregateNotebookOverview,
  type LocalNotebookOverview,
  type NotebookOverview,
} from './notebookOverview'
import {
  assertLoaded,
  entrySummary,
  groupSummary,
  matchesEntry,
  IncompleteSearchError,
} from './entrySummary'

const API_BASE = 'http://localhost:8000/api'
const HEALTH_URL = 'http://localhost:8000/health'
const PENDING_QUEUE_KEY = 'offline_pending_sync_queue_v1'
const REQUEST_TIMEOUT_MS = 5_000
// A login/logout reloads the page. Pin requests and queues to this page's owner
// so an in-flight operation can never be sent with another account's token.
const pageUserId = getStoredUser()?.id
const pageToken = getAccessToken()
const queueKey = `${PENDING_QUEUE_KEY}:${pageUserId ?? 'local'}`

interface SyncPayloadMap {
  put_notebook: Notebook
  delete_notebook: { notebookId: string }
  put_entry: { notebookId: string; entry: NoteEntry }
  delete_entry: { notebookId: string; entryId: string }
  put_question_group: { notebookId: string; group: QuestionGroup }
  delete_question_group: { notebookId: string; groupId: string }
  add_review_log: { notebookId: string; log: ReviewLog }
}

type SyncAction = keyof SyncPayloadMap
type SyncItem = {
  [Action in SyncAction]: {
    id: string
    action: Action
    payload: SyncPayloadMap[Action]
    timestamp: number
  }
}[SyncAction]

interface ApiNotebook {
  id: string
  name: string
  description: string
  instructions: string
  sort_order?: number
  created_at: number
  updated_at: number
}

interface ApiEntry {
  id: string
  notebook_id: string
  title: string
  question: string
  wrong_answer: string
  correct_answer: string
  subject: string
  source: string
  tags?: string[]
  drawings?: Record<string, string>
  sort_order?: number
  created_at: number
  updated_at: number
  review_count?: number
  wrong_count?: number
  consecutive_passes?: number
  mastery_level?: number
  ease_factor?: number
  interval?: number
  last_review_date?: number
  next_review_date?: number
  folder?: string | null
  group_id?: string | null
  sub_question_order?: number | null
  question_preview?: string
}

interface ApiQuestionGroup {
  id: string
  notebook_id: string
  title: string
  material: string
  drawings?: Record<string, string>
  created_at: number
  updated_at: number
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// 1. 本地待同步队列
// ---------------------------------------------------------------------------
function getPendingQueue(): SyncItem[] {
  if (typeof localStorage === 'undefined') return []

  try {
    const raw = localStorage.getItem(queueKey)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value as SyncItem[]) : []
  } catch {
    return []
  }
}

function savePendingQueue(queue: SyncItem[]): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(queueKey, JSON.stringify(queue))
  } catch (error) {
    console.error('保存离线同步队列失败', error)
  }
}

function syncItemId<Action extends SyncAction>(
  action: Action,
  payload: SyncPayloadMap[Action],
): string {
  if (action === 'put_notebook') return `notebook:${(payload as Notebook).id}`
  if (action === 'delete_notebook') {
    return `notebook:${(payload as SyncPayloadMap['delete_notebook']).notebookId}`
  }
  if (action === 'put_entry') {
    return `entry:${(payload as SyncPayloadMap['put_entry']).entry.id}`
  }
  if (action === 'delete_entry') {
    return `entry:${(payload as SyncPayloadMap['delete_entry']).entryId}`
  }
  if (action === 'put_question_group') {
    return `question-group:${(payload as SyncPayloadMap['put_question_group']).group.id}`
  }
  if (action === 'delete_question_group') {
    return `question-group:${(payload as SyncPayloadMap['delete_question_group']).groupId}`
  }
  return `review:${(payload as SyncPayloadMap['add_review_log']).log.id}`
}

function queuedNotebookId(item: SyncItem): string {
  if (item.action === 'put_notebook') return item.payload.id
  if (item.action === 'put_question_group') return item.payload.notebookId
  return item.payload.notebookId
}

function queuedEntryId(item: SyncItem): string | undefined {
  if (item.action === 'put_entry') return item.payload.entry.id
  if (item.action === 'delete_entry') return item.payload.entryId
  if (item.action === 'add_review_log') return item.payload.log.entryId
  return undefined
}

function enqueueSync<Action extends SyncAction>(
  action: Action,
  payload: SyncPayloadMap[Action],
): void {
  if (!pageUserId || getStoredUser()?.id !== pageUserId) return
  let queue = getPendingQueue()
  const id = syncItemId(action, payload)

  // 删除父级时，丢弃尚未发出的子级操作，避免重连后重新创建已删除的数据。
  if (action === 'delete_notebook') {
    queue = queue.filter(
      (item) =>
        item.id === id ||
        queuedNotebookId(item) !== (payload as SyncPayloadMap['delete_notebook']).notebookId,
    )
  } else if (action === 'delete_entry') {
    const entryId = (payload as SyncPayloadMap['delete_entry']).entryId
    queue = queue.filter((item) => item.id === id || queuedEntryId(item) !== entryId)
  }

  const newItem = {
    id,
    action,
    payload,
    timestamp: Date.now(),
  } as SyncItem
  const existingIndex = queue.findIndex((item) => item.id === id)

  if (existingIndex >= 0) queue[existingIndex] = newItem
  else queue.push(newItem)

  savePendingQueue(queue)
  console.warn(`[离线优先] 操作已进入同步队列（当前 ${queue.length} 条）:`, action)
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [],
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    if (getStoredUser()?.id !== pageUserId || getAccessToken() !== pageToken)
      throw new ApiError('账号已切换，请重新加载页面')
    const token = pageToken
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(url, { ...init, headers, signal: controller.signal })
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw new ApiError(`请求失败：HTTP ${response.status}`, response.status)
    }
    // Keep the abort timer active through JSON body download, not just headers.
    // Data reads use JSON; writes and the health probe only need the status.
    if (
      (!init.method || init.method === 'GET' || url.endsWith('/notebooks/overview')) &&
      url !== HEALTH_URL
    ) {
      const payload: unknown = await response.json()
      response.json = async () => payload
    }
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(error instanceof Error ? error.message : '网络请求失败')
  } finally {
    clearTimeout(timeoutId)
  }
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ---------------------------------------------------------------------------
// 2. 探针：检测 Python 后端与 MySQL 是否连通
// ---------------------------------------------------------------------------
export async function isServerOnline(): Promise<boolean> {
  try {
    await fetchWithTimeout(HEALTH_URL)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 3. 基础远端操作
// ---------------------------------------------------------------------------
async function putNotebookRemote(notebook: Notebook): Promise<void> {
  const updateResponse = await fetchWithTimeout(
    `${API_BASE}/notebooks/${encodeURIComponent(notebook.id)}`,
    jsonRequest('PATCH', {
      name: notebook.name,
      description: notebook.description,
      instructions: notebook.instructions,
      sort_order: notebook.sortOrder,
    }),
    [404],
  )

  if (updateResponse.status === 404) {
    await fetchWithTimeout(
      `${API_BASE}/notebooks`,
      jsonRequest('POST', {
        id: notebook.id,
        name: notebook.name,
        description: notebook.description,
        instructions: notebook.instructions,
      }),
    )
  }
}

async function deleteNotebookRemote(notebookId: string): Promise<void> {
  await fetchWithTimeout(
    `${API_BASE}/notebooks/${encodeURIComponent(notebookId)}`,
    { method: 'DELETE' },
    [404],
  )
}

async function putEntryRemote(notebookId: string, entry: NoteEntry): Promise<void> {
  assertLoaded(entry)
  const [question, wrongAnswer, correctAnswer] = await Promise.all([
    toRemoteHtml(entry.question),
    toRemoteHtml(entry.wrongAnswer),
    toRemoteHtml(entry.correctAnswer),
  ])
  const updateResponse = await fetchWithTimeout(
    `${API_BASE}/entries/${encodeURIComponent(entry.id)}`,
    jsonRequest('PATCH', {
      title: entry.title,
      question,
      wrong_answer: wrongAnswer,
      correct_answer: correctAnswer,
      subject: entry.subject,
      source: entry.source,
      tags: entry.tags,
      drawings: entry.drawings,
      sort_order: entry.sortOrder,
      folder: entry.folder,
      group_id: entry.groupId,
      sub_question_order: entry.subQuestionOrder,
      mastery_level: entry.masteryLevel,
      review_count: entry.reviewCount,
      next_review_date: entry.nextReviewDate,
    }),
    [404],
  )

  if (updateResponse.status === 404) {
    await fetchWithTimeout(
      `${API_BASE}/entries`,
      jsonRequest('POST', {
        id: entry.id,
        notebook_id: notebookId,
        title: entry.title,
        question,
        correct_answer: correctAnswer,
        wrong_answer: wrongAnswer,
        subject: entry.subject,
        source: entry.source,
        tags: entry.tags,
        drawings: entry.drawings,
        sort_order: entry.sortOrder,
        folder: entry.folder,
        group_id: entry.groupId,
        sub_question_order: entry.subQuestionOrder,
        review_count: entry.reviewCount,
      }),
    )
  }
}

async function deleteEntryRemote(entryId: string): Promise<void> {
  await fetchWithTimeout(
    `${API_BASE}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' },
    [404],
  )
}

async function putQuestionGroupRemote(group: QuestionGroup): Promise<void> {
  assertLoaded(group)
  const material = await toRemoteHtml(group.material)
  const updateResponse = await fetchWithTimeout(
    `${API_BASE}/question-groups/${encodeURIComponent(group.id)}`,
    jsonRequest('PATCH', { title: group.title, material, drawings: group.drawings }),
    [404],
  )
  if (updateResponse.status === 404) {
    await fetchWithTimeout(
      `${API_BASE}/question-groups`,
      jsonRequest('POST', {
        id: group.id,
        notebook_id: group.notebookId,
        title: group.title,
        material,
        drawings: group.drawings,
      }),
    )
  }
}

async function deleteQuestionGroupRemote(groupId: string): Promise<void> {
  await fetchWithTimeout(
    `${API_BASE}/question-groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' },
    [404],
  )
}

async function addReviewLogRemote(log: ReviewLog): Promise<void> {
  await fetchWithTimeout(
    `${API_BASE}/entries/${encodeURIComponent(log.entryId)}/review`,
    jsonRequest('POST', {
      id: log.id,
      timestamp: log.timestamp,
      quality: log.quality,
      is_correct: log.isCorrect,
      elapsed_ms: log.elapsedMs,
      answer_text: log.answerText,
    }),
  )
}

async function syncItem(item: SyncItem): Promise<void> {
  if (item.action === 'put_notebook') {
    await putNotebookRemote(item.payload)
  } else if (item.action === 'delete_notebook') {
    await deleteNotebookRemote(item.payload.notebookId)
  } else if (item.action === 'put_entry') {
    await putEntryRemote(item.payload.notebookId, item.payload.entry)
  } else if (item.action === 'delete_entry') {
    await deleteEntryRemote(item.payload.entryId)
  } else if (item.action === 'put_question_group') {
    await putQuestionGroupRemote(item.payload.group)
  } else if (item.action === 'delete_question_group') {
    await deleteQuestionGroupRemote(item.payload.groupId)
  } else {
    await addReviewLogRemote(item.payload.log)
  }
}

// ---------------------------------------------------------------------------
// 4. 后台静默同步网络恢复队列
// ---------------------------------------------------------------------------
let isSyncing = false

export async function flushPendingQueue(): Promise<number> {
  if (isSyncing || !pageUserId || !pageToken) return 0
  // Empty queues need no network probe, including on startup and every timer tick.
  const snapshot = getPendingQueue()
  if (snapshot.length === 0) return 0
  isSyncing = true

  try {
    if (!(await isServerOnline())) return 0

    const priority: Record<SyncAction, number> = {
      put_notebook: 0,
      put_question_group: 1,
      put_entry: 2,
      add_review_log: 3,
      delete_entry: 4,
      delete_question_group: 5,
      delete_notebook: 6,
    }
    snapshot.sort((a, b) => priority[a.action] - priority[b.action])

    console.log(`[自动同步] 开始同步 ${snapshot.length} 条离线修改至 MySQL…`)
    const processed = new Map<string, number>()
    let successCount = 0

    for (const item of snapshot) {
      try {
        await syncItem(item)
        processed.set(item.id, item.timestamp)
        successCount += 1
      } catch (error) {
        console.error(`[自动同步] 补发操作 ${item.action} 失败:`, error)
        // A stalled backend must not cost one timeout per queued item.
        // Unattempted and failed items remain queued for the next retry.
        if (!(error instanceof ApiError) || !error.status || error.status >= 500) break
      }
    }

    // 同步期间可能又有新操作入队。只移除时间戳仍与快照相同的成功项，
    // 避免最后一次 save 覆盖掉刚发生的用户修改。
    const latestQueue = getPendingQueue()
    const remainingQueue = latestQueue.filter((item) => {
      const processedTimestamp = processed.get(item.id)
      if (processedTimestamp === undefined) return true
      if (item.timestamp !== processedTimestamp) return true
      return false
    })
    savePendingQueue(remainingQueue)
    const completed = snapshot.filter(
      (item) => processed.has(item.id) && !remainingQueue.some((pending) => pending.id === item.id),
    )
    if (completed.length && typeof window !== 'undefined') {
      const detail: SyncCompleted = {
        owner: pageUserId,
        entryIds: completed.flatMap((item) => {
          const id = queuedEntryId(item)
          return id ? [id] : []
        }),
        groupIds: completed.flatMap((item) =>
          item.action === 'put_question_group' ? [item.payload.group.id] : [],
        ),
      }
      window.dispatchEvent(new CustomEvent(SYNC_COMPLETED_EVENT, { detail }))
    }

    console.log(`[自动同步] 完成：成功 ${successCount} 条，待重试 ${remainingQueue.length} 条。`)
    return successCount
  } finally {
    isSyncing = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushPendingQueue())
  window.setInterval(() => void flushPendingQueue(), 10_000)
  void flushPendingQueue()
}

function mapNotebook(item: ApiNotebook): Notebook {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    instructions: item.instructions,
    sortOrder: item.sort_order,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

function mapEntry(item: ApiEntry): NoteEntry {
  return {
    id: item.id,
    notebookId: item.notebook_id,
    title: item.title,
    question: item.question,
    wrongAnswer: item.wrong_answer,
    correctAnswer: item.correct_answer,
    subject: item.subject,
    source: item.source,
    tags: item.tags || [],
    drawings: item.drawings || {},
    sortOrder: item.sort_order,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    reviewCount: item.review_count,
    wrongCount: item.wrong_count,
    consecutivePasses: item.consecutive_passes,
    masteryLevel: item.mastery_level,
    easeFactor: item.ease_factor,
    interval: item.interval,
    lastReviewDate: item.last_review_date,
    nextReviewDate: item.next_review_date,
    folder: item.folder || undefined,
    groupId: item.group_id || undefined,
    subQuestionOrder: item.sub_question_order ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// 5. 智能笔记本仓库适配器
// ---------------------------------------------------------------------------
export const smartNotebookRepository = (fallback: NotebookRepository): NotebookRepository => ({
  async getAll(): Promise<Notebook[]> {
    const localList = await fallback.getAll()

    try {
      void flushPendingQueue()

      const response = await fetchWithTimeout(`${API_BASE}/notebooks`)
      const data = (await response.json()) as { items?: ApiNotebook[] }
      const pending = getPendingQueue()
      const deleted = new Set(
        pending.flatMap((item) =>
          item.action === 'delete_notebook' ? [item.payload.notebookId] : [],
        ),
      )
      const remoteList: Notebook[] = (data.items || [])
        .map(mapNotebook)
        .filter((notebook) => !deleted.has(notebook.id))
      const remoteById = new Map(remoteList.map((notebook) => [notebook.id, notebook]))
      const mergedById = new Map(remoteById)

      for (const localNotebook of localList) {
        if (deleted.has(localNotebook.id)) continue
        const remoteNotebook = remoteById.get(localNotebook.id)
        if (!remoteNotebook || localNotebook.updatedAt > remoteNotebook.updatedAt) {
          mergedById.set(localNotebook.id, localNotebook)
          enqueueSync('put_notebook', localNotebook)
        }
      }
      for (const item of pending)
        if (item.action === 'put_notebook') mergedById.set(item.payload.id, item.payload)

      await Promise.all(
        remoteList
          .filter((remoteNotebook) => {
            const localNotebook = localList.find((candidate) => candidate.id === remoteNotebook.id)
            return !localNotebook || remoteNotebook.updatedAt > localNotebook.updatedAt
          })
          .map((notebook) => fallback.put(notebook)),
      )
      void flushPendingQueue()

      return [...mergedById.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    } catch {
      return localList
    }
  },

  async put(notebook: Notebook): Promise<void> {
    await fallback.put(notebook)
    enqueueSync('put_notebook', notebook)
    void flushPendingQueue()
  },

  async delete(notebookId: string): Promise<void> {
    await fallback.delete(notebookId)
    enqueueSync('delete_notebook', { notebookId })
    void flushPendingQueue()
  },
})

// ---------------------------------------------------------------------------
// 6. 智能错题条目仓库适配器
// ---------------------------------------------------------------------------
export const smartEntryRepository = (fallback: EntryRepository): EntryRepository => ({
  async getSummaries(notebookId) {
    const localList = fallback.getSummaries
      ? await fallback.getSummaries(notebookId)
      : (await fallback.getAll(notebookId)).map(entrySummary)
    void flushPendingQueue()
    // Merge in-flight edits/deletes after reading metadata; unrelated pending
    // writes must not hide new or updated questions in this notebook.
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/entries/summaries?notebook_id=${encodeURIComponent(notebookId)}`,
      )
      const data = (await response.json()) as { items: ApiEntry[] }
      const remoteList = data.items.map((item) =>
        entrySummary({ ...mapEntry(item), questionPreview: item.question_preview }),
      )
      const merged = new Map(remoteList.map((entry) => [entry.id, entry]))
      const pending = getPendingQueue()
      const deleted = new Set(
        pending.filter((item) => item.action === 'delete_entry').map((item) => queuedEntryId(item)),
      )
      for (const local of localList) {
        if (deleted.has(local.id)) continue
        const remote = merged.get(local.id)
        if (!remote || local.updatedAt > remote.updatedAt) {
          merged.set(local.id, local)
          // Only changed local records need content for upload; do this off the read path.
          void fallback
            .get(notebookId, local.id)
            .then((entry) => {
              if (
                getPendingQueue().some(
                  (item) => item.id === `entry:${local.id}` && item.action === 'delete_entry',
                )
              )
                return
              if (entry) {
                enqueueSync('put_entry', { notebookId, entry })
                void flushPendingQueue()
              }
            })
            .catch((error) => console.warn('本地题目暂未同步', error))
        }
      }
      for (const item of pending) {
        if (item.action === 'put_entry' && item.payload.notebookId === notebookId)
          merged.set(item.payload.entry.id, entrySummary(item.payload.entry))
      }
      deleted.forEach((id) => {
        if (id) merged.delete(id)
      })
      const result = [...merged.values()]
      await fallback.cacheSummaries?.(notebookId, result)
      return result
    } catch (error) {
      if (!localList.length) throw error
      return localList
    }
  },

  async searchIds(notebookId, query) {
    const localIds = fallback.searchIds
      ? await fallback.searchIds(notebookId, query)
      : (await fallback.getAll(notebookId))
          .filter((entry) => matchesEntry(entry, query))
          .map((entry) => entry.id)
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/entries/summaries?notebook_id=${encodeURIComponent(notebookId)}&q=${encodeURIComponent(query)}`,
      )
      const data = (await response.json()) as { items: { id: string }[] }
      const deletedIds = new Set(
        getPendingQueue()
          .filter((item) => item.action === 'delete_entry')
          .map((item) => queuedEntryId(item)),
      )
      const unsynced = new Set(
        getPendingQueue().flatMap((item) =>
          item.action === 'put_entry' ? [item.payload.entry.id] : [],
        ),
      )
      return [
        ...new Set([
          ...data.items.map((item) => item.id),
          ...localIds.filter((id) => unsynced.has(id)),
        ]),
      ].filter((id) => !deletedIds.has(id))
    } catch (error) {
      if (!fallback.getSummaries) throw error
      const [summaries, cached] = await Promise.all([
        fallback.getSummaries(notebookId),
        fallback.getAll(notebookId),
      ])
      const cachedIds = new Set(cached.map((entry) => entry.id))
      if (summaries.length && summaries.every((entry) => cachedIds.has(entry.id))) return localIds
      throw new IncompleteSearchError(localIds)
    }
  },
  async getAll(notebookId: string): Promise<NoteEntry[]> {
    const localList = await fallback.getAll(notebookId)

    try {
      void flushPendingQueue()
      if (getPendingQueue().length > 0) return fallback.getAll(notebookId)

      const response = await fetchWithTimeout(
        `${API_BASE}/entries/search?notebook_id=${encodeURIComponent(notebookId)}`,
      )
      const data = (await response.json()) as { items?: ApiEntry[] }
      const remoteList: NoteEntry[] = (data.items || []).map(mapEntry)
      const remoteById = new Map(remoteList.map((entry) => [entry.id, entry]))
      const mergedById = new Map(remoteById)

      for (const localEntry of localList) {
        const remoteEntry = remoteById.get(localEntry.id)
        if (!remoteEntry || localEntry.updatedAt > remoteEntry.updatedAt) {
          mergedById.set(localEntry.id, localEntry)
          enqueueSync('put_entry', { notebookId, entry: localEntry })
        }
      }

      await Promise.all(
        remoteList
          .filter((remoteEntry) => {
            const localEntry = localList.find((candidate) => candidate.id === remoteEntry.id)
            return !localEntry || remoteEntry.updatedAt > localEntry.updatedAt
          })
          .map((entry) => fallback.put(notebookId, entry)),
      )
      void flushPendingQueue()

      return [...mergedById.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    } catch {
      return localList
    }
  },

  async get(notebookId: string, entryId: string): Promise<NoteEntry | undefined> {
    const local = await fallback.get(notebookId, entryId)
    const pending = getPendingQueue().find((item) => item.id === `entry:${entryId}`)
    if (pending?.action === 'delete_entry') return undefined
    if (pending?.action === 'put_entry') return local ?? pending.payload.entry
    const summary = await fallback.getSummary?.(notebookId, entryId)
    if (local && summary && local.updatedAt >= summary.updatedAt) return local
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/entries/${encodeURIComponent(entryId)}?notebook_id=${encodeURIComponent(notebookId)}`,
        {},
        [404],
      )
      if (response.status === 404) return local
      const remote = mapEntry((await response.json()) as ApiEntry)
      if (remote.id !== entryId || remote.notebookId !== notebookId)
        throw new ApiError('题目所属笔记本不匹配')
      if (local && local.updatedAt > remote.updatedAt) {
        enqueueSync('put_entry', { notebookId, entry: local })
        void flushPendingQueue()
        return local
      }
      await fallback.put(notebookId, remote)
      return remote
    } catch (error) {
      if (local) return local
      throw error
    }
  },

  async put(notebookId: string, entry: NoteEntry): Promise<void> {
    assertLoaded(entry)
    await fallback.put(notebookId, entry)
    enqueueSync('put_entry', { notebookId, entry })
    void flushPendingQueue()
  },

  async delete(notebookId: string, entryId: string): Promise<void> {
    await fallback.delete(notebookId, entryId)
    enqueueSync('delete_entry', { notebookId, entryId })
    void flushPendingQueue()
  },

  putSnapshot: (notebookId, entryId, data) => fallback.putSnapshot(notebookId, entryId, data),
  getSnapshot: (notebookId, entryId) => fallback.getSnapshot(notebookId, entryId),
  getAllSnapshots: (notebookId) => fallback.getAllSnapshots(notebookId),
  deleteSnapshot: (notebookId, entryId) => fallback.deleteSnapshot(notebookId, entryId),
  deleteAllSnapshots: (notebookId) => fallback.deleteAllSnapshots(notebookId),
})

function mapQuestionGroup(item: ApiQuestionGroup): QuestionGroup {
  return {
    id: item.id,
    notebookId: item.notebook_id,
    title: item.title,
    material: item.material,
    drawings: item.drawings || {},
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

export const smartQuestionGroupRepository = (
  fallback: QuestionGroupRepository,
): QuestionGroupRepository => ({
  async getSummaries(notebookId) {
    const local = fallback.getSummaries
      ? await fallback.getSummaries(notebookId)
      : (await fallback.getAll(notebookId)).map(groupSummary)
    void flushPendingQueue()
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/question-groups/summaries?notebook_id=${encodeURIComponent(notebookId)}`,
      )
      const data = (await response.json()) as { items: ApiQuestionGroup[] }
      const remote = data.items.map((item) => groupSummary(mapQuestionGroup(item)))
      const merged = new Map(remote.map((group) => [group.id, group]))
      const pending = getPendingQueue()
      const deleted = new Set(
        pending.flatMap((item) =>
          item.action === 'delete_question_group' ? [item.payload.groupId] : [],
        ),
      )
      for (const group of local) {
        if (deleted.has(group.id)) continue
        const existing = merged.get(group.id)
        if (!existing || group.updatedAt > existing.updatedAt) {
          merged.set(group.id, group)
          void fallback
            .get(notebookId, group.id)
            .then((full) => {
              if (
                getPendingQueue().some(
                  (item) =>
                    item.id === `question-group:${group.id}` &&
                    item.action === 'delete_question_group',
                )
              )
                return
              if (full) {
                enqueueSync('put_question_group', { notebookId, group: full })
                void flushPendingQueue()
              }
            })
            .catch((error) => console.warn('本地题组暂未同步', error))
        }
      }
      for (const item of pending) {
        if (item.action === 'put_question_group' && item.payload.notebookId === notebookId)
          merged.set(item.payload.group.id, groupSummary(item.payload.group))
      }
      deleted.forEach((id) => merged.delete(id))
      const result = [...merged.values()]
      await fallback.cacheSummaries?.(notebookId, result)
      return result
    } catch (error) {
      if (!local.length) throw error
      return local
    }
  },
  async getAll(notebookId: string): Promise<QuestionGroup[]> {
    const localList = await fallback.getAll(notebookId)
    try {
      void flushPendingQueue()
      if (getPendingQueue().length > 0) return fallback.getAll(notebookId)
      const response = await fetchWithTimeout(
        `${API_BASE}/question-groups?notebook_id=${encodeURIComponent(notebookId)}`,
      )
      const data = (await response.json()) as { items?: ApiQuestionGroup[] }
      const remoteList = (data.items || []).map(mapQuestionGroup)
      const remoteById = new Map(remoteList.map((group) => [group.id, group]))
      const mergedById = new Map(remoteById)
      for (const localGroup of localList) {
        const remoteGroup = remoteById.get(localGroup.id)
        if (!remoteGroup || localGroup.updatedAt > remoteGroup.updatedAt) {
          mergedById.set(localGroup.id, localGroup)
          enqueueSync('put_question_group', { notebookId, group: localGroup })
        }
      }
      await Promise.all(
        remoteList
          .filter((group) => {
            const local = localList.find((candidate) => candidate.id === group.id)
            return !local || group.updatedAt > local.updatedAt
          })
          .map((group) => fallback.put(notebookId, group)),
      )
      void flushPendingQueue()
      return [...mergedById.values()]
    } catch {
      return localList
    }
  },

  async get(notebookId: string, groupId: string): Promise<QuestionGroup | undefined> {
    const local = await fallback.get(notebookId, groupId)
    const pending = getPendingQueue().find((item) => item.id === `question-group:${groupId}`)
    if (pending?.action === 'delete_question_group') return undefined
    if (pending?.action === 'put_question_group') return local ?? pending.payload.group
    const summary = await fallback.getSummary?.(notebookId, groupId)
    if (local && summary && local.updatedAt >= summary.updatedAt) return local
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/question-groups/${encodeURIComponent(groupId)}?notebook_id=${encodeURIComponent(notebookId)}`,
        {},
        [404],
      )
      if (response.status === 404) return local
      const remote = mapQuestionGroup((await response.json()) as ApiQuestionGroup)
      if (remote.id !== groupId || remote.notebookId !== notebookId)
        throw new ApiError('题组所属笔记本不匹配')
      if (local && local.updatedAt > remote.updatedAt) {
        enqueueSync('put_question_group', { notebookId, group: local })
        void flushPendingQueue()
        return local
      }
      await fallback.put(notebookId, remote)
      return remote
    } catch (error) {
      if (local) return local
      throw error
    }
  },

  async put(notebookId: string, group: QuestionGroup): Promise<void> {
    assertLoaded(group)
    await fallback.put(notebookId, group)
    enqueueSync('put_question_group', { notebookId, group })
    void flushPendingQueue()
  },

  async delete(notebookId: string, groupId: string): Promise<void> {
    await fallback.delete(notebookId, groupId)
    enqueueSync('delete_question_group', { notebookId, groupId })
    void flushPendingQueue()
  },
})

// ---------------------------------------------------------------------------
// 7. 智能复习日志仓库适配器
// ---------------------------------------------------------------------------
export const smartReviewLogRepository = (fallback: ReviewLogRepository): ReviewLogRepository => ({
  getAll: (notebookId) => fallback.getAll(notebookId),

  async add(notebookId: string, log: ReviewLog): Promise<void> {
    await fallback.add(notebookId, log)
    enqueueSync('add_review_log', { notebookId, log })
    void flushPendingQueue()
  },

  deleteByEntry: (notebookId, entryId) => fallback.deleteByEntry(notebookId, entryId),
})

// The home screen reads counts in one request, never through entry/log repositories.
const overviewCacheKey = `notebook_overview_v1:${pageUserId ?? 'local'}`

function cacheOverview(result: NotebookOverview): void {
  try {
    localStorage.setItem(
      overviewCacheKey,
      JSON.stringify({ day: new Date().toDateString(), result }),
    )
  } catch {
    // A full/disabled browser cache must not prevent displaying fresh statistics.
  }
}

function cachedOverview(): NotebookOverview | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(overviewCacheKey) || 'null')
    if (
      cached?.day === new Date().toDateString() &&
      Array.isArray(cached.result?.items) &&
      Array.isArray(cached.result?.subjects) &&
      Array.isArray(cached.result?.reviewDays)
    )
      return cached.result
  } catch {
    // A missing or outdated cache falls back to local storage.
  }
}

export async function fetchNotebookOverview(
  notebookIds: string[],
  local: (notebookIds: string[]) => Promise<LocalNotebookOverview>,
): Promise<NotebookOverview> {
  const localData = await local(notebookIds)
  if (!pageUserId) return localData.overview
  try {
    const pending = getPendingQueue()
    const response = await fetchWithTimeout(
      `${API_BASE}/notebooks/overview`,
      jsonRequest('POST', {
        utc_offset_minutes: -new Date().getTimezoneOffset(),
        notebook_ids: notebookIds,
        local_entries: localData.entries.map((entry) => ({
          id: entry.id,
          notebook_id: entry.notebookId,
          subject: entry.subject || '',
          next_review_date: entry.nextReviewDate ?? null,
          updated_at: entry.updatedAt || 0,
        })),
        local_reviews: localData.reviews.map((log) => ({
          id: log.id,
          entry_id: log.entryId,
          timestamp: log.timestamp,
        })),
        entries: pending.flatMap((item) =>
          item.action === 'put_entry'
            ? [
                {
                  id: item.payload.entry.id,
                  notebook_id: item.payload.notebookId,
                  subject: item.payload.entry.subject || '',
                  next_review_date: item.payload.entry.nextReviewDate ?? null,
                },
              ]
            : [],
        ),
        deleted_entry_ids: pending.flatMap((item) =>
          item.action === 'delete_entry' ? [item.payload.entryId] : [],
        ),
        reviews: pending.flatMap((item) =>
          item.action === 'add_review_log'
            ? [
                {
                  id: item.payload.log.id,
                  entry_id: item.payload.log.entryId,
                  timestamp: item.payload.log.timestamp,
                },
              ]
            : [],
        ),
      }),
    )
    const result = (await response.json()) as NotebookOverview
    if (
      !Array.isArray(result.items) ||
      !Array.isArray(result.subjects) ||
      !Array.isArray(result.reviewDays)
    )
      throw new ApiError('统计响应不完整')
    // A new local notebook may not have reached the server yet.
    const missing = notebookIds.filter((id) => !result.items.some((item) => item.notebookId === id))
    if (missing.length) {
      const localResult = aggregateNotebookOverview(missing, localData.entries, localData.reviews)
      result.items.push(...localResult.items)
      const subjects = new Map(result.subjects.map((subject) => [subject.name, subject.count]))
      for (const subject of localResult.subjects)
        subjects.set(subject.name, (subjects.get(subject.name) || 0) + subject.count)
      result.subjects = [...subjects]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
      for (const day of result.reviewDays)
        day.count +=
          localResult.reviewDays.find((localDay) => localDay.timestamp === day.timestamp)?.count ||
          0
    }
    cacheOverview(result)
    return result
  } catch {
    const cached = cachedOverview()
    if (cached && notebookIds.every((id) => cached.items.some((item) => item.notebookId === id)))
      return { ...cached, stale: true }
    return { ...localData.overview, stale: true }
  }
}

export function migrateLegacySyncQueue(ownedNotebookIds: Set<string>): void {
  const migrationKey = `${queueKey}:legacy-migrated`
  if (!pageUserId || localStorage.getItem(migrationKey)) return
  const raw = localStorage.getItem(PENDING_QUEUE_KEY)
  if (raw) {
    const legacy: SyncItem[] = JSON.parse(raw)
    const current = getPendingQueue()
    const currentIds = new Set(current.map((item) => item.id))
    savePendingQueue([
      ...legacy.filter(
        (item) => ownedNotebookIds.has(queuedNotebookId(item)) && !currentIds.has(item.id),
      ),
      ...current,
    ])
  }
  localStorage.setItem(migrationKey, 'true')
}
