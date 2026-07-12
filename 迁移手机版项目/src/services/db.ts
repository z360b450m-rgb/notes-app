// ===================================================================
// @AI-CRITICAL-RULES: 核心数据库访问层
//
// 本文件实现了系统的持久化数据访问逻辑，是唯一允许直接操作存储的模块。
// 采用双后端架构：Electron 文件存储（主） + IndexedDB（浏览器后备）。
//
// ■ 绝对禁止的操作：
//   1. 修改 STORE / SNAP_STORE / REVIEW_LOG_STORE / NOTEBOOK_STORE 的
//      名称或结构 —— 这等同于数据库迁移，会导致已有数据不可访问。
//   2. 修改 DB_VERSION —— 除非你明确知道如何编写 onupgradeneeded 迁移
//      逻辑，且同步更新 Electron 端文件格式。
//   3. 在 IndexedDB 的 onupgradeneeded 中删除或修改已有 Object Store
//      的 schema —— 只能通过新建 Store 或追加索引来扩展。
//   4. 绕过 db 统一导出直接调用 fileDb 或 idbDb —— 所有数据操作必须
//      通过 db 对象进行。
//
// ■ 允许的扩展方式：
//   1. 新增 Object Store：在 DB_VERSION 递增后，于 onupgradeneeded 中
//      添加 createObjectStore；同步在 Electron main.cjs 文件存储中
//      添加对应的 JSON 键和 CRUD 操作。
//   2. 为已有 Store 追加新索引（不影响现有数据）。
//   3. 追加新的数据访问函数（如 getByIndex），不可改变现有函数签名。
//
// ■ 修改前必读文件：
//   - src/types/index.ts（数据接口定义 —— 两者必须保持同步）
//   - electron/main.cjs（Electron 端文件存储实现 & IPC 处理程序）
//   - electron/preload.cjs（暴露给渲染进程的 API 桥接）
//
// VIOLATION OF THESE RULES WILL CAUSE DATA CORRUPTION.
// ===================================================================

import type { NoteEntry, ReviewLog, Notebook } from '@/types'

const STORE = 'entries'
const SNAP_STORE = 'snapshots'
const REVIEW_LOG_STORE = 'reviewLogs'
const NOTEBOOK_STORE = 'notebooks'

// ── Electron file-based storage (primary) ──────────────────────

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

// Current notebook context for per-notebook sharding
let _notebookId = ''

export function setCurrentNotebookId(id: string) {
  _notebookId = id
}

const fileDb = {
  async getAll(notebookId: string): Promise<NoteEntry[]> {
    // null → aggregate all notebooks; empty/falsy → fall back to current notebook
    if (notebookId == null) {
      const notebooks = await window.electronAPI!.getAllNotebooks()
      const allEntries: NoteEntry[] = []
      for (const nb of notebooks) {
        try {
          const entries = await window.electronAPI!.getAll(nb.id)
          allEntries.push(...entries)
        } catch {
          /* skip corrupted notebook */
        }
      }
      return allEntries
    }
    return window.electronAPI!.getAll(notebookId || _notebookId)
  },

  async get(notebookId: string, id: string): Promise<NoteEntry | undefined> {
    const entry = await window.electronAPI!.get(notebookId || _notebookId, id)
    return entry ?? undefined
  },

  async put(entry: NoteEntry): Promise<void> {
    await window.electronAPI!.put(entry)
  },

  async delete(notebookId: string, id: string): Promise<void> {
    await window.electronAPI!.delete(notebookId || _notebookId, id)
  },

  async putSnapshot(notebookId: string, entryId: string, data: NoteEntry): Promise<void> {
    await window.electronAPI!.putSnapshot(notebookId || _notebookId, {
      entryId,
      data,
      savedAt: Date.now(),
    })
  },

  async getSnapshot(
    notebookId: string,
    entryId: string,
  ): Promise<{ entryId: string; data: NoteEntry; savedAt: number } | undefined> {
    const snap = await window.electronAPI!.getSnapshot(notebookId || _notebookId, entryId)
    return snap ?? undefined
  },

  async getAllSnapshots(
    notebookId: string,
  ): Promise<{ entryId: string; data: NoteEntry; savedAt: number }[]> {
    return window.electronAPI!.getAllSnapshots(notebookId || _notebookId)
  },

  async deleteSnapshot(notebookId: string, entryId: string): Promise<void> {
    await window.electronAPI!.deleteSnapshot(notebookId || _notebookId, entryId)
  },

  async deleteAllSnapshots(notebookId: string): Promise<void> {
    await window.electronAPI!.deleteAllSnapshots(notebookId || _notebookId)
  },

  async getAllReviewLogs(notebookId: string): Promise<ReviewLog[]> {
    return window.electronAPI!.getAllReviewLogs(notebookId || _notebookId)
  },

  async addReviewLog(notebookId: string, log: ReviewLog): Promise<void> {
    await window.electronAPI!.addReviewLog(notebookId || _notebookId, log)
  },

  async deleteReviewLogsByEntry(notebookId: string, entryId: string): Promise<void> {
    await window.electronAPI!.deleteReviewLogsByEntry(notebookId || _notebookId, entryId)
  },

  async getAllNotebooks(): Promise<Notebook[]> {
    return window.electronAPI!.getAllNotebooks()
  },

  async putNotebook(notebook: Notebook): Promise<void> {
    await window.electronAPI!.putNotebook(notebook)
  },

  async deleteNotebook(id: string): Promise<void> {
    await window.electronAPI!.deleteNotebook(id)
  },
}

