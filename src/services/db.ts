// Persistent storage adapters. Keep the IndexedDB schema and Electron file format unchanged.
import { getAccessToken, getStoredUser } from '@/services/auth'
import { localMode } from '@/services/localMode'
import { assertLoaded, entrySummary, groupSummary, matchesEntry } from './entrySummary'
import type { NoteEntry, ReviewLog, Notebook, QuestionGroup } from '@/types'
import type {
  EntryRepository,
  EntrySnapshot,
  NotebookRepository,
  QuestionGroupRepository,
  ReviewLogRepository,
} from '@/services/repositories'
import {
  migrateLegacySyncQueue,
  smartEntryRepository,
  smartNotebookRepository,
  smartQuestionGroupRepository,
  smartReviewLogRepository,
  fetchNotebookOverview,
} from '@/services/apiAdapter'
import { aggregateNotebookOverview, type NotebookOverview } from './notebookOverview'

const STORE = 'entries'
const SNAP_STORE = 'snapshots'
const REVIEW_LOG_STORE = 'reviewLogs'
const NOTEBOOK_STORE = 'notebooks'
const QUESTION_GROUP_STORE = 'questionGroups'
const ENTRY_SUMMARY_STORE = 'entrySummaries'
const GROUP_SUMMARY_STORE = 'questionGroupSummaries'

const LEGACY_DB_NAME = 'CuotiDB'
const DB_NAME = `${LEGACY_DB_NAME}:${getStoredUser()?.id ?? 'local'}`
const DB_VERSION = 7

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

function requireNotebookId(notebookId: string): string {
  if (!notebookId) throw new Error('notebookId is required')
  return notebookId
}

function assertEntryNotebook(notebookId: string, entry: NoteEntry): void {
  assertLoaded(entry)
  requireNotebookId(notebookId)
  if (entry.notebookId !== notebookId) {
    throw new Error(`Entry ${entry.id} belongs to notebook ${entry.notebookId}, not ${notebookId}`)
  }
}

function openDB(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    let blocked = false
    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('subject', 'subject', { unique: false })
      }
      if (!database.objectStoreNames.contains(SNAP_STORE)) {
        database.createObjectStore(SNAP_STORE, { keyPath: 'entryId' })
      }
      if (!database.objectStoreNames.contains(REVIEW_LOG_STORE)) {
        const store = database.createObjectStore(REVIEW_LOG_STORE, { keyPath: 'id' })
        store.createIndex('entryId', 'entryId', { unique: false })
      }
      if (!database.objectStoreNames.contains(NOTEBOOK_STORE)) {
        database.createObjectStore(NOTEBOOK_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(QUESTION_GROUP_STORE)) {
        const store = database.createObjectStore(QUESTION_GROUP_STORE, { keyPath: 'id' })
        store.createIndex('notebookId', 'notebookId', { unique: false })
      }
      const upgrade = req.transaction!
      const entries = upgrade.objectStore(STORE)
      if (!entries.indexNames.contains('notebookId'))
        entries.createIndex('notebookId', 'notebookId')
      const groups = upgrade.objectStore(QUESTION_GROUP_STORE)
      if (!groups.indexNames.contains('notebookId')) groups.createIndex('notebookId', 'notebookId')
      for (const [source, target, summarize] of [
        [STORE, ENTRY_SUMMARY_STORE, entrySummary],
        [QUESTION_GROUP_STORE, GROUP_SUMMARY_STORE, groupSummary],
      ] as const) {
        if (database.objectStoreNames.contains(target)) continue
        const summaries = database.createObjectStore(target, { keyPath: 'id' })
        summaries.createIndex('notebookId', 'notebookId')
        const cursor = upgrade.objectStore(source).openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) return
          summaries.put(summarize(row.value))
          row.continue()
        }
      }
    }
    req.onblocked = () => {
      blocked = true
      reject(new Error('本地缓存升级被其他页面阻挡，请关闭其他错题本页面后重试'))
    }
    req.onsuccess = () => {
      if (blocked) {
        req.result.close()
        return
      }
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  storeName = STORE,
): Promise<T> {
  return openDB().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode)
        const request = fn(transaction.objectStore(storeName))
        transaction.oncomplete = () => {
          database.close()
          resolve(request.result)
        }
        transaction.onerror = transaction.onabort = () => {
          database.close()
          reject(transaction.error ?? request.error)
        }
      }),
  )
}

