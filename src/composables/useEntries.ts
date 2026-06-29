import { ref, computed, onUnmounted } from 'vue'
import type { NoteEntry } from '@/types'
import { db } from '@/services/db'
import { useReviewSettings } from '@/composables/useReviewSettings'
import { useNotebooks } from '@/composables/useNotebooks'
import { useRagSync } from '@/composables/useRagSync'
import { useAiFeatures } from '@/composables/useAiFeatures'

const ragSync = useRagSync()
const { enabled: aiEnabled } = useAiFeatures()

// IndexedDB can't store Vue Proxy objects (structured clone error)
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function genId(): string {
  return 'cuoti_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function stripMd(s: string): string {
  return (s || '')
    .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
    .replace(/[#*`~>[\]|]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function isPlaceholderTitle(t: string): boolean {
  if (!t) return true
  if (/^无题目(\s*\(\d+\))?$/.test(t)) return true
  if (/^\d{2}-\d{1,2}-\d{1,2}-\d+$/.test(t)) return true
  return false
}

function nextPlaceholderTitle(entries: NoteEntry[]): string {
  const now = new Date()
  const y = String(now.getFullYear()).slice(-2)
  const m = now.getMonth() + 1
  const d = now.getDate()
  const prefix = `${y}-${m}-${d}`

  const re = new RegExp(`^${y}-${m}-${d}-(\\d+)$`)
  let max = 0
  entries.forEach((e) => {
    const match = e.title?.match(re)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  })
  return `${prefix}-${max + 1}`
}

// ===================================================================
// @AI-GUIDE: 条目 CRUD 与状态管理层
// 纯业务逻辑。禁止在此直接操作 DOM。条目创建/保存/删除/批量操作
// 均在此实现，Vue 组件通过调用本 Hook 的返回值来驱动视图。
// 返回值类型签名必须向后兼容 —— 只能追加, 不可删除或重命名字段。
// ===================================================================
export function useEntries() {
  const entries = ref<NoteEntry[]>([])
  const activeId = ref<string | null>(null)
  const answersHidden = ref(false)
  const toastMsg = ref('')
  const showDeleteModal = ref(false)
  const isDirty = ref(false)
  const { settings } = useReviewSettings()
  const { activeId: notebookId } = useNotebooks()

  const notebookEntries = computed(() => entries.value)

  const activeEntry = computed<NoteEntry | undefined>(() =>
    entries.value.find((e) => e.id === activeId.value),
  )

  // Batch selection
  const selectedIds = ref<Set<string>>(new Set())
  const lastSelectedIdx = ref<number>(-1)

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  function toggleSelect(id: string) {
    const s = selectedIds.value
    if (s.has(id)) {
      s.delete(id)
    } else {
      s.add(id)
    }
    selectedIds.value = new Set(s)
  }

  function selectRange(ids: string[], fromIdx: number, toIdx: number) {
    const s = new Set(selectedIds.value)
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    for (let i = start; i <= end; i++) {
      s.add(ids[i])
    }
    selectedIds.value = s
    lastSelectedIdx.value = toIdx
  }

  function selectAll(ids: string[]) {
    selectedIds.value = new Set(ids)
  }

  function deselectAll() {
    selectedIds.value = new Set()
    lastSelectedIdx.value = -1
  }

  const selectedCount = computed(() => selectedIds.value.size)

  // Batch delete
  async function batchDelete(ids: string[]) {
    for (const id of ids) {
      await db.delete(notebookId.value, id)
      await db.deleteSnapshot(notebookId.value, id)
    }
    const idSet = new Set(ids)
    entries.value = entries.value.filter((e) => !idSet.has(e.id))
    if (activeId.value && idSet.has(activeId.value)) {
      activeId.value = null
      isDirty.value = false
    }
    deselectAll()
  }

  // Batch tag
  async function batchTag(ids: string[], tags: string[]) {
    const now = Date.now()
    for (const id of ids) {
      const entry = entries.value.find((e) => e.id === id)
      if (entry) {
        const existing = new Set(entry.tags)
        for (const t of tags) existing.add(t)
        entry.tags = Array.from(existing)
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
    deselectAll()
  }

  // Rename subject across all entries
  async function renameSubjectInEntries(oldName: string, newName: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.subject === oldName) {
        entry.subject = newName
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Rename tag across all entries
  async function renameTagInEntries(oldName: string, newName: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.tags && entry.tags.includes(oldName)) {
        entry.tags = entry.tags.map((t) => (t === oldName ? newName : t))
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Rename source across all entries
  async function renameSourceInEntries(oldName: string, newName: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.source === oldName) {
        entry.source = newName
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Remove subject from all entries that use it
  async function removeSubjectFromEntries(name: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.subject === name) {
        entry.subject = ''
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Remove tag from all entries that use it
  async function removeTagFromEntries(name: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.tags && entry.tags.includes(name)) {
        entry.tags = entry.tags.filter((t) => t !== name)
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Remove source from all entries that use it
  async function removeSourceFromEntries(name: string) {
    const now = Date.now()
    for (const entry of entries.value) {
      if (entry.source === name) {
        entry.source = ''
        entry.updatedAt = now
        await db.put(toPlain(entry))
      }
    }
  }

  // Batch export
  function batchExport(ids: string[]) {
    const selected = entries.value.filter((e) => ids.includes(e.id))
    const json = JSON.stringify(selected, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `错题本_${new Date().toISOString().slice(0, 10)}.json`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`已导出 ${ids.length} 条错题`)
    deselectAll()
  }

  // Periodic crash-protection snapshot (every 1s while dirty)
  let snapshotTimer: ReturnType<typeof setInterval> | null = null

  function startSnapshotTimer() {
    if (snapshotTimer) return
    snapshotTimer = setInterval(() => {
      if (isDirty.value && activeId.value) {
        const entry = entries.value.find((e) => e.id === activeId.value)
        if (entry) db.putSnapshot(notebookId.value, activeId.value, toPlain(entry))
      }
    }, 1000)
  }

  onUnmounted(() => {
    if (snapshotTimer) clearInterval(snapshotTimer)
  })

  let loadSeq = 0

  async function loadEntries() {
    const seq = ++loadSeq
    try {
      const result = await db.getAll(notebookId.value)
      if (seq === loadSeq) {
        entries.value = result
      }
    } catch {
      if (seq === loadSeq && entries.value.length === 0) {
        entries.value = []
      }
    }
  }

  async function checkCrashRecovery(): Promise<NoteEntry[]> {
    try {
      const snaps = await db.getAllSnapshots(notebookId.value)
      if (snaps.length === 0) return []
      const recovered: NoteEntry[] = []
      for (const snap of snaps) {
        const existing = entries.value.find((e) => e.id === snap.entryId)
        if (existing) {
          // Restore snapshot data into existing entry
          Object.assign(existing, snap.data, { updatedAt: snap.data.updatedAt })
          await db.put(toPlain(existing))
        } else {
          // Entry was never saved — restore it
          entries.value.push(snap.data)
          await db.put(toPlain(snap.data))
          recovered.push(snap.data)
        }
      }
      await db.deleteAllSnapshots(notebookId.value)
      return recovered
    } catch {
      return []
    }
  }

  async function createEntry(preselectSubject?: string) {
    if (!notebookId.value) return
    const entry: NoteEntry = {
      id: genId(),
      notebookId: notebookId.value,
      title: nextPlaceholderTitle(entries.value),
      question: '',
      wrongAnswer: '',
      correctAnswer: '',
      subject: preselectSubject || '',
      source: '',
      tags: [],
      masteryLevel: 0,
      consecutivePasses: 0,
      nextReviewDate: Date.now() + settings.value.firstReviewDays * 86400000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.put(toPlain(entry))
    entries.value.unshift(entry)
    activeId.value = entry.id
    answersHidden.value = false
    isDirty.value = false
    startSnapshotTimer()
    showToast('新错题已创建')
  }

  async function createEntryFromDocument(documentBase64: string, preselectSubject?: string) {
    if (!notebookId.value) return
    const entry: NoteEntry = {
      id: genId(),
      notebookId: notebookId.value,
      title: '文档扫描 ' + new Date().toLocaleTimeString(),
      question: '',
      wrongAnswer: '',
      correctAnswer: '',
      subject: preselectSubject || '',
      source: '文档扫描',
      tags: [],
      masteryLevel: 0,
      consecutivePasses: 0,
      nextReviewDate: Date.now() + settings.value.firstReviewDays * 86400000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      drawing: documentBase64,
    }
    await db.put(toPlain(entry))
    entries.value.unshift(entry)
    activeId.value = entry.id
    answersHidden.value = false
    isDirty.value = false
    startSnapshotTimer()
    showToast('文档扫描已保存')
  }

  function loadEntry(id: string) {
    activeId.value = id
  }

  // Call this on every content mutation — marks dirty, does NOT save to DB
  function markDirty() {
    isDirty.value = true
    startSnapshotTimer()
  }

  // Manual save — persists to DB, clears dirty flag, removes snapshot
  async function saveEntry() {
    if (!activeId.value) return
    const entry = entries.value.find((e) => e.id === activeId.value)
    if (!entry) return

    entry.updatedAt = Date.now()
    try {
      await db.put(toPlain(entry))
    } catch (err) {
      console.error('Save failed', err)
      return
    }
    try {
      await db.deleteSnapshot(notebookId.value, activeId.value)
    } catch {
      /* ok if missing */
    }
    if (aiEnabled.value) {
      void ragSync.upsertEntry(toPlain(entry))
    }
    isDirty.value = false
    showToast('已保存')
  }

  // Discard changes — reload from DB
  async function discardChanges() {
    if (!activeId.value) return
    const saved = await db.get(notebookId.value, activeId.value)
    if (saved) {
      const idx = entries.value.findIndex((e) => e.id === activeId.value)
      if (idx !== -1) entries.value[idx] = saved
    }
    await db.deleteSnapshot(notebookId.value, activeId.value)
    isDirty.value = false
  }

  // Snapshot save (for crash protection, called periodically)
  async function snapshotSave() {
    if (!activeId.value || !isDirty.value) return
    const entry = entries.value.find((e) => e.id === activeId.value)
    if (entry) {
      entry.updatedAt = Date.now()
      try {
        await db.putSnapshot(notebookId.value, activeId.value, toPlain(entry))
      } catch {
        /* ignore */
      }
    }
  }

  async function deleteCurrent() {
    if (!activeId.value) return
    const deletedId = activeId.value
    await db.delete(notebookId.value, activeId.value)
    await db.deleteSnapshot(notebookId.value, activeId.value)
    entries.value = entries.value.filter((e) => e.id !== activeId.value)
    activeId.value = null
    isDirty.value = false
    showDeleteModal.value = false
    if (aiEnabled.value) {
      void ragSync.deleteEntry(deletedId)
    }
    showToast('错题已删除')
  }

  async function updateEntryTitle(id: string, newTitle: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (!entry || !newTitle) return
    entry.title = newTitle
    entry.updatedAt = Date.now()
    try {
      await db.put(toPlain(entry))
      if (aiEnabled.value) {
        void ragSync.upsertEntry(toPlain(entry))
      }
      showToast('已重命名')
    } catch (err) {
      console.error('Rename failed', err)
      showToast('重命名失败')
    }
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    toastMsg.value = msg
    toastTimer = setTimeout(() => {
      toastMsg.value = ''
      toastTimer = null
    }, 500)
  }

  function openDeleteModal() {
    showDeleteModal.value = true
  }

  function closeDeleteModal() {
    showDeleteModal.value = false
  }

  async function reorderEntries(orderedIds: string[]) {
    const now = Date.now()
    const updates: Promise<void>[] = []
    orderedIds.forEach((id, idx) => {
      const entry = entries.value.find((e) => e.id === id)
      if (entry) {
        entry.sortOrder = idx
        entry.updatedAt = now
        updates.push(db.put(toPlain(entry)))
      }
    })
    await Promise.all(updates)
    // Trigger Vue reactivity — entries are plain objects from IndexedDB,
    // so in-place property mutations don't cause computed re-evaluation.
    entries.value = [...entries.value]
  }

  return {
    entries,
    notebookEntries,
    activeId,
    activeEntry,
    answersHidden,
    isDirty,
    toastMsg,
    showDeleteModal,
    selectedIds,
    selectedCount,
    loadEntries,
    checkCrashRecovery,
    createEntry,
    createEntryFromDocument,
    loadEntry,
    markDirty,
    saveEntry,
    discardChanges,
    snapshotSave,
    deleteCurrent,
    updateEntryTitle,
    showToast,
    openDeleteModal,
    closeDeleteModal,
    reorderEntries,
    // batch
    isSelected,
    toggleSelect,
    selectRange,
    selectAll,
    deselectAll,
    batchDelete,
    batchTag,
    batchExport,
    // entity rename/delete
    renameSubjectInEntries,
    renameTagInEntries,
    renameSourceInEntries,
    removeSubjectFromEntries,
    removeTagFromEntries,
    removeSourceFromEntries,
    // utility exports for components
    stripMd,
    isPlaceholderTitle,
  }
}