// ── IndexedDB fallback (browser dev mode) ───────────────────────

const DB_NAME = 'CuotiDB'
const DB_VERSION = 5

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
        store.createIndex('subject', 'subject', { unique: false })
      }
      if (!db.objectStoreNames.contains(SNAP_STORE)) {
        db.createObjectStore(SNAP_STORE, { keyPath: 'entryId' })
      }
      if (!db.objectStoreNames.contains(REVIEW_LOG_STORE)) {
        const rlStore = db.createObjectStore(REVIEW_LOG_STORE, { keyPath: 'id' })
        rlStore.createIndex('entryId', 'entryId', { unique: false })
      }
      if (!db.objectStoreNames.contains(NOTEBOOK_STORE)) {
        db.createObjectStore(NOTEBOOK_STORE, { keyPath: 'id' })
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
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode)
        const store = t.objectStore(storeName)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

const idbDb = {
  async getAll(notebookId: string): Promise<NoteEntry[]> {
    const all = await tx('readonly', (s) => s.getAll())
    return notebookId ? all.filter((e: NoteEntry) => e.notebookId === notebookId) : all
  },

  async get(_notebookId: string, id: string): Promise<NoteEntry | undefined> {
    return tx('readonly', (s) => s.get(id))
  },

  async put(entry: NoteEntry): Promise<void> {
    return tx('readwrite', (s) => s.put(entry)).then(() => undefined)
  },

  async delete(_notebookId: string, id: string): Promise<void> {
    return tx('readwrite', (s) => s.delete(id)).then(() => undefined)
  },

  async putSnapshot(_notebookId: string, entryId: string, data: NoteEntry): Promise<void> {
    return tx('readwrite', (s) => s.put({ entryId, data, savedAt: Date.now() }), SNAP_STORE).then(
      () => undefined,
    )
  },

  async getSnapshot(
    _notebookId: string,
    entryId: string,
  ): Promise<{ entryId: string; data: NoteEntry; savedAt: number } | undefined> {
    return tx('readonly', (s) => s.get(entryId), SNAP_STORE)
  },

  async getAllSnapshots(
    notebookId: string,
  ): Promise<{ entryId: string; data: NoteEntry; savedAt: number }[]> {
    const all = await tx('readonly', (s) => s.getAll(), SNAP_STORE)
    return notebookId ? all.filter((snap) => snap.data && snap.data.notebookId === notebookId) : all
  },

  async deleteSnapshot(_notebookId: string, entryId: string): Promise<void> {
    return tx('readwrite', (s) => s.delete(entryId), SNAP_STORE).then(() => undefined)
  },

  async deleteAllSnapshots(_notebookId: string): Promise<void> {
    return tx('readwrite', (s) => s.clear(), SNAP_STORE).then(() => undefined)
  },

  async getAllReviewLogs(_notebookId: string): Promise<ReviewLog[]> {
    return tx('readonly', (s) => s.getAll(), REVIEW_LOG_STORE)
  },

  async addReviewLog(_notebookId: string, log: ReviewLog): Promise<void> {
    return tx('readwrite', (s) => s.put(log), REVIEW_LOG_STORE).then(() => undefined)
  },

  async deleteReviewLogsByEntry(_notebookId: string, entryId: string): Promise<void> {
    return openDB().then((db) => {
      return new Promise<void>((resolve, reject) => {
        // 1. 开启单个读写事务
        const t = db.transaction(REVIEW_LOG_STORE, 'readwrite')
        const store = t.objectStore(REVIEW_LOG_STORE)
        const idx = store.index('entryId')

        // 2. 查询该 entryId 下所有的 key
        const req = idx.getAllKeys(entryId)

        req.onsuccess = () => {
          const keys = req.result as string[]
          // 3. 在同一个事务生命周期内，遍历并下发所有的删除指令
          keys.forEach((key) => {
            store.delete(key)
          })
        }

        req.onerror = () => reject(req.error)

        // 4. 监听整个事务的完成与失败状态
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      })
    })
  },

  getAllNotebooks(): Promise<Notebook[]> {
    return tx('readonly', (s) => s.getAll(), NOTEBOOK_STORE)
  },

  putNotebook(notebook: Notebook): Promise<void> {
    return tx('readwrite', (s) => s.put(notebook), NOTEBOOK_STORE).then(() => undefined)
  },

  deleteNotebook(id: string): Promise<void> {
    return tx('readwrite', (s) => s.delete(id), NOTEBOOK_STORE).then(() => undefined)
  },
}