function deleteKeys(storeName: string, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve()
  return openDB().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        keys.forEach((key) => store.delete(key))
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = transaction.onabort = () => {
          database.close()
          reject(transaction.error)
        }
      }),
  )
}

async function writeWithSummary(
  storeName: string,
  summaryStore: string,
  value: NoteEntry | QuestionGroup,
  summary: NoteEntry | QuestionGroup,
): Promise<void> {
  assertLoaded(value)
  const database = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName, summaryStore], 'readwrite')
    transaction.objectStore(storeName).put(value)
    transaction.objectStore(summaryStore).put(summary)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = transaction.onabort = () => {
      database.close()
      reject(transaction.error)
    }
  })
}

async function cacheSummaries(
  storeName: string,
  rows: (NoteEntry | QuestionGroup)[],
): Promise<void> {
  if (!rows.length) return
  const database = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    for (const row of rows) {
      const request = store.get(row.id)
      request.onsuccess = () => {
        if (!request.result || request.result.updatedAt <= row.updatedAt) store.put(row)
      }
    }
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = transaction.onabort = () => {
      database.close()
      reject(transaction.error)
    }
  })
}

export const electronEntryRepository: EntryRepository = {
  async getSummaries(notebookId) {
    requireNotebookId(notebookId)
    return (
      window.electronAPI!.getEntrySummaries?.(notebookId) ??
      (await window.electronAPI!.getAll(notebookId)).map(entrySummary)
    )
  },
  async searchIds(notebookId, query) {
    requireNotebookId(notebookId)
    if (window.electronAPI!.searchEntryIds)
      return window.electronAPI!.searchEntryIds(notebookId, query)
    const [entries, groups] = await Promise.all([
      electronEntryRepository.getAll(notebookId),
      electronQuestionGroupRepository.getAll(notebookId),
    ])
    const material = new Map(groups.map((group) => [group.id, group.material]))
    return entries
      .filter((entry) => matchesEntry(entry, query, material.get(entry.groupId ?? '')))
      .map((entry) => entry.id)
  },
  getAll(notebookId) {
    return window.electronAPI!.getAll(requireNotebookId(notebookId))
  },
  async get(notebookId, entryId) {
    const entry = await window.electronAPI!.get(requireNotebookId(notebookId), entryId)
    return entry ?? undefined
  },
  async put(notebookId, entry) {
    assertEntryNotebook(notebookId, entry)
    await window.electronAPI!.put(entry)
  },
  async delete(notebookId, entryId) {
    await window.electronAPI!.delete(requireNotebookId(notebookId), entryId)
  },
  async putSnapshot(notebookId, entryId, data) {
    assertEntryNotebook(notebookId, data)
    await window.electronAPI!.putSnapshot(notebookId, { entryId, data, savedAt: Date.now() })
  },
  async getSnapshot(notebookId, entryId) {
    const snapshot = await window.electronAPI!.getSnapshot(requireNotebookId(notebookId), entryId)
    return snapshot ?? undefined
  },
  getAllSnapshots(notebookId) {
    return window.electronAPI!.getAllSnapshots(requireNotebookId(notebookId))
  },
  async deleteSnapshot(notebookId, entryId) {
    await window.electronAPI!.deleteSnapshot(requireNotebookId(notebookId), entryId)
  },
  async deleteAllSnapshots(notebookId) {
    await window.electronAPI!.deleteAllSnapshots(requireNotebookId(notebookId))
  },
}

