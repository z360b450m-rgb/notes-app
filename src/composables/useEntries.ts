import { ref, computed, onUnmounted } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import { syncInternalLinkLabels } from '@/utils/internalLinks'
import { entryRepository, questionGroupRepository } from '@/services/db'
import { useReviewSettings } from '@/composables/useReviewSettings'
import { appendById, dedupeById, prependById } from '@/utils/dedupeById'

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
  const pendingSaves = ref(new Map<string, number>())
  const saveErrors = ref(new Map<string, string>())
  const entrySaving = computed(() => !!pendingSaves.value.get(activeId.value || ''))
  const entrySaveError = computed(() => saveErrors.value.get(activeId.value || '') || '')
  const listLoading = ref(false)
  const listError = ref('')
  const detailLoading = ref(false)
  const detailError = ref('')
  const { settings } = useReviewSettings()
  const notebookId = computed(getNotebookId)

  const notebookEntries = computed(() => dedupeById(entries.value))

  const activeEntry = computed<NoteEntry | undefined>(() =>
    entries.value.find((e) => e.id === activeId.value && !e.isSummary),
  )

  const detailRequests = new Map<string, Promise<NoteEntry>>()
  const groupRequests = new Map<string, Promise<void>>()

  async function ensureGroup(id: string): Promise<void> {
    const owner = notebookId.value
    const group = questionGroups.value.find((item) => item.id === id)
    if (group && !group.isSummary) return
    const key = `${owner}:${id}`
    if (groupRequests.has(key)) return groupRequests.get(key)!
    const request = (async () => {
      const full = await questionGroupRepository.get(owner, id)
      if (!full || full.isSummary) throw new Error('题组内容暂时无法加载，请重试')
      if (notebookId.value !== owner) return
      const current = questionGroups.value.find((item) => item.id === id)
      if (current?.isSummary) {
        Object.assign(current, full)
        delete current.isSummary
      } else if (!current) questionGroups.value.push(full)
    })().finally(() => groupRequests.delete(key))
    groupRequests.set(key, request)
    return request
  }

  async function ensureEntry(id: string): Promise<NoteEntry> {
    const owner = notebookId.value
    let entry = entries.value.find((item) => item.id === id)
    if (!entry) throw new Error('题目已删除或不在当前错题本中')
    const key = `${owner}:${id}`
    const existingRequest = detailRequests.get(key)
    if (existingRequest) return existingRequest
    const request = (async () => {
      if (entry.isSummary) {
        const full = await entryRepository.get(owner, id)
        if (!full || full.isSummary) throw new Error('题目内容暂时无法加载，请重试')
        const current = entries.value.find((item) => item.id === id)
        if (notebookId.value !== owner || !current) throw new Error('已切换错题本')
        entry = current
        if (entry.isSummary) {
          Object.assign(entry, full)
          delete entry.isSummary
          delete entry.questionPreview
        }
      }
      if (entry.groupId) await ensureGroup(entry.groupId)
      return entry
    })().finally(() => detailRequests.delete(key))
    detailRequests.set(key, request)
    return request
  }

  async function getFullEntries(
    ids = entries.value.map((entry) => entry.id),
  ): Promise<NoteEntry[]> {
    const result: NoteEntry[] = []
    let next = 0
    async function worker() {
      while (next < ids.length) {
        const index = next++
        result[index] = await ensureEntry(ids[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker))
    return result
  }

  async function searchEntryIds(query: string): Promise<string[]> {
    return entryRepository.searchIds!(notebookId.value, query.trim())
  }

  const activeGroup = computed<QuestionGroup | undefined>(() => {
    const groupId = activeEntry.value?.groupId
    return groupId ? questionGroups.value.find((group) => group.id === groupId) : undefined
  })

  const activeGroupEntries = computed<NoteEntry[]>(() => {
    const groupId = activeEntry.value?.groupId
    if (!groupId) return activeEntry.value ? [activeEntry.value] : []
    return dedupeById(entries.value)
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
    entryListRevision++
    for (const groupId of affectedGroupIds) {
      const remaining = entries.value
        .filter((entry) => entry.groupId === groupId)
        .sort((a, b) => (a.subQuestionOrder ?? 0) - (b.subQuestionOrder ?? 0))
      if (remaining.length === 0) {
        await questionGroupRepository.delete(notebookId.value, groupId)
        questionGroups.value = questionGroups.value.filter((group) => group.id !== groupId)
        groupListRevision++
      } else {
        await getFullEntries(remaining.map((entry) => entry.id))
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
    await getFullEntries(ids)
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

  async function moveEntriesToFolder(ids: string[], folder?: string) {
    const now = Date.now()
    const idSet = new Set(ids)
    const targets = entries.value.filter((entry) => idSet.has(entry.id))
    await getFullEntries(targets.map((entry) => entry.id))
    await Promise.all(
      targets.map((entry) =>
        entryRepository.put(
          entry.notebookId,
          toPlain({ ...entry, folder: folder || undefined, updatedAt: now }),
        ),
      ),
    )
    for (const entry of targets) {
      entry.folder = folder || undefined
      entry.updatedAt = now
    }
    entries.value = [...entries.value]
    deselectAll()
  }

  async function renameFolderInEntries(oldName: string, newName: string) {
    const targets = entries.value.filter((entry) => entry.folder === oldName)
    if (targets.length === 0) return
    await moveEntriesToFolder(
      targets.map((entry) => entry.id),
      newName,
    )
  }

  async function removeFolderFromEntries(name: string) {
    const targets = entries.value.filter((entry) => entry.folder === name)
    if (targets.length === 0) return
    await moveEntriesToFolder(targets.map((entry) => entry.id))
  }

  // Rename subject across all entries
  async function renameSubjectInEntries(oldName: string, newName: string) {
    const now = Date.now()
    const targets = entries.value.filter((e) => e.subject === oldName)
    if (targets.length === 0) return
    await getFullEntries(targets.map((entry) => entry.id))
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
    await getFullEntries(targets.map((entry) => entry.id))
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
    await getFullEntries(targets.map((entry) => entry.id))
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
    await getFullEntries(targets.map((entry) => entry.id))
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
    await getFullEntries(targets.map((entry) => entry.id))
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
    await getFullEntries(targets.map((entry) => entry.id))
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
  async function batchExport(ids: string[]) {
    const selected = await getFullEntries(ids)
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
  let entryListRevision = 0
  let groupListRevision = 0

  async function loadEntries() {
    const seq = ++loadSeq
    const owner = notebookId.value
    listError.value = ''
    listLoading.value = true
    if (entries.value.some((entry) => entry.notebookId !== owner)) {
      entries.value = []
      questionGroups.value = []
      activeId.value = null
      detailLoading.value = false
      detailError.value = ''
    }
    if (!notebookId.value) {
      entries.value = []
      questionGroups.value = []
      listLoading.value = false
      return
    }
    const startedAtEntryRevision = entryListRevision
    const startedAtGroupRevision = groupListRevision
    try {
      const [result, groups] = await Promise.all([
        entryRepository.getSummaries!(owner),
        questionGroupRepository.getSummaries!(owner),
      ])
      if (seq === loadSeq) {
        // Do not let a slower full load overwrite an item that was created or
        // removed while storage was responding. Every local insertion/removal
        // advances the matching revision below.
        if (startedAtEntryRevision === entryListRevision) {
          const loaded = new Map(
            entries.value.filter((entry) => !entry.isSummary).map((entry) => [entry.id, entry]),
          )
          entries.value = dedupeById(result).map((summary) => {
            const full = loaded.get(summary.id)
            return full &&
              (full.updatedAt >= summary.updatedAt || (isDirty.value && full.id === activeId.value))
              ? full
              : summary
          })
        }
        if (startedAtGroupRevision === groupListRevision) {
          const loaded = new Map(
            questionGroups.value
              .filter((group) => !group.isSummary)
              .map((group) => [group.id, group]),
          )
          questionGroups.value = dedupeById(groups).map((summary) => {
            const full = loaded.get(summary.id)
            return full &&
              (full.updatedAt >= summary.updatedAt ||
                (isDirty.value && full.id === activeEntry.value?.groupId))
              ? full
              : summary
          })
        }
        if (activeId.value) await loadEntry(activeId.value)
      }
    } catch (error) {
      if (seq === loadSeq)
        listError.value = error instanceof Error ? error.message : '题目列表加载失败，请重试'
      if (seq === loadSeq && entries.value.length === 0) {
        entries.value = []
      }
    } finally {
      if (seq === loadSeq) listLoading.value = false
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
          delete existing.isSummary
          await entryRepository.put(notebookId.value, toPlain(existing))
        } else {
          // Entry was never saved — restore it
          entries.value = appendById(entries.value, snap.data)
          entryListRevision++
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

  async function createEntry(preselectSubject?: string, preselectFolder?: string) {
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
      folder: preselectFolder || undefined,
      masteryLevel: 0,
      consecutivePasses: 0,
      nextReviewDate: Date.now() + settings.value.firstReviewDays * 86400000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await entryRepository.put(notebookId.value, toPlain(entry))
    entries.value = prependById(entries.value, entry)
    entryListRevision++
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
    entryListRevision++
    await Promise.all([
      questionGroupRepository.put(notebookId.value, toPlain(group)),
      entryRepository.put(notebookId.value, toPlain(entry)),
    ])
    questionGroups.value = prependById(questionGroups.value, group)
    groupListRevision++
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
    entries.value = appendById(entries.value, entry)
    entryListRevision++
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
    entries.value = prependById(entries.value, entry)
    entryListRevision++
    activeId.value = entry.id
    answersHidden.value = false
    isDirty.value = false
    startSnapshotTimer()
    showToast('文档扫描已保存')
  }

  let selectionSequence = 0
  async function loadEntry(id: string) {
    const sequence = ++selectionSequence
    const owner = notebookId.value
    activeId.value = id
    detailError.value = ''
    detailLoading.value = true
    try {
      await ensureEntry(id)
    } catch (error) {
      if (sequence === selectionSequence && owner === notebookId.value) {
        detailError.value = error instanceof Error ? error.message : '题目加载失败，请重试'
      }
    } finally {
      if (sequence === selectionSequence && owner === notebookId.value) detailLoading.value = false
    }
  }

  // Call this on every content mutation — marks dirty, does NOT save to DB
  let editRevision = 0
  function markDirty() {
    editRevision++
    isDirty.value = true
    startSnapshotTimer()
  }

  // Manual save — persists to DB, clears dirty flag, removes snapshot
  async function saveEntry(silent = false): Promise<boolean> {
    const savedRevision = editRevision
    const savedEntryId = activeId.value
    if (!savedEntryId) return false
    const entry = entries.value.find((e) => e.id === savedEntryId)
    if (!entry || entry.isSummary || detailLoading.value || detailError.value) return false
    const savedNotebookId = entry.notebookId
    const group = entry.groupId
      ? questionGroups.value.find((item) => item.id === entry.groupId)
      : undefined

    pendingSaves.value.set(savedEntryId, (pendingSaves.value.get(savedEntryId) || 0) + 1)
    saveErrors.value.delete(savedEntryId)
    try {
      entry.updatedAt = Date.now()
      try {
        if (group) group.updatedAt = entry.updatedAt
        await Promise.all([
          entryRepository.put(savedNotebookId, toPlain(entry)),
          ...(group ? [questionGroupRepository.put(group.notebookId, toPlain(group))] : []),
        ])
      } catch (err) {
        console.error('Save failed', err)
        saveErrors.value.set(savedEntryId, '保存失败，修改仍保留在当前页面')
        return false
      }
      try {
        await entryRepository.deleteSnapshot(savedNotebookId, savedEntryId)
      } catch {
        /* ok if missing */
      }
      if (activeId.value === savedEntryId && editRevision === savedRevision) isDirty.value = false
      saveErrors.value.delete(savedEntryId)
      if (!silent) showToast('已保存')
      return true
    } finally {
      const remaining = (pendingSaves.value.get(savedEntryId) || 1) - 1
      if (remaining) pendingSaves.value.set(savedEntryId, remaining)
      else pendingSaves.value.delete(savedEntryId)
    }
  }

  // Discard changes — reload from DB
  async function discardChanges() {
    const discardedEntryId = activeId.value
    const discardedNotebookId = notebookId.value
    if (!discardedEntryId || !discardedNotebookId) return

    // Capture the operation context before the first await. The active entry can
    // change while storage is responding; using the live ref afterwards can
    // replace the newly selected entry with the discarded one.
    const saved = await entryRepository.get(discardedNotebookId, discardedEntryId)
    if (saved) {
      const idx = entries.value.findIndex((e) => e.id === discardedEntryId)
      if (idx !== -1) entries.value[idx] = saved
    }
    const groupId = saved?.groupId
    if (groupId) {
      const savedGroup = await questionGroupRepository.get(discardedNotebookId, groupId)
      const groupIndex = questionGroups.value.findIndex((group) => group.id === groupId)
      if (savedGroup && groupIndex !== -1) questionGroups.value[groupIndex] = savedGroup
    }
    await entryRepository.deleteSnapshot(discardedNotebookId, discardedEntryId)
    saveErrors.value.delete(discardedEntryId)
    if (activeId.value === discardedEntryId) isDirty.value = false
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
    const deletedId = activeId.value
    const deletedNotebookId = notebookId.value
    if (!deletedId || !deletedNotebookId) return
    const deletedEntry = entries.value.find((entry) => entry.id === deletedId)
    const groupId = deletedEntry?.groupId
    await entryRepository.delete(deletedNotebookId, deletedId)
    await entryRepository.deleteSnapshot(deletedNotebookId, deletedId)
    entries.value = entries.value.filter((e) => e.id !== deletedId)
    entryListRevision++
    const remainingSiblings = groupId
      ? entries.value
          .filter((entry) => entry.groupId === groupId)
          .sort((a, b) => (a.subQuestionOrder ?? 0) - (b.subQuestionOrder ?? 0))
      : []
    if (groupId && remainingSiblings.length === 0) {
      await questionGroupRepository.delete(deletedNotebookId, groupId)
      questionGroups.value = questionGroups.value.filter((group) => group.id !== groupId)
      groupListRevision++
    } else if (groupId) {
      await getFullEntries(remainingSiblings.map((entry) => entry.id))
      await Promise.all(
        remainingSiblings.map((entry, index) => {
          entry.subQuestionOrder = index
          return entryRepository.put(entry.notebookId, toPlain(entry))
        }),
      )
    }
    if (activeId.value === deletedId) {
      activeId.value = remainingSiblings[0]?.id ?? null
      isDirty.value = false
    }
    showDeleteModal.value = false
    showToast('错题已删除')
  }

  async function updateEntryTitle(id: string, newTitle: string) {
    try {
      await getFullEntries()
      await Promise.all(questionGroups.value.map((group) => ensureGroup(group.id)))
    } catch {
      showToast('部分题目暂时无法加载，重命名未完成')
      return
    }
    const entry = entries.value.find((e) => e.id === id)
    if (!entry || !newTitle) return
    const oldTitle = entry.title
    entry.title = newTitle
    entry.updatedAt = Date.now()
    try {
      const entryWrites: Promise<void>[] = [entryRepository.put(entry.notebookId, toPlain(entry))]
      for (const linkedEntry of entries.value) {
        let changed = false
        for (const field of ['question', 'wrongAnswer', 'correctAnswer'] as const) {
          const result = syncInternalLinkLabels(linkedEntry[field], id, oldTitle, newTitle)
          if (!result.changed) continue
          linkedEntry[field] = result.html
          changed = true
        }
        if (changed && !(isDirty.value && linkedEntry.id === activeId.value)) {
          entryWrites.push(entryRepository.put(linkedEntry.notebookId, toPlain(linkedEntry)))
        }
      }

      const groupWrites: Promise<void>[] = []
      for (const group of questionGroups.value) {
        const result = syncInternalLinkLabels(group.material, id, oldTitle, newTitle)
        if (!result.changed) continue
        group.material = result.html
        const activeDirtyGroup = isDirty.value && activeGroup.value?.id === group.id
        if (!activeDirtyGroup) {
          groupWrites.push(questionGroupRepository.put(group.notebookId, toPlain(group)))
        }
      }

      await Promise.all([...entryWrites, ...groupWrites])
      entries.value = [...entries.value]
      questionGroups.value = [...questionGroups.value]
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
    toastTimer = setTimeout(
      () => {
        toastMsg.value = ''
        toastTimer = null
      },
      /失败|错误|无法/.test(msg) ? 8000 : 4000,
    )
  }

  onUnmounted(() => {
    if (toastTimer) clearTimeout(toastTimer)
  })

  function openDeleteModal() {
    showDeleteModal.value = true
  }

  function closeDeleteModal() {
    showDeleteModal.value = false
  }

  async function reorderEntries(orderedIds: string[]) {
    try {
      await getFullEntries(orderedIds)
    } catch {
      showToast('部分题目暂时无法加载，排序未保存')
      return
    }
    const now = Date.now()
    const updates: Promise<void>[] = []
    entryListRevision++
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
    entrySaving,
    entrySaveError,
    toastMsg,
    showDeleteModal,
    selectedIds,
    selectedCount,
    listLoading,
    listError,
    detailLoading,
    detailError,
    ensureEntry,
    getFullEntries,
    searchEntryIds,
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
    moveEntriesToFolder,
    renameFolderInEntries,
    removeFolderFromEntries,
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
