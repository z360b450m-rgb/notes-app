import { ref, computed, onUnmounted } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import { entryRepository, questionGroupRepository } from '@/services/db'
import { useReviewSettings } from '@/composables/useReviewSettings'
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

function genGroupId(): string {
  return 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
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
export function useEntries(getNotebookId: () => string) {
  const entries = ref<NoteEntry[]>([])
  const questionGroups = ref<QuestionGroup[]>([])
  const activeId = ref<string | null>(null)
  const answersHidden = ref(false)
  const toastMsg = ref('')
  const showDeleteModal = ref(false)
  const isDirty = ref(false)
  const { settings } = useReviewSettings()
  const notebookId = computed(getNotebookId)

  const notebookEntries = computed(() => entries.value)

  const activeEntry = computed<NoteEntry | undefined>(() =>
    entries.value.find((e) => e.id === activeId.value),
  )

  const activeGroup = computed<QuestionGroup | undefined>(() => {
    const groupId = activeEntry.value?.groupId
    return groupId ? questionGroups.value.find((group) => group.id === groupId) : undefined
  })

  const activeGroupEntries = computed<NoteEntry[]>(() => {
    const groupId = activeEntry.value?.groupId
    if (!groupId) return activeEntry.value ? [activeEntry.value] : []
    return entries.value
      .filter((entry) => entry.groupId === groupId)
      .sort((a, b) => (a.subQuestionOrder ?? 0) - (b.subQuestionOrder ?? 0))
  })

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
    const affectedGroupIds = new Set(
      entries.value
        .filter((entry) => ids.includes(entry.id) && entry.groupId)
        .map((entry) => entry.groupId!),
    )
    for (const id of ids) {
      await entryRepository.delete(notebookId.value, id)
      await entryRepository.deleteSnapshot(notebookId.value, id)
    }
    const idSet = new Set(ids)
    entries.value = entries.value.filter((e) => !idSet.has(e.id))
    for (const groupId of affectedGroupIds) {
      const remaining = entries.value
        .filter((entry) => entry.groupId === groupId)
        .sort((a, b) => (a.subQuestionOrder ?? 0) - (b.subQuestionOrder ?? 0))
      if (remaining.length === 0) {
        await questionGroupRepository.delete(notebookId.value, groupId)
        questionGroups.value = questionGroups.value.filter((group) => group.id !== groupId)
      } else {
        await Promise.all(
          remaining.map((entry, index) => {
            entry.subQuestionOrder = index
            return entryRepository.put(entry.notebookId, toPlain(entry))
          }),
        )
      }
    }
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
        await entryRepository.put(entry.notebookId, toPlain(entry))
      }
    }
    deselectAll()
  }

  // Rename subject across all entries
  async function renameSubjectInEntries(oldName: string, newName: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.subject === oldName)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) =>
        entryRepository.put(e.notebookId, toPlain({ ...e, subject: newName, updatedAt: now })),
      ),
    )
    for (const e of targets) {
      e.subject = newName
      e.updatedAt = now
    }
  }

  // Rename tag across all entries
  async function renameTagInEntries(oldName: string, newName: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.tags && e.tags.includes(oldName))
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) => {
        const newTags = e.tags.map((t) => (t === oldName ? newName : t))
        return entryRepository.put(e.notebookId, toPlain({ ...e, tags: newTags, updatedAt: now }))
      }),
    )
    for (const e of targets) {
      e.tags = e.tags.map((t) => (t === oldName ? newName : t))
      e.updatedAt = now
    }
  }

  // Rename source across all entries
  async function renameSourceInEntries(oldName: string, newName: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.source === oldName)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) =>
        entryRepository.put(e.notebookId, toPlain({ ...e, source: newName, updatedAt: now })),
      ),
    )
    for (const e of targets) {
      e.source = newName
      e.updatedAt = now
    }
  }

  // Remove subject from all entries that use it
  async function removeSubjectFromEntries(name: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.subject === name)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) =>
        entryRepository.put(e.notebookId, toPlain({ ...e, subject: '', updatedAt: now })),
      ),
    )
    for (const e of targets) {
      e.subject = ''
      e.updatedAt = now
    }
  }

  // Remove tag from all entries that use it
  async function removeTagFromEntries(name: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.tags && e.tags.includes(name))
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) => {
        const newTags = e.tags.filter((t) => t !== name)
        return entryRepository.put(e.notebookId, toPlain({ ...e, tags: newTags, updatedAt: now }))
      }),
    )
    for (const e of targets) {
      e.tags = e.tags.filter((t) => t !== name)
      e.updatedAt = now
    }
  }

  // Remove source from all entries that use it
  async function removeSourceFromEntries(name: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.source === name)
    if (targets.length === 0) return
    await Promise.all(
      targets.map((e) =>
        entryRepository.put(e.notebookId, toPlain({ ...e, source: '', updatedAt: now })),
      ),
    )
    for (const e of targets) {
      e.source = ''
      e.updatedAt = now
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
        if (entry && notebookId.value) {
          void entryRepository.putSnapshot(notebookId.value, activeId.value, toPlain(entry))
          const group = activeGroup.value
          if (group) {
            group.updatedAt = Date.now()
            void questionGroupRepository.put(notebookId.value, toPlain(group))
          }
        }
      }
    }, 1000)
  }

  onUnmounted(() => {
    if (snapshotTimer) clearInterval(snapshotTimer)
  })

  let loadSeq = 0

  async function loadEntries() {
    const seq = ++loadSeq
    if (!notebookId.value) {
      entries.value = []
      questionGroups.value = []
      return
    }
    try {
      const [result, groups] = await Promise.all([
        entryRepository.getAll(notebookId.value),
        questionGroupRepository.getAll(notebookId.value),
      ])
      if (seq === loadSeq) {
        entries.value = result
        questionGroups.value = groups
      }
    } catch {
      if (seq === loadSeq && entries.value.length === 0) {
        entries.value = []
      }
    }
  }

  async function checkCrashRecovery(): Promise<NoteEntry[]> {
    if (!notebookId.value) return []
    try {
      const snaps = await entryRepository.getAllSnapshots(notebookId.value)
      if (snaps.length === 0) return []
      const recovered: NoteEntry[] = []
      for (const snap of snaps) {
        const existing = entries.value.find((e) => e.id === snap.entryId)
        if (existing) {
          // Restore snapshot data into existing entry
          Object.assign(existing, snap.data, { updatedAt: snap.data.updatedAt })
          await entryRepository.put(notebookId.value, toPlain(existing))
        } else {
          // Entry was never saved — restore it
          entries.value.push(snap.data)
          await entryRepository.put(notebookId.value, toPlain(snap.data))
          recovered.push(snap.data)
        }
      }
      await entryRepository.deleteAllSnapshots(notebookId.value)
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
    await entryRepository.put(notebookId.value, toPlain(entry))
    entries.value.unshift(entry)
    activeId.value = entry.id
    answersHidden.value = false
    isDirty.value = false
    startSnapshotTimer()
    showToast('新错题已创建')
  }

  async function enableQuestionGroup() {
    const entry = activeEntry.value
    if (!entry || entry.groupId || !notebookId.value) return
    const now = Date.now()
    const group: QuestionGroup = {
      id: genGroupId(),
      notebookId: notebookId.value,
      title: entry.title,
      material: '',
      createdAt: now,
      updatedAt: now,
    }
    entry.groupId = group.id
    entry.subQuestionOrder = 0
    entry.updatedAt = now
    await Promise.all([
      questionGroupRepository.put(notebookId.value, toPlain(group)),
      entryRepository.put(notebookId.value, toPlain(entry)),
    ])
    questionGroups.value.unshift(group)
    isDirty.value = false
    showToast('已转换为一拖 N 题组')
  }

  async function addSubQuestion() {
    const current = activeEntry.value
    const group = activeGroup.value
    if (!current || !group || !notebookId.value) return
    const siblings = activeGroupEntries.value
    const now = Date.now()
    const entry: NoteEntry = {
      id: genId(),
      notebookId: notebookId.value,
      title: `${group.title} · ${siblings.length + 1}`,
      question: '',
      wrongAnswer: '',
      correctAnswer: '',
      subject: current.subject,
      source: current.source,
      tags: [...current.tags],
      groupId: group.id,
      subQuestionOrder:
        siblings.reduce((max, entry) => Math.max(max, entry.subQuestionOrder ?? -1), -1) + 1,
      masteryLevel: 0,
      consecutivePasses: 0,
      nextReviewDate: now + settings.value.firstReviewDays * 86400000,
      createdAt: now,
      updatedAt: now,
    }
    group.updatedAt = now
    await Promise.all([
      entryRepository.put(notebookId.value, toPlain(entry)),
      questionGroupRepository.put(notebookId.value, toPlain(group)),
    ])
    entries.value.push(entry)
    activeId.value = entry.id
    answersHidden.value = false
    isDirty.value = false
    showToast(`已添加第 ${siblings.length + 1} 小题`)
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
      drawings: { question: documentBase64 },
    }
    await entryRepository.put(notebookId.value, toPlain(entry))
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
      const group = activeGroup.value
      if (group) group.updatedAt = entry.updatedAt
      await Promise.all([
        entryRepository.put(entry.notebookId, toPlain(entry)),
        ...(group ? [questionGroupRepository.put(group.notebookId, toPlain(group))] : []),
      ])
    } catch (err) {
      console.error('Save failed', err)
      return
    }
    try {
      await entryRepository.deleteSnapshot(notebookId.value, activeId.value)
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
    if (!notebookId.value) return
    const saved = await entryRepository.get(notebookId.value, activeId.value)
    if (saved) {
      const idx = entries.value.findIndex((e) => e.id === activeId.value)
      if (idx !== -1) entries.value[idx] = saved
    }
    const groupId = saved?.groupId
    if (groupId) {
      const savedGroup = await questionGroupRepository.get(notebookId.value, groupId)
      const groupIndex = questionGroups.value.findIndex((group) => group.id === groupId)
      if (savedGroup && groupIndex !== -1) questionGroups.value[groupIndex] = savedGroup
    }
    await entryRepository.deleteSnapshot(notebookId.value, activeId.value)
    isDirty.value = false
  }

  // Snapshot save (for crash protection, called periodically)
  async function snapshotSave() {
    if (!activeId.value || !isDirty.value) return
    const entry = entries.value.find((e) => e.id === activeId.value)
    if (entry) {
      entry.updatedAt = Date.now()
      try {
        const group = activeGroup.value
        if (group) group.updatedAt = entry.updatedAt
        await Promise.all([
          entryRepository.putSnapshot(notebookId.value, activeId.value, toPlain(entry)),
          ...(group ? [questionGroupRepository.put(notebookId.value, toPlain(group))] : []),
        ])
      } catch {
        /* ignore */
      }
    }
  }

  async function deleteCurrent() {
    if (!activeId.value) return
    const deletedId = activeId.value
    if (!notebookId.value) return
    const deletedEntry = activeEntry.value
    const groupId = deletedEntry?.groupId
    await entryRepository.delete(notebookId.value, activeId.value)
    await entryRepository.deleteSnapshot(notebookId.value, activeId.value)
    entries.value = entries.value.filter((e) => e.id !== activeId.value)
    const remainingSiblings = groupId
      ? entries.value
          .filter((entry) => entry.groupId === groupId)
          .sort((a, b) => (a.subQuestionOrder ?? 0) - (b.subQuestionOrder ?? 0))
      : []
    if (groupId && remainingSiblings.length === 0) {
      await questionGroupRepository.delete(notebookId.value, groupId)
      questionGroups.value = questionGroups.value.filter((group) => group.id !== groupId)
    } else if (groupId) {
      await Promise.all(
        remainingSiblings.map((entry, index) => {
          entry.subQuestionOrder = index
          return entryRepository.put(entry.notebookId, toPlain(entry))
        }),
      )
    }
    activeId.value = remainingSiblings[0]?.id ?? null
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
      await entryRepository.put(entry.notebookId, toPlain(entry))
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
        updates.push(entryRepository.put(entry.notebookId, toPlain(entry)))
      }
    })
    await Promise.all(updates)
    // Trigger Vue reactivity — entries are plain objects from IndexedDB,
    // so in-place property mutations don't cause computed re-evaluation.
    entries.value = [...entries.value]
  }

  return {
    entries,
    questionGroups,
    notebookEntries,
    activeId,
    activeEntry,
    activeGroup,
    activeGroupEntries,
    answersHidden,
    isDirty,
    toastMsg,
    showDeleteModal,
    selectedIds,
    selectedCount,
    loadEntries,
    checkCrashRecovery,
    createEntry,
    enableQuestionGroup,
    addSubQuestion,
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