export const electronNotebookRepository: NotebookRepository = {
  getAll: () => window.electronAPI!.getAllNotebooks(),
  async put(notebook) {
    await window.electronAPI!.putNotebook(notebook)
  },
  async delete(notebookId) {
    await window.electronAPI!.deleteNotebook(requireNotebookId(notebookId))
  },
}

export const electronQuestionGroupRepository: QuestionGroupRepository = {
  async getSummaries(notebookId) {
    requireNotebookId(notebookId)
    return (
      window.electronAPI!.getQuestionGroupSummaries?.(notebookId) ??
      (await window.electronAPI!.getAllQuestionGroups(notebookId)).map(groupSummary)
    )
  },
  getAll(notebookId) {
    return window.electronAPI!.getAllQuestionGroups(requireNotebookId(notebookId))
  },
  async get(notebookId, groupId) {
    const group = await window.electronAPI!.getQuestionGroup(requireNotebookId(notebookId), groupId)
    return group ?? undefined
  },
  async put(notebookId, group) {
    assertLoaded(group)
    requireNotebookId(notebookId)
    if (group.notebookId !== notebookId) {
      throw new Error(`Question group ${group.id} belongs to another notebook`)
    }
    await window.electronAPI!.putQuestionGroup(group)
  },
  async delete(notebookId, groupId) {
    await window.electronAPI!.deleteQuestionGroup(requireNotebookId(notebookId), groupId)
  },
}

export const electronReviewLogRepository: ReviewLogRepository = {
  getAll(notebookId) {
    return window.electronAPI!.getAllReviewLogs(requireNotebookId(notebookId))
  },
  async add(notebookId, log) {
    await window.electronAPI!.addReviewLog(requireNotebookId(notebookId), log)
  },
  async deleteByEntry(notebookId, entryId) {
    await window.electronAPI!.deleteReviewLogsByEntry(requireNotebookId(notebookId), entryId)
  },
}

export const indexedDbEntryRepository: EntryRepository = {
  async getSummary(notebookId, entryId) {
    const summary = await tx<NoteEntry | undefined>(
      'readonly',
      (store) => store.get(entryId),
      ENTRY_SUMMARY_STORE,
    )
    return summary?.notebookId === notebookId ? summary : undefined
  },
  async getSummaries(notebookId) {
    requireNotebookId(notebookId)
    return tx<NoteEntry[]>(
      'readonly',
      (store) => store.index('notebookId').getAll(notebookId),
      ENTRY_SUMMARY_STORE,
    )
  },
  async cacheSummaries(notebookId, entries) {
    requireNotebookId(notebookId)
    if (entries.some((entry) => entry.notebookId !== notebookId))
      throw new Error('Invalid notebook')
    await cacheSummaries(ENTRY_SUMMARY_STORE, entries.map(entrySummary))
  },
  async searchIds(notebookId, query) {
    const [entries, groups] = await Promise.all([
      indexedDbEntryRepository.getAll(notebookId),
      indexedDbQuestionGroupRepository.getAll(notebookId),
    ])
    const material = new Map(groups.map((group) => [group.id, group.material]))
    return entries
      .filter((entry) => matchesEntry(entry, query, material.get(entry.groupId ?? '')))
      .map((entry) => entry.id)
  },
  async getAll(notebookId) {
    requireNotebookId(notebookId)
    return tx<NoteEntry[]>('readonly', (store) => store.index('notebookId').getAll(notebookId))
  },
  async get(notebookId, entryId) {
    requireNotebookId(notebookId)
    const entry = await tx<NoteEntry | undefined>('readonly', (store) => store.get(entryId))
    return entry?.notebookId === notebookId ? entry : undefined
  },
  async put(notebookId, entry) {
    assertEntryNotebook(notebookId, entry)
    await writeWithSummary(STORE, ENTRY_SUMMARY_STORE, entry, entrySummary(entry))
  },
  async delete(notebookId, entryId) {
    const summaries = await indexedDbEntryRepository.getSummaries!(notebookId)
    if (!summaries.some((entry) => entry.id === entryId)) return
    await Promise.all([deleteKeys(STORE, [entryId]), deleteKeys(ENTRY_SUMMARY_STORE, [entryId])])
  },
  async putSnapshot(notebookId, entryId, data) {
    assertEntryNotebook(notebookId, data)
    await tx('readwrite', (store) => store.put({ entryId, data, savedAt: Date.now() }), SNAP_STORE)
  },
  async getSnapshot(notebookId, entryId) {
    requireNotebookId(notebookId)
    const snapshot = await tx<EntrySnapshot | undefined>(
      'readonly',
      (store) => store.get(entryId),
      SNAP_STORE,
    )
    return snapshot?.data?.notebookId === notebookId ? snapshot : undefined
  },
  async getAllSnapshots(notebookId) {
    requireNotebookId(notebookId)
    const all = await tx<EntrySnapshot[]>('readonly', (store) => store.getAll(), SNAP_STORE)
    return all.filter((snapshot) => snapshot.data?.notebookId === notebookId)
  },
  async deleteSnapshot(notebookId, entryId) {
    const snapshot = await indexedDbEntryRepository.getSnapshot(notebookId, entryId)
    if (snapshot) await tx('readwrite', (store) => store.delete(entryId), SNAP_STORE)
  },
  async deleteAllSnapshots(notebookId) {
    const snapshots = await indexedDbEntryRepository.getAllSnapshots(notebookId)
    await deleteKeys(
      SNAP_STORE,
      snapshots.map((snapshot) => snapshot.entryId),
    )
  },
}