// ── Unified export ─────────────────────────────────────────────

export const db = isElectron() ? fileDb : idbDb

// ── Migration: IndexedDB → file storage ─────────────────────────

// ── Migration: IndexedDB → file storage ─────────────────────────

export async function migrateFromIndexedDB(): Promise<number> {
  if (!isElectron()) return 0

  // If migration was already done, skip entirely — no IDB open needed
  try {
    const alreadyMigrated = await window.electronAPI!.isIndexedDBMigrated()
    if (alreadyMigrated) return 0
  } catch {
    /* proceed */
  }

  const existing = await fileDb.getAll()
  if (existing.length > 0) {
    // Already has file data — mark migrated so future starts skip IDB
    try {
      await window.electronAPI!.markIndexedDBMigrated()
    } catch {
      /* ignore */
    }
    return 0
  }

  try {
    // 1. 从 IndexedDB 提取所有维度的数据
    const idbEntries = await idbDb.getAll()
    const idbNotebooks = await idbDb.getAllNotebooks()
    const idbReviewLogs = await idbDb.getAllReviewLogs()
    const idbSnapshots = await idbDb.getAllSnapshots()

    // 2. 如果所有表都是空的，说明完全没有历史数据，直接标记迁移完成
    if (
      idbEntries.length === 0 &&
      idbNotebooks.length === 0 &&
      idbReviewLogs.length === 0 &&
      idbSnapshots.length === 0
    ) {
      try {
        await window.electronAPI!.markIndexedDBMigrated()
      } catch {
        /* ignore */
      }
      return 0
    }

    // 3. 逐个模块进行数据迁移写入 Electron 文件存储

    // 迁移错题本 (Notebooks)
    for (const notebook of idbNotebooks) {
      await fileDb.putNotebook(notebook)
    }

    // 迁移错题主数据 (Entries)
    for (const entry of idbEntries) {
      await fileDb.put(entry)
    }

    // 迁移复习历史日志 (Review Logs)
    for (const log of idbReviewLogs) {
      await fileDb.addReviewLog(log)
    }

    // 迁移历史快照 (Snapshots)
    // 注意：fileDb.putSnapshot 的签名是 (entryId: string, data: NoteEntry)
    for (const snap of idbSnapshots) {
      await fileDb.putSnapshot(snap.entryId, snap.data)
    }

    // 4. 标记迁移成功
    try {
      await window.electronAPI!.markIndexedDBMigrated()
    } catch {
      /* ignore */
    }

    // 返回迁移的核心条目数
    return idbEntries.length
  } catch (error) {
    console.error('Migration from IndexedDB failed:', error)
    return 0
  }
}
