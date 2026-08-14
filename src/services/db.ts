// Persistent storage adapters. Keep the IndexedDB schema and Electron file format unchanged.
import type { NoteEntry, ReviewLog, Notebook, QuestionGroup } from '@/types'
import type {
  EntryRepository,
  EntrySnapshot,
  NotebookRepository,
  QuestionGroupRepository,
  ReviewLogRepository,
} from '@/services/repositories'

const STORE = 'entries'
const SNAP_STORE = 'snapshots'
const REVIEW_LOG_STORE = 'reviewLogs'
const NOTEBOOK_STORE = 'notebooks'
const QUESTION_GROUP_STORE = 'questionGroups'

const DB_NAME = 'CuotiDB'
const DB_VERSION = 6

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

function requireNotebookId(notebookId: string): string {
  if (!notebookId) throw new Error('notebookId is required')
  return notebookId
}

function assertEntryNotebook(notebookId: string, entry: NoteEntry): void {
  requireNotebookId(notebookId)
  if (entry.notebookId !== notebookId) {
    throw new Error(`Entry ${entry.id} belongs to notebook ${entry.notebookId}, not ${notebookId}`)
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
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
    }
    req.onsuccess = () => resolve(req.result)
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
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
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
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

export const electronEntryRepository: EntryRepository = {
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
  getAll(notebookId) {
    return window.electronAPI!.getAllQuestionGroups(requireNotebookId(notebookId))
  },
  async get(notebookId, groupId) {
    const group = await window.electronAPI!.getQuestionGroup(requireNotebookId(notebookId), groupId)
    return group ?? undefined
  },
  async put(notebookId, group) {
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
  async getAll(notebookId) {
    requireNotebookId(notebookId)
    const all = await tx<NoteEntry[]>('readonly', (store) => store.getAll())
    return all.filter((entry) => entry.notebookId === notebookId)
  },
  async get(notebookId, entryId) {
    requireNotebookId(notebookId)
    const entry = await tx<NoteEntry | undefined>('readonly', (store) => store.get(entryId))
    return entry?.notebookId === notebookId ? entry : undefined
  },
  async put(notebookId, entry) {
    assertEntryNotebook(notebookId, entry)
    await tx('readwrite', (store) => store.put(entry))
  },
  async delete(notebookId, entryId) {
    const entry = await indexedDbEntryRepository.get(notebookId, entryId)
    if (entry) await tx('readwrite', (store) => store.delete(entryId))
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
    const entries = await indexedDbEntryRepository.getAll(notebookId)
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
        QUESTION_GROUP_STORE,
        questionGroups.map((group) => group.id),
      ),
    ])
    await tx('readwrite', (store) => store.delete(notebookId), NOTEBOOK_STORE)
  },
}

export const indexedDbQuestionGroupRepository: QuestionGroupRepository = {
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
    requireNotebookId(notebookId)
    if (group.notebookId !== notebookId) {
      throw new Error(`Question group ${group.id} belongs to another notebook`)
    }
    await tx('readwrite', (store) => store.put(group), QUESTION_GROUP_STORE)
  },
  async delete(notebookId, groupId) {
    const group = await indexedDbQuestionGroupRepository.get(notebookId, groupId)
    if (group) await tx('readwrite', (store) => store.delete(groupId), QUESTION_GROUP_STORE)
  },
}

export const indexedDbReviewLogRepository: ReviewLogRepository = {
  async getAll(notebookId) {
    const entries = await indexedDbEntryRepository.getAll(notebookId)
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

export const entryRepository: EntryRepository = isElectron()
  ? electronEntryRepository
  : indexedDbEntryRepository
export const notebookRepository: NotebookRepository = isElectron()
  ? electronNotebookRepository
  : indexedDbNotebookRepository
export const reviewLogRepository: ReviewLogRepository = isElectron()
  ? electronReviewLogRepository
  : indexedDbReviewLogRepository
export const questionGroupRepository: QuestionGroupRepository = isElectron()
  ? electronQuestionGroupRepository
  : indexedDbQuestionGroupRepository

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