export const indexedDbNotebookRepository: NotebookRepository = {
  getAll: () => tx<Notebook[]>('readonly', (store) => store.getAll(), NOTEBOOK_STORE),
  async put(notebook) {
    await tx('readwrite', (store) => store.put(notebook), NOTEBOOK_STORE)
  },
  async delete(notebookId) {
    requireNotebookId(notebookId)
    const entries = await indexedDbEntryRepository.getSummaries!(notebookId)
    const entryIds = new Set(entries.map((entry) => entry.id))
    const [snapshots, reviewLogs, questionGroups] = await Promise.all([
      indexedDbEntryRepository.getAllSnapshots(notebookId),
      getAllIndexedDbReviewLogs(),
      indexedDbQuestionGroupRepository.getAll(notebookId),
    ])
    await Promise.all([
      deleteKeys(
        REVIEW_LOG_STORE,
        reviewLogs.filter((log) => entryIds.has(log.entryId)).map((log) => log.id),
      ),
      deleteKeys(
        SNAP_STORE,
        snapshots.map((snapshot) => snapshot.entryId),
      ),
      deleteKeys(
        STORE,
        entries.map((entry) => entry.id),
      ),
      deleteKeys(
        ENTRY_SUMMARY_STORE,
        entries.map((entry) => entry.id),
      ),
      deleteKeys(
        GROUP_SUMMARY_STORE,
        questionGroups.map((group) => group.id),
      ),
      deleteKeys(
        QUESTION_GROUP_STORE,
        questionGroups.map((group) => group.id),
      ),
    ])
    await tx('readwrite', (store) => store.delete(notebookId), NOTEBOOK_STORE)
  },
}

export const indexedDbQuestionGroupRepository: QuestionGroupRepository = {
  async getSummary(notebookId, groupId) {
    const summary = await tx<QuestionGroup | undefined>(
      'readonly',
      (store) => store.get(groupId),
      GROUP_SUMMARY_STORE,
    )
    return summary?.notebookId === notebookId ? summary : undefined
  },
  async getSummaries(notebookId) {
    requireNotebookId(notebookId)
    return tx<QuestionGroup[]>(
      'readonly',
      (store) => store.index('notebookId').getAll(notebookId),
      GROUP_SUMMARY_STORE,
    )
  },
  async cacheSummaries(notebookId, groups) {
    requireNotebookId(notebookId)
    if (groups.some((group) => group.notebookId !== notebookId)) throw new Error('Invalid notebook')
    await cacheSummaries(GROUP_SUMMARY_STORE, groups.map(groupSummary))
  },
  async getAll(notebookId) {
    requireNotebookId(notebookId)
    const groups = await tx<QuestionGroup[]>(
      'readonly',
      (store) => store.index('notebookId').getAll(notebookId),
      QUESTION_GROUP_STORE,
    )
    return groups
  },
  async get(notebookId, groupId) {
    requireNotebookId(notebookId)
    const group = await tx<QuestionGroup | undefined>(
      'readonly',
      (store) => store.get(groupId),
      QUESTION_GROUP_STORE,
    )
    return group?.notebookId === notebookId ? group : undefined
  },
  async put(notebookId, group) {
    assertLoaded(group)
    requireNotebookId(notebookId)
    if (group.notebookId !== notebookId) {
      throw new Error(`Question group ${group.id} belongs to another notebook`)
    }
    await writeWithSummary(QUESTION_GROUP_STORE, GROUP_SUMMARY_STORE, group, groupSummary(group))
  },
  async delete(notebookId, groupId) {
    const summaries = await indexedDbQuestionGroupRepository.getSummaries!(notebookId)
    if (!summaries.some((group) => group.id === groupId)) return
    await Promise.all([
      deleteKeys(QUESTION_GROUP_STORE, [groupId]),
      deleteKeys(GROUP_SUMMARY_STORE, [groupId]),
    ])
  },
}

export const indexedDbReviewLogRepository: ReviewLogRepository = {
  async getAll(notebookId) {
    const entries = await indexedDbEntryRepository.getSummaries!(notebookId)
    const entryIds = new Set(entries.map((entry) => entry.id))
    const logs = await tx<ReviewLog[]>('readonly', (store) => store.getAll(), REVIEW_LOG_STORE)
    return logs.filter((log) => entryIds.has(log.entryId))
  },
  async add(notebookId, log) {
    requireNotebookId(notebookId)
    const entry = await indexedDbEntryRepository.get(notebookId, log.entryId)
    if (!entry) throw new Error(`Entry ${log.entryId} does not belong to notebook ${notebookId}`)
    await tx('readwrite', (store) => store.put(log), REVIEW_LOG_STORE)
  },
  async deleteByEntry(notebookId, entryId) {
    requireNotebookId(notebookId)
    const entry = await indexedDbEntryRepository.get(notebookId, entryId)
    if (!entry) return
    const keys = await tx<IDBValidKey[]>(
      'readonly',
      (store) => store.index('entryId').getAllKeys(entryId),
      REVIEW_LOG_STORE,
    )
    await deleteKeys(REVIEW_LOG_STORE, keys)
  },
}

// The API adapters keep the local repositories as the source of immediate UI
// updates, then mirror supported data to the authenticated backend.
const localEntryRepository: EntryRepository = isElectron()
  ? electronEntryRepository
  : indexedDbEntryRepository
const localNotebookRepository: NotebookRepository = isElectron()
  ? electronNotebookRepository
  : indexedDbNotebookRepository
const localReviewLogRepository: ReviewLogRepository = isElectron()
  ? electronReviewLogRepository
  : indexedDbReviewLogRepository

export const entryRepository: EntryRepository = localMode
  ? localEntryRepository
  : smartEntryRepository(localEntryRepository)
export const notebookRepository: NotebookRepository = localMode
  ? localNotebookRepository
  : smartNotebookRepository(localNotebookRepository)
export const reviewLogRepository: ReviewLogRepository = localMode
  ? localReviewLogRepository
  : smartReviewLogRepository(localReviewLogRepository)

export async function getNotebookOverview(notebookIds: string[]): Promise<NotebookOverview> {
  if (!notebookIds.length) return aggregateNotebookOverview([], [], [])
  return fetchNotebookOverview(notebookIds, async (ids) => {
    if (isElectron()) {
      if (!window.electronAPI!.getNotebookOverview) throw new Error('请重启客户端以读取首页统计')
      return window.electronAPI!.getNotebookOverview(ids, true)
    }
    // Two reads for the entire dashboard, instead of scanning all logs per notebook.
    const [entries, logs] = await Promise.all([
      tx<NoteEntry[]>('readonly', (store) => store.getAll(), ENTRY_SUMMARY_STORE),
      tx<ReviewLog[]>('readonly', (store) => store.getAll(), REVIEW_LOG_STORE),
    ])
    const active = new Set(ids)
    const metadata = entries
      .filter((entry) => active.has(entry.notebookId))
      .map((entry) => ({
        id: entry.id,
        notebookId: entry.notebookId,
        subject: entry.subject,
        nextReviewDate: entry.nextReviewDate,
        updatedAt: entry.updatedAt,
      }))
    const entryIds = new Set(metadata.map((entry) => entry.id))
    const weekAgo = Date.now() - 8 * 86400000
    const reviews = logs
      .filter((log) => entryIds.has(log.entryId) && log.timestamp >= weekAgo)
      .map((log) => ({ id: log.id, entryId: log.entryId, timestamp: log.timestamp }))
    return {
      overview: aggregateNotebookOverview(ids, metadata, reviews),
      entries: metadata,
      reviews,
    }
  })
}

// 云端判卷已经原子写入；仅更新本地缓存，不能再次排入上传队列。
export async function cacheGradedReview(entry: NoteEntry, log: ReviewLog): Promise<void> {
  await localEntryRepository.put(entry.notebookId, JSON.parse(JSON.stringify(entry)))
  const logs = await localReviewLogRepository.getAll(entry.notebookId)
  if (!logs.some((existing) => existing.id === log.id))
    await localReviewLogRepository.add(entry.notebookId, JSON.parse(JSON.stringify(log)))
}
const localQuestionGroupRepository: QuestionGroupRepository = isElectron()
  ? electronQuestionGroupRepository
  : indexedDbQuestionGroupRepository
export const questionGroupRepository: QuestionGroupRepository = localMode
  ? localQuestionGroupRepository
  : smartQuestionGroupRepository(localQuestionGroupRepository)

// Compatibility facade for code outside the migrated core. New code should use the repositories above.
export const db = {
  getAll: entryRepository.getAll.bind(entryRepository),
  get: entryRepository.get.bind(entryRepository),
  put: entryRepository.put.bind(entryRepository),
  delete: entryRepository.delete.bind(entryRepository),
  putSnapshot: entryRepository.putSnapshot.bind(entryRepository),
  getSnapshot: entryRepository.getSnapshot.bind(entryRepository),
  getAllSnapshots: entryRepository.getAllSnapshots.bind(entryRepository),
  deleteSnapshot: entryRepository.deleteSnapshot.bind(entryRepository),
  deleteAllSnapshots: entryRepository.deleteAllSnapshots.bind(entryRepository),
  getAllReviewLogs: reviewLogRepository.getAll.bind(reviewLogRepository),
  addReviewLog: reviewLogRepository.add.bind(reviewLogRepository),
  deleteReviewLogsByEntry: reviewLogRepository.deleteByEntry.bind(reviewLogRepository),
  getAllNotebooks: notebookRepository.getAll.bind(notebookRepository),
  putNotebook: notebookRepository.put.bind(notebookRepository),
  deleteNotebook: notebookRepository.delete.bind(notebookRepository),
  getAllQuestionGroups: questionGroupRepository.getAll.bind(questionGroupRepository),
  getQuestionGroup: questionGroupRepository.get.bind(questionGroupRepository),
  putQuestionGroup: questionGroupRepository.put.bind(questionGroupRepository),
  deleteQuestionGroup: questionGroupRepository.delete.bind(questionGroupRepository),
}

async function getAllIndexedDbEntries(): Promise<NoteEntry[]> {
  return tx<NoteEntry[]>('readonly', (store) => store.getAll())
}

async function getAllIndexedDbSnapshots(): Promise<EntrySnapshot[]> {
  return tx<EntrySnapshot[]>('readonly', (store) => store.getAll(), SNAP_STORE)
}

async function getAllIndexedDbReviewLogs(): Promise<ReviewLog[]> {
  return tx<ReviewLog[]>('readonly', (store) => store.getAll(), REVIEW_LOG_STORE)
}

async function getAllIndexedDbQuestionGroups(): Promise<QuestionGroup[]> {
  return tx<QuestionGroup[]>('readonly', (store) => store.getAll(), QUESTION_GROUP_STORE)
}

export async function migrateFromIndexedDB(): Promise<number> {
  if (!isElectron()) return 0

  try {
    if (await window.electronAPI!.isIndexedDBMigrated()) return 0
  } catch {
    // Continue when older Electron builds do not expose the migration flag.
  }

  const existingNotebooks = await electronNotebookRepository.getAll()
  const existingEntries = (
    await Promise.all(
      existingNotebooks.map((notebook) => electronEntryRepository.getAll(notebook.id)),
    )
  ).flat()
  if (existingEntries.length > 0) {
    try {
      await window.electronAPI!.markIndexedDBMigrated()
    } catch {
      // The data is already present; the flag is only an optimization.
    }
    return 0
  }

  try {
    const [entries, notebooks, reviewLogs, snapshots, questionGroups] = await Promise.all([
      getAllIndexedDbEntries(),
      indexedDbNotebookRepository.getAll(),
      getAllIndexedDbReviewLogs(),
      getAllIndexedDbSnapshots(),
      getAllIndexedDbQuestionGroups(),
    ])

    if (
      entries.length === 0 &&
      notebooks.length === 0 &&
      reviewLogs.length === 0 &&
      snapshots.length === 0 &&
      questionGroups.length === 0
    ) {
      try {
        await window.electronAPI!.markIndexedDBMigrated()
      } catch {
        // Ignore an unavailable migration flag.
      }
      return 0
    }

    for (const notebook of notebooks) await electronNotebookRepository.put(notebook)
    for (const entry of entries) {
      if (entry.notebookId) await electronEntryRepository.put(entry.notebookId, entry)
    }
    for (const group of questionGroups) {
      if (group.notebookId) {
        await electronQuestionGroupRepository.put(group.notebookId, group)
      }
    }

    const notebookByEntry = new Map(entries.map((entry) => [entry.id, entry.notebookId]))
    for (const log of reviewLogs) {
      const notebookId = notebookByEntry.get(log.entryId)
      if (notebookId) await electronReviewLogRepository.add(notebookId, log)
    }
    for (const snapshot of snapshots) {
      const notebookId = snapshot.data?.notebookId
      if (notebookId) {
        await electronEntryRepository.putSnapshot(notebookId, snapshot.entryId, snapshot.data)
      }
    }

    try {
      await window.electronAPI!.markIndexedDBMigrated()
    } catch {
      // Migration succeeded even if the optimization flag could not be saved.
    }
    return entries.length
  } catch (error) {
    console.error('Migration from IndexedDB failed:', error)
    return 0
  }
}

// Preserve legacy offline edits only when the server confirms notebook ownership.
// The original database stays intact for recovery of any unsynced notebooks.
interface LegacyCacheRecord {
  id?: string
  entryId?: string
  notebookId?: string
  data?: NoteEntry
}

export async function migrateLegacyWebStorage(): Promise<void> {
  const marker = `${DB_NAME}:legacy-web-imported`
  if (localStorage.getItem(marker)) return

  const legacy = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME)
    let missing = false
    request.onupgradeneeded = () => {
      missing = true
      request.transaction!.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => (missing ? resolve(null) : reject(request.error))
  })
  if (!legacy) return

  try {
    const database = await openDB()
    try {
      for (const storeName of [NOTEBOOK_STORE, STORE, QUESTION_GROUP_STORE, SNAP_STORE, REVIEW_LOG_STORE]) {
        if (!legacy.objectStoreNames.contains(storeName)) continue
        const records = await new Promise<LegacyCacheRecord[]>((resolve, reject) => {
          const request = legacy.transaction(storeName).objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        if (!records.length) continue

        await new Promise<void>((resolve, reject) => {
          const summaryStore =
            storeName === STORE
              ? ENTRY_SUMMARY_STORE
              : storeName === QUESTION_GROUP_STORE
                ? GROUP_SUMMARY_STORE
                : undefined
          const transaction = database.transaction(
            summaryStore ? [storeName, summaryStore] : [storeName],
            'readwrite',
          )
          const store = transaction.objectStore(storeName)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
          for (const record of records) {
            const key = storeName === SNAP_STORE ? record.entryId : record.id
            if (!key) continue
            const existing = store.getKey(key)
            existing.onsuccess = () => {
              if (existing.result !== undefined) return
              store.add(record)
              if (storeName === STORE) {
                transaction.objectStore(ENTRY_SUMMARY_STORE).put(entrySummary(record as NoteEntry))
              } else if (storeName === QUESTION_GROUP_STORE) {
                transaction.objectStore(GROUP_SUMMARY_STORE).put(groupSummary(record as QuestionGroup))
              }
            }
          }
        })
      }
    } finally {
      database.close()
    }
    localStorage.setItem(marker, 'true')
  } finally {
    legacy.close()
  }
}

export async function prepareUserStorage(): Promise<void> {
  const token = getAccessToken()
  if (!token || !getStoredUser()) return
  if (isElectron()) await window.electronAPI!.setStorageUser(token)
  const marker = `${DB_NAME}:legacy-migrated`
  if (localStorage.getItem(marker)) return
  try {
    const response = await fetch('http://localhost:8000/api/notebooks', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return
    const data = (await response.json()) as { items: { id: string }[] }
    const ids = new Set(data.items.map((item) => item.id))
    const legacy = await openDB(LEGACY_DB_NAME)
    try {
      for (const storeName of [NOTEBOOK_STORE, STORE, QUESTION_GROUP_STORE, SNAP_STORE]) {
        const records = await new Promise<LegacyCacheRecord[]>((resolve, reject) => {
          const request = legacy.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        for (const record of records) {
          const notebookId =
            storeName === NOTEBOOK_STORE
              ? record.id
              : storeName === SNAP_STORE
                ? record.data?.notebookId
                : record.notebookId
          if (!notebookId || !ids.has(notebookId)) continue
          // A retry never replaces edits already saved in the account's cache.
          const key = storeName === SNAP_STORE ? record.entryId : record.id
          if (!key) continue
          const existing = await tx('readonly', (store) => store.get(key), storeName)
          if (!existing) {
            if (storeName === STORE)
              await indexedDbEntryRepository.put(notebookId, record as NoteEntry)
            else if (storeName === QUESTION_GROUP_STORE)
              await indexedDbQuestionGroupRepository.put(notebookId, record as QuestionGroup)
            else await tx('readwrite', (store) => store.put(record), storeName)
          }
        }
      }
      const entries = indexedDbEntryRepository.getAll.bind(indexedDbEntryRepository)
      const entryIds = new Set(
        (await Promise.all([...ids].map(entries))).flat().map((item) => item.id),
      )
      const logs = await new Promise<ReviewLog[]>((resolve, reject) => {
        const request = legacy
          .transaction(REVIEW_LOG_STORE, 'readonly')
          .objectStore(REVIEW_LOG_STORE)
          .getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      for (const log of logs) {
        if (!entryIds.has(log.entryId)) continue
        const existing = await tx('readonly', (store) => store.get(log.id), REVIEW_LOG_STORE)
        if (!existing) await tx('readwrite', (store) => store.put(log), REVIEW_LOG_STORE)
      }
      migrateLegacySyncQueue(ids)
      localStorage.setItem(marker, 'true')
    } finally {
      legacy.close()
    }
  } catch (error) {
    console.warn('旧缓存迁移暂未完成，将在下次登录时重试', error)
  }
}
