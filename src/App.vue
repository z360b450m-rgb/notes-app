<script setup lang="ts">
// @AI-NOTE: 根组件 —— 状态调度中心。数据通过 composables 获取,
// 通过 props 传递、events 收集。禁止在此编写业务逻辑或直接操作存储。
import { provide, computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useEntries } from './composables/useEntries'
import { migrateFromIndexedDB } from './services/db'
import { useFilter } from './composables/useFilter'
import type { SortKey, SortDir } from './composables/useFilter'
import { useMetaStore } from './composables/useMetaStore'
import { useReview, type ReviewOptions } from './composables/useReview'
import { useReviewSettings } from './composables/useReviewSettings'
import { useNotebooks } from './composables/useNotebooks'
import type { NoteEntry } from '@/types'
import type { VocabularyMistake } from '@/plugins/english-vocabulary/types'
import { useDrawing } from './composables/useDrawing'
import { useBackup } from './composables/useBackup'
import { useExport } from './composables/useExport'
import { useStats } from './composables/useStats'
import { useKeyboard } from './composables/useKeyboard'
import { useDarkMode } from './composables/useDarkMode'
import { countMultipleChoiceEntries, parsePastedText } from './utils/parsePastedText'
import { parsePdfFile } from './utils/parsePdf'
import type { PdfParseProgress } from './utils/parsePdf'
import { db, setCurrentNotebookId } from './services/db'
import Workspace from './components/Workspace.vue'
import NotebookMenu from './components/NotebookMenu.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import PdfReviewPanel from './components/PdfReviewPanel.vue'
import ImportOptionsModal from './components/ImportOptionsModal.vue'
import AppToast from './components/AppToast.vue'
import { ENGLISH_VOCABULARY_PLUGIN_ID } from './plugins/english-vocabulary/manifest'
import { notebookPlugins, getNotebookPlugin } from './plugins/registry'
import { notebookPluginService } from './plugins/service'
import PluginManager from './plugins/PluginManager.vue'

const {
  entries,
  activeId,
  activeEntry,
  answersHidden,
  isDirty,
  selectedIds,
  selectedCount,
  loadEntries,
  checkCrashRecovery,
  createEntry,
  loadEntry,
  markDirty,
  saveEntry,
  discardChanges,
  snapshotSave,
  deleteCurrent,
  updateEntryTitle,
  reorderEntries,
  toastMsg,
  showToast,
  showDeleteModal,
  openDeleteModal,
  closeDeleteModal,
  // batch
  toggleSelect,
  selectRange,
  selectAll,
  deselectAll,
  batchDelete,
  batchTag,
  batchExport,
  notebookEntries,
  // entity rename/delete
  renameSubjectInEntries,
  renameTagInEntries,
  renameSourceInEntries,
  removeSubjectFromEntries,
  removeTagFromEntries,
  removeSourceFromEntries,
} = useEntries()

const {
  notebooks,
  activeId: activeNotebookId,
  activeNotebook,
  selectNotebook,
  loadNotebooks,
  restoreLastNotebook,
  clearLastNotebook,
} = useNotebooks()
const showNotebookMenu = ref(true)

const {
  activeSubject,
  activeTag,
  activeSource,
  activeMastery,
  searchQuery,
  sortKey,
  sortDir,
  filteredEntries,
  subjectMap,
  tagMap,
  sourceMap,
  masteryMap,
  setSubject,
  setTag,
  setSource,
  setMastery,
  setSearch,
  setSort,
} = useFilter(notebookEntries)

const {
  allSubjects,
  allTags,
  allSources,
  addSubject,
  removeSubject,
  renameSubject,
  addTag,
  removeTag,
  renameTag,
  addSource,
  removeSource,
  renameSource,
} = useMetaStore(notebookEntries, () => activeNotebookId.value ?? '')

const {
  mode,
  reviewQueue,
  currentCard,
  answered,
  reviewedToday,
  elapsedMs,
  dueCount,
  isReviewing,
  progress,
  progressPercent,
  sessionDone,
  sessionRecords,
  totalSessionMs,
  startReview,
  revealAnswer,
  rateCard,
  exitReview,
  dismissSummary,
  loadLogs,
} = useReview(notebookEntries, showToast, () => activeNotebookId.value ?? '')

useReviewSettings()

const {
  drawingEnabled,
  activeTool,
  penColor,
  penSize,
  eraserSize,
  canUndo,
  canRedo,
  currentEntryId,
  toggleDrawing,
  setTool,
  setColor,
  setPenSize,
  setEraserSize,
  clearCanvas,
  undo,
  redo,
  resizeCanvas,
  loadDrawing,
  mountCanvas,
  setCanvasParent,
  captureAllDrawings,
  setStoredDrawing,
} = useDrawing(markDirty)

const { exportData, importData, importModalVisible, handleImportOption } = useBackup(
  () => notebookEntries.value,
  () => activeNotebookId.value ?? '',
  loadEntries,
  showToast,
)

async function handleImportArchive() {
  await importData()
  await loadNotebooks()
  setSubject('')
  setTag(null)
  setSearch('')
}
const { exportPDF } = useExport(showToast)
const { isDark, toggleDark } = useDarkMode()

const stats = useStats(notebookEntries)
const statsOpen = ref(false)
const settingsOpen = ref(false)
const installedPlugins = ref<Awaited<ReturnType<typeof notebookPluginService.listInstalled>>>([])
const pluginManagerOpen = ref(false)
const activePluginId = ref<string | null>(null)
const activePlugin = computed(() =>
  activePluginId.value ? getNotebookPlugin(activePluginId.value) : null,
)
const installedPluginIds = computed(() => installedPlugins.value.map((item) => item.pluginId))
const isElectron = computed(() => typeof window !== 'undefined' && !!window.electronAPI)

// Unsaved changes flow
const showUnsavedModal = ref(false)
const pendingEntryId = ref<string | null>(null)
const pendingAction = ref<'select' | 'create' | 'review' | null>(null)
const pendingSubject = ref<string>('')
const pendingForceReview = ref(false)
const showReviewSetup = ref(false)
const reviewScope = ref<'due' | 'all'>('due')
const reviewTags = ref<string[]>([])
const reviewSubjects = ref<string[]>([])
const reviewRandom = ref(true)
const reviewLimit = ref<number | null>(null)

const reviewCandidateCount = computed(() => {
  let pool =
    reviewScope.value === 'all'
      ? notebookEntries.value
      : notebookEntries.value.filter(
          (entry) => !entry.nextReviewDate || entry.nextReviewDate <= Date.now(),
        )
  if (reviewTags.value.length) {
    pool = pool.filter((entry) => reviewTags.value.some((tag) => entry.tags.includes(tag)))
  }
  if (reviewSubjects.value.length) {
    pool = pool.filter((entry) => reviewSubjects.value.includes(entry.subject))
  }
  return reviewLimit.value && reviewLimit.value > 0
    ? Math.min(pool.length, reviewLimit.value)
    : pool.length
})

async function handleEnterNotebook(id: string) {
  selectNotebook(id)
  setCurrentNotebookId(id)
  showNotebookMenu.value = false
  await loadEntries()
  await loadLogs()
  installedPlugins.value = await notebookPluginService.listInstalled(id)
}

function handleReturnToMenu() {
  clearLastNotebook()
  showNotebookMenu.value = true
  activeId.value = null
  activePluginId.value = null
  installedPlugins.value = []
}

onMounted(async () => {
  await loadNotebooks()

  // Migrate from IndexedDB to file storage on first launch in Electron
  const migrated = await migrateFromIndexedDB()
  if (migrated > 0) {
    await loadEntries()
    await loadLogs()
    showToast(`已迁移 ${migrated} 条错题到本地文件`)
  }

  // Check for crash recovery
  const recovered = await checkCrashRecovery()
  if (recovered.length > 0) {
    showToast(`已恢复 ${recovered.length} 条未保存的内容`)
  }

  // Restore last notebook — only show menu on first visit
  const lastId = restoreLastNotebook()
  if (lastId && notebooks.value.some((n) => n.id === lastId)) {
    selectNotebook(lastId)
    setCurrentNotebookId(lastId)
    showNotebookMenu.value = false
    await loadEntries()
    await loadLogs()
    installedPlugins.value = await notebookPluginService.listInstalled(lastId)
  }
})

async function installPlugin(pluginId: string) {
  if (!activeNotebookId.value) return
  try {
    await notebookPluginService.install(activeNotebookId.value, pluginId)
    installedPlugins.value = await notebookPluginService.listInstalled(activeNotebookId.value)
    pluginManagerOpen.value = false
    activePluginId.value = pluginId
    showToast(`${getNotebookPlugin(pluginId)?.name ?? '插件'}已安装到当前错题本`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '插件安装失败，请重试')
  }
}

async function uninstallPlugin(pluginId: string, deleteData: boolean) {
  if (!activeNotebookId.value) return
  try {
    await notebookPluginService.uninstall(activeNotebookId.value, pluginId, deleteData)
    installedPlugins.value = await notebookPluginService.listInstalled(activeNotebookId.value)
    if (activePluginId.value === pluginId) activePluginId.value = null
    showToast(`${getNotebookPlugin(pluginId)?.name ?? '插件'}已卸载`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '插件卸载失败，请重试')
  }
}

function openPlugin(pluginId: string) {
  if (installedPluginIds.value.includes(pluginId)) activePluginId.value = pluginId
}

async function archiveVocabularyMistake(mistake: VocabularyMistake) {
  if (!activeNotebookId.value) return
  const now = Date.now()
  const existing = notebookEntries.value.find(
    (entry) =>
      entry.pluginSource?.pluginId === 'english-vocabulary' &&
      entry.pluginSource.archiveId === mistake.archiveId &&
      entry.pluginSource.wordId === mistake.word.id &&
      entry.pluginSource.reviewMode === mistake.mode,
  )
  const modeLabel = mistake.mode === 'zh-to-en' ? '中译英' : '英译中'
  const packageTag = `Anki:${mistake.archiveName}`
  const question =
    mistake.mode === 'zh-to-en'
      ? mistake.word.meaning
      : [mistake.word.word, mistake.word.phonetic].filter(Boolean).join('<br>')
  const correctAnswer = [
    mistake.mode === 'zh-to-en' ? mistake.word.word : mistake.word.meaning,
    mistake.word.exampleEn ? `<strong>英语例句</strong><br>${mistake.word.exampleEn}` : '',
    mistake.word.exampleZh ? `<strong>例句翻译</strong><br>${mistake.word.exampleZh}` : '',
    mistake.word.note ? `<strong>注释</strong><br>${mistake.word.note}` : '',
  ]
    .filter(Boolean)
    .join('<br><br>')

  const entry: NoteEntry = existing ?? {
    id: `vocab_${mistake.archiveId}_${mistake.word.id}_${mistake.mode}`,
    notebookId: activeNotebookId.value,
    title: `[${modeLabel}] ${mistake.word.word}`,
    question,
    wrongAnswer: mistake.answer,
    correctAnswer,
    subject: '英语',
    source: mistake.archiveName,
    tags: ['英语单词', modeLabel, packageTag],
    masteryLevel: 0,
    consecutivePasses: 0,
    nextReviewDate: now,
    createdAt: now,
    updatedAt: now,
  }
  entry.title = `[${modeLabel}] ${mistake.word.word}`
  entry.question = question
  entry.wrongAnswer = mistake.answer
  entry.correctAnswer = correctAnswer
  entry.subject = '英语'
  entry.source = mistake.archiveName
  entry.tags = Array.from(new Set([...entry.tags, '英语单词', modeLabel, packageTag]))
  entry.nextReviewDate = now
  entry.updatedAt = now
  entry.pluginSource = {
    pluginId: 'english-vocabulary',
    archiveId: mistake.archiveId,
    wordId: mistake.word.id,
    reviewMode: mistake.mode,
    wrongCount: (existing?.pluginSource?.wrongCount ?? 0) + 1,
    lastWrongAt: now,
  }
  await db.put(JSON.parse(JSON.stringify(entry)))
  await loadEntries()
  showToast(existing ? '已更新对应英语错题' : '已归档到当前错题本')
}

// Crash protection: save snapshot before unload
function onBeforeUnload() {
  syncDrawingToEntry()
  snapshotSave()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

provide('toast', showToast)
provide('setCanvasParent', setCanvasParent)
provide('drawingEnabled', drawingEnabled)
provide('resizeCanvas', resizeCanvas)

useKeyboard({
  onCreate: () => handleCreate(),
  onSave: () => {
    if (activeId.value) handleSave()
  },
  onToggleReveal: () => {
    if (mode.value === 'review') {
      if (!answered.value) revealAnswer()
    } else {
      answersHidden.value = !answersHidden.value
    }
  },
  onPrev: () => navigate(-1),
  onNext: () => navigate(1),
  mode,
  isReviewing,
  answered,
  revealAnswer,
  rateCard,
  drawingEnabled,
  onUndo: () => undo(),
  onRedo: () => redo(),
})

function navigate(dir: number) {
  if (!activeId.value) return
  const ids = filteredEntries.value.map((e) => e.id)
  const idx = ids.indexOf(activeId.value)
  const newIdx = idx + dir
  if (newIdx >= 0 && newIdx < ids.length) {
    if (isDirty.value) {
      pendingEntryId.value = ids[newIdx]
      pendingAction.value = 'select'
      showUnsavedModal.value = true
      return
    }
    loadEntry(ids[newIdx])
  }
}

function checkDirtyThen(action: () => void, nextAction: 'select' | 'create' | 'review') {
  if (isDirty.value) {
    pendingAction.value = nextAction
    showUnsavedModal.value = true
  } else {
    action()
  }
}

function handleCreate(subject?: string) {
  pendingSubject.value = subject || ''
  checkDirtyThen(() => createEntry(subject), 'create')
}

function doCreate() {
  createEntry(pendingSubject.value || undefined)
}

function handleDelete() {
  openDeleteModal()
}

function handleConfirmDelete() {
  deleteCurrent()
}

// Batch import
const showBatchImport = ref(false)
const batchImportText = ref('')
const batchImportLoading = ref(false)
const batchImportSubject = ref('未分类')
const batchImportSource = ref('批量导入')
const batchImportTags = ref('')
const batchImportPreview = computed(() =>
  parsePastedText(batchImportText.value, activeNotebookId.value || '__preview__'),
)
const batchImportChoiceCount = computed(() => countMultipleChoiceEntries(batchImportPreview.value))

function handleOpenBatchImport() {
  batchImportText.value = ''
  batchImportSubject.value = '未分类'
  batchImportSource.value = '批量导入'
  batchImportTags.value = ''
  showBatchImport.value = true
}

async function handleConfirmBatchImport() {
  if (!batchImportText.value.trim() || !activeNotebookId.value) return

  batchImportLoading.value = true
  try {
    const parsed = parsePastedText(batchImportText.value, activeNotebookId.value)
    if (parsed.length === 0) {
      showToast('没有识别到题目，请确认每题以 1.、2)、（3）等序号开头')
      return
    }
    const tags = batchImportTags.value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    const now = Date.now()
    for (const [index, item] of parsed.entries()) {
      const entry = {
        id: 'cuoti_' + now + '_' + Math.random().toString(36).slice(2, 7) + '_' + index,
        notebookId: activeNotebookId.value,
        title: (item.question || '').slice(0, 40),
        question: item.question || '',
        wrongAnswer: item.wrongAnswer || '',
        correctAnswer: item.correctAnswer || '',
        subject: batchImportSubject.value.trim() || item.subject || '未分类',
        source: batchImportSource.value.trim() || item.source || '批量导入',
        tags: Array.from(new Set([...(item.tags || []), ...tags])),
        masteryLevel: 0,
        consecutivePasses: 0,
        nextReviewDate: 0,
        createdAt: now + index,
        updatedAt: now + index,
      }
      await db.put(JSON.parse(JSON.stringify(entry)))
    }
    await loadEntries()
    setSubject('')
    setTag(null)
    setSearch('')
    showToast(`已导入 ${parsed.length} 道错题`)
    showBatchImport.value = false
  } catch (err) {
    console.error('Batch import failed:', err)
    showToast('批量导入失败，请重试')
  } finally {
    batchImportLoading.value = false
  }
}

// PDF import
const showPdfImport = ref(false)
const pdfFile = ref<File | null>(null)
const pdfImportLoading = ref(false)
const pdfProgress = ref<PdfParseProgress>({ current: 0, total: 0 })
const pdfParsedPreview = ref<Partial<NoteEntry>[]>([])
const pdfError = ref('')
const showPdfReview = ref(false)

function handleOpenPdfImport() {
  pdfFile.value = null
  pdfImportLoading.value = false
  pdfProgress.value = { current: 0, total: 0 }
  pdfParsedPreview.value = []
  pdfError.value = ''
  showPdfImport.value = true
}

async function handlePdfFileSelected(file: File) {
  if (!activeNotebookId.value) return

  pdfFile.value = file
  pdfImportLoading.value = true
  pdfError.value = ''
  pdfParsedPreview.value = []

  try {
    const parsed = await parsePdfFile(file, activeNotebookId.value, (p) => {
      pdfProgress.value = p
    })
    pdfParsedPreview.value = parsed
    if (parsed.length === 0) {
      pdfError.value = '未能从此 PDF 中解析出题目，请确认 PDF 中包含带序号的题目文本。'
    } else {
      // Open review panel on success
      showPdfImport.value = false
      showPdfReview.value = true
    }
  } catch (err: unknown) {
    pdfError.value =
      (err instanceof Error ? err.message : undefined) || 'PDF 解析失败，请确认文件格式正确'
  } finally {
    pdfImportLoading.value = false
  }
}

async function handleConfirmPdfReview(reviewedEntries: Partial<NoteEntry>[]) {
  if (!activeNotebookId.value || reviewedEntries.length === 0) return

  pdfImportLoading.value = true
  try {
    const now = Date.now()
    for (let i = 0; i < reviewedEntries.length; i++) {
      const item = reviewedEntries[i]
      const entry = {
        id: 'cuoti_' + now + '_' + Math.random().toString(36).slice(2, 7) + '_' + i,
        notebookId: activeNotebookId.value,
        title: (item.question || '').replace(/<[^>]*>/g, '').slice(0, 40),
        question: item.question || '',
        wrongAnswer: item.wrongAnswer || '',
        correctAnswer: item.correctAnswer || '',
        subject: item.subject || '未分类',
        source: 'PDF导入',
        tags: item.tags || [],
        masteryLevel: 0,
        consecutivePasses: 0,
        nextReviewDate: 0,
        createdAt: now + i,
        updatedAt: now + i,
      }
      await db.put(JSON.parse(JSON.stringify(entry)))
    }
    await loadEntries()
    setSubject('')
    setTag(null)
    setSearch('')
    showToast(`已导入 ${reviewedEntries.length} 道错题`)
    showPdfReview.value = false
    pdfParsedPreview.value = []
  } catch (err) {
    console.error('PDF import failed:', err)
    showToast('导入失败，请重试')
  } finally {
    pdfImportLoading.value = false
  }
}

function handleCancelPdfReview() {
  showPdfReview.value = false
  pdfParsedPreview.value = []
}

// Batch actions
const showBatchDeleteConfirm = ref(false)

function handleBatchDelete() {
  showBatchDeleteConfirm.value = true
}

function confirmBatchDelete() {
  showBatchDeleteConfirm.value = false
  batchDelete(Array.from(selectedIds.value))
  showToast(`已删除 ${selectedCount.value} 条错题`)
}

function cancelBatchDelete() {
  showBatchDeleteConfirm.value = false
}

function handleBatchTag(tags: string[]) {
  batchTag(Array.from(selectedIds.value), tags)
  showToast(`已为 ${selectedCount.value} 条错题添加标签`)
}

function handleAddSubject(name: string, global?: boolean) {
  addSubject(name, global)
}

function handleAddTag(name: string, global?: boolean) {
  addTag(name, global)
}

function handleAddSource(name: string, global?: boolean) {
  addSource(name, global)
}

async function handleRenameSubject(oldName: string, newName: string) {
  try {
    await renameSubjectInEntries(oldName, newName)
  } catch (err) {
    console.error('Rename subject failed:', err)
    showToast('重命名失败，请重试')
    return
  }
  renameSubject(oldName, newName)
  if (activeSubject.value === oldName) {
    activeSubject.value = newName
  }
  showToast(`学科已重命名为 "${newName}"`)
}

async function handleDeleteSubject(name: string) {
  try {
    await removeSubjectFromEntries(name)
  } catch (err) {
    console.error('Delete subject failed:', err)
    showToast('删除失败，请重试')
    return
  }
  removeSubject(name)
  if (activeSubject.value === name) {
    activeSubject.value = '__all__'
  }
  showToast(`学科 "${name}" 已删除`)
}

async function handleRenameTag(oldName: string, newName: string) {
  try {
    await renameTagInEntries(oldName, newName)
  } catch (err) {
    console.error('Rename tag failed:', err)
    showToast('重命名失败，请重试')
    return
  }
  renameTag(oldName, newName)
  if (activeTag.value === oldName) {
    activeTag.value = newName
  }
  showToast(`标签已重命名为 "${newName}"`)
}

async function handleDeleteTag(name: string) {
  try {
    await removeTagFromEntries(name)
  } catch (err) {
    console.error('Delete tag failed:', err)
    showToast('删除失败，请重试')
    return
  }
  removeTag(name)
  if (activeTag.value === name) {
    activeTag.value = null
  }
  showToast(`标签 "${name}" 已删除`)
}

async function handleRenameSource(oldName: string, newName: string) {
  try {
    await renameSourceInEntries(oldName, newName)
  } catch (err) {
    console.error('Rename source failed:', err)
    showToast('重命名失败，请重试')
    return
  }
  renameSource(oldName, newName)
  if (activeSource.value === oldName) {
    activeSource.value = newName
  }
  showToast(`来源已重命名为 "${newName}"`)
}

async function handleDeleteSource(name: string) {
  try {
    await removeSourceFromEntries(name)
  } catch (err) {
    console.error('Delete source failed:', err)
    showToast('删除失败，请重试')
    return
  }
  removeSource(name)
  if (activeSource.value === name) {
    activeSource.value = null
  }
  showToast(`来源 "${name}" 已删除`)
}

function handleBatchExport() {
  batchExport(Array.from(selectedIds.value))
}

function handleExportPDF() {
  exportPDF(notebookEntries.value)
}

async function handleChangeDataDir() {
  if (!window.electronAPI) {
    showToast('此功能仅在桌面端可用')
    return
  }
  const newDir = await window.electronAPI.setDataDir()
  showToast('数据目录已更改为：' + newDir)
}

function handleSelectEntry(id: string) {
  if (mode.value === 'review') exitReview()
  if (activeId.value === id) return
  if (isDirty.value) {
    pendingEntryId.value = id
    pendingAction.value = 'select'
    showUnsavedModal.value = true
    return
  }
  loadEntry(id)
}

function handleStartReview(force = false) {
  pendingForceReview.value = force
  checkDirtyThen(() => {
    openReviewSetup(force)
  }, 'review')
}

function openReviewSetup(force = false) {
  reviewScope.value = force ? 'all' : 'due'
  reviewTags.value = []
  reviewSubjects.value = []
  reviewRandom.value = true
  reviewLimit.value = null
  showReviewSetup.value = true
}

function toggleReviewTag(tag: string) {
  reviewTags.value = reviewTags.value.includes(tag)
    ? reviewTags.value.filter((item) => item !== tag)
    : [...reviewTags.value, tag]
}

function toggleReviewSubject(subject: string) {
  reviewSubjects.value = reviewSubjects.value.includes(subject)
    ? reviewSubjects.value.filter((item) => item !== subject)
    : [...reviewSubjects.value, subject]
}

function beginConfiguredReview() {
  const options: ReviewOptions = {
    scope: reviewScope.value,
    tags: reviewTags.value,
    subjects: reviewSubjects.value,
    random: reviewRandom.value,
    limit: reviewLimit.value || undefined,
  }
  if (!startReview(options)) {
    showToast('当前筛选条件下没有可复习的题目')
    return
  }
  showReviewSetup.value = false
}

function handleMountCanvas(el: HTMLElement, entryId: string, field: string) {
  // Sync previous entry's drawings before switching
  if (currentEntryId.value && currentEntryId.value !== entryId) {
    const oldEntry = entries.value.find((e) => e.id === currentEntryId.value)
    if (oldEntry) {
      const all = captureAllDrawings()
      if (Object.keys(all).length > 0) {
        oldEntry.drawings = { ...oldEntry.drawings, ...all }
      }
    }
  }

  mountCanvas(el, field)

  // Pre-populate store from persisted drawing data
  const entry = entries.value.find((e) => e.id === entryId)
  if (entry?.drawings) {
    for (const [key, url] of Object.entries(entry.drawings)) {
      setStoredDrawing(entryId, key, url)
    }
  }
  // Migrate legacy drawing field
  const legacy = entry as NoteEntry & { drawing?: string }
  if (legacy.drawing && !entry.drawings) {
    setStoredDrawing(entryId, 'question', legacy.drawing)
    delete legacy.drawing
  }
  loadDrawing(entryId, field)
}

function syncDrawingToEntry() {
  if (!activeId.value) return
  const entry = entries.value.find((e) => e.id === activeId.value)
  if (!entry) return
  try {
    const all = captureAllDrawings()
    if (Object.keys(all).length > 0) {
      entry.drawings = { ...entry.drawings, ...all }
    } else if (!entry.drawings || Object.keys(entry.drawings).length === 0) {
      delete entry.drawings
    }
  } catch (err) {
    console.error('syncDrawingToEntry failed', err)
  }
}

async function handleSave() {
  syncDrawingToEntry()
  try {
    await saveEntry()
  } catch (err) {
    console.error('handleSave failed', err)
    showToast('保存失败，请重试')
  }
}

function handleBlurSave() {
  syncDrawingToEntry()
  snapshotSave()
}

function doStartReview() {
  openReviewSetup(pendingForceReview.value)
}

function handleExitReview() {
  exitReview()
}

// Unsaved modal handlers
async function handleSaveAndProceed() {
  await handleSave()
  proceedAfterSave()
}

function handleDiscardAndProceed() {
  discardChanges()
  proceedAfterSave()
}

function handleCancelProceed() {
  pendingEntryId.value = null
  pendingAction.value = null
  pendingSubject.value = ''
  showUnsavedModal.value = false
}

function proceedAfterSave() {
  showUnsavedModal.value = false
  const action = pendingAction.value
  pendingAction.value = null
  if (action === 'select' && pendingEntryId.value) {
    loadEntry(pendingEntryId.value)
    pendingEntryId.value = null
  } else if (action === 'create') {
    doCreate()
  } else if (action === 'review') {
    doStartReview()
  }
}

// Navigation state (edit mode only)
const filteredIds = computed(() => filteredEntries.value.map((e) => e.id))
const navIdx = computed(() => (activeId.value ? filteredIds.value.indexOf(activeId.value) : -1))
const canGoPrev = computed(() => navIdx.value > 0)
const canGoNext = computed(() => navIdx.value < filteredIds.value.length - 1 && navIdx.value >= 0)

loadEntries()
loadLogs()

watch(activeId, (_newId) => {
  // loadDrawing is called from handleMountCanvas after the canvas is ready
})
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <Transition name="page">
    <NotebookMenu
      v-if="showNotebookMenu"
      key="menu"
      @enter="handleEnterNotebook"
      @open-settings="settingsOpen = true"
    />
    <Workspace
      v-else
      key="workspace"
      :notebook-name="activeNotebook?.name ?? ''"
      :entries="notebookEntries"
      :filtered-entries="filteredEntries"
      :active-id="activeId"
      :active-entry="activeEntry"
      :answers-hidden="answersHidden"
      :is-dirty="isDirty"
      :selected-ids="selectedIds"
      :selected-count="selectedCount"
      :subject-map="subjectMap"
      :tag-map="tagMap"
      :all-subjects="allSubjects"
      :all-tags="allTags"
      :all-sources="allSources"
      :mastery-map="masteryMap"
      :due-count="dueCount"
      :mode="mode"
      :search-query="searchQuery"
      :sort-key="sortKey"
      :sort-dir="sortDir"
      :can-go-prev="canGoPrev"
      :can-go-next="canGoNext"
      :progress="progress"
      :progress-percent="progressPercent"
      :drawing-enabled="drawingEnabled"
      :active-tool="activeTool"
      :pen-color="penColor"
      :pen-size="penSize"
      :eraser-size="eraserSize"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :show-delete-modal="showDeleteModal"
      :show-batch-delete-confirm="showBatchDeleteConfirm"
      :show-unsaved-modal="showUnsavedModal"
      :stats-open="statsOpen"
      :settings-open="settingsOpen"
      :is-electron="isElectron"
      :is-dark="isDark"
      :current-card="currentCard"
      :answered="answered"
      :elapsed-ms="elapsedMs"
      :reviewed-today="reviewedToday"
      :is-reviewing="isReviewing"
      :session-done="sessionDone"
      :session-records="sessionRecords"
      :total-session-ms="totalSessionMs"
      :review-queue="reviewQueue"
      :active-subject="activeSubject"
      :active-tag="activeTag"
      :active-source="activeSource"
      :active-mastery="activeMastery"
      :source-map="sourceMap"
      :installed-plugin-ids="installedPluginIds"
      :available-plugins="notebookPlugins"
      :stats="stats"
      @return-to-menu="handleReturnToMenu"
      @select="handleSelectEntry"
      @filter-subject="setSubject"
      @filter-tag="setTag"
      @filter-source="setSource"
      @filter-mastery="setMastery"
      @filter-search="setSearch"
      @set-sort="(key: SortKey, dir?: SortDir) => setSort(key, dir)"
      @reorder="reorderEntries"
      @quick-create="handleCreate"
      @rename="updateEntryTitle"
      @save="handleSave"
      @mark-dirty="markDirty"
      @blur-save="handleBlurSave"
      @delete="handleDelete"
      @confirm-delete="handleConfirmDelete"
      @close-delete-modal="closeDeleteModal"
      @prev="navigate(-1)"
      @next="navigate(1)"
      @wheel-nav="navigate"
      @start-review="handleStartReview"
      @exit-review="handleExitReview"
      @toggle-mode="mode === 'review' ? handleExitReview() : handleStartReview()"
      @reveal="mode === 'review' ? revealAnswer() : (answersHidden = !answersHidden)"
      @rate-card="
        (r: number | string, note: string, outcome) => rateCard(r, note, outcome)
      "
      @dismiss-summary="dismissSummary"
      @toggle-drawing="toggleDrawing"
      @set-tool="setTool"
      @set-color="setColor"
      @set-pen-size="setPenSize"
      @set-eraser-size="setEraserSize"
      @undo="undo"
      @redo="redo"
      @clear-canvas="clearCanvas"
      @mount-canvas="
        (el: HTMLElement, entryId: string, field: string) => handleMountCanvas(el, entryId, field)
      "
      @toggle-select="toggleSelect"
      @range-select="(ids: string[], from: number, to: number) => selectRange(ids, from, to)"
      @select-all="selectAll"
      @deselect-all="deselectAll"
      @batch-delete="handleBatchDelete"
      @confirm-batch-delete="confirmBatchDelete"
      @cancel-batch-delete="cancelBatchDelete"
      @add-subject="(name, global) => handleAddSubject(name, global)"
      @add-tag="(name, global) => handleAddTag(name, global)"
      @add-source="(name, global) => handleAddSource(name, global)"
      @rename-subject="handleRenameSubject"
      @delete-subject="handleDeleteSubject"
      @rename-tag="handleRenameTag"
      @delete-tag="handleDeleteTag"
      @rename-source="handleRenameSource"
      @delete-source="handleDeleteSource"
      @batch-tag="handleBatchTag"
      @batch-export="handleBatchExport"
      @export-json="exportData"
      @export-pdf="handleExportPDF"
      @import-json="handleImportArchive"
      @import-text="handleOpenBatchImport"
      @import-pdf="handleOpenPdfImport"
      @toggle-stats="statsOpen = !statsOpen"
      @toggle-settings="settingsOpen = !settingsOpen"
      @open-plugin="openPlugin"
      @manage-plugins="pluginManagerOpen = true"
      @toggle-dark="toggleDark"
      @change-data-dir="handleChangeDataDir"
      @save-and-proceed="handleSaveAndProceed"
      @discard-and-proceed="handleDiscardAndProceed"
      @cancel-proceed="handleCancelProceed"
    />
  </Transition>
  <Transition name="stats">
    <SettingsPanel
      v-if="settingsOpen"
      :is-dark="isDark"
      :is-electron="isElectron"
      @close="settingsOpen = false"
      @toggle-dark="toggleDark"
      @change-data-dir="handleChangeDataDir"
    />
  </Transition>
  <Transition name="stats">
    <div
      v-if="showReviewSetup"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="showReviewSetup = false"
    >
      <div
        class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-xl max-h-[85vh] overflow-y-auto mx-4 p-6"
      >
        <h2 class="text-[16px] font-semibold text-gray-800 dark:text-brand-light-gray">开始复习</h2>
        <p class="text-[12px] text-gray-400 dark:text-brand-mid mt-1 mb-5">
          按本轮目标选择范围；答对会记录掌握度，但不会删除原题。
        </p>

        <div class="grid grid-cols-2 gap-2 mb-5">
          <button
            class="rounded-xl border px-3 py-3 text-left transition-colors"
            :class="
              reviewScope === 'due'
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-gray-200 dark:border-[#383835] text-gray-600 dark:text-brand-light-gray'
            "
            @click="reviewScope = 'due'"
          >
            <span class="block text-sm font-semibold">到期复习</span>
            <span class="text-[11px] opacity-70">仅练习当前到期题目</span>
          </button>
          <button
            class="rounded-xl border px-3 py-3 text-left transition-colors"
            :class="
              reviewScope === 'all'
                ? 'border-accent bg-accent/5 text-accent'
                : 'border-gray-200 dark:border-[#383835] text-gray-600 dark:text-brand-light-gray'
            "
            @click="reviewScope = 'all'"
          >
            <span class="block text-sm font-semibold">自由练习</span>
            <span class="text-[11px] opacity-70">从全部题目中抽题</span>
          </button>
        </div>

        <div v-if="allSubjects.length" class="mb-4">
          <p class="text-xs font-medium text-gray-600 dark:text-brand-light-gray mb-2">
            板块（可多选）
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="subject in allSubjects"
              :key="subject"
              class="px-2.5 py-1 rounded-full text-xs border transition-colors"
              :class="
                reviewSubjects.includes(subject)
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-200 dark:border-[#383835] text-gray-500 dark:text-brand-mid'
              "
              @click="toggleReviewSubject(subject)"
            >
              {{ subject }}
            </button>
          </div>
        </div>

        <div v-if="allTags.length" class="mb-5">
          <p class="text-xs font-medium text-gray-600 dark:text-brand-light-gray mb-2">
            标签（可多选，命中任一标签即可）
          </p>
          <div class="flex flex-wrap gap-2 max-h-28 overflow-y-auto pr-1">
            <button
              v-for="tag in allTags"
              :key="tag"
              class="px-2.5 py-1 rounded-full text-xs border transition-colors"
              :class="
                reviewTags.includes(tag)
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-200 dark:border-[#383835] text-gray-500 dark:text-brand-mid'
              "
              @click="toggleReviewTag(tag)"
            >
              # {{ tag }}
            </button>
          </div>
        </div>

        <div
          class="flex flex-wrap items-center gap-4 border-t border-gray-100 dark:border-[#2e2e2c] pt-4"
        >
          <label
            class="flex items-center gap-2 text-xs text-gray-600 dark:text-brand-light-gray cursor-pointer"
          >
            <input v-model="reviewRandom" type="checkbox" class="accent-accent" /> 随机顺序
          </label>
          <label class="flex items-center gap-2 text-xs text-gray-600 dark:text-brand-light-gray">
            本轮题数
            <input
              v-model.number="reviewLimit"
              type="number"
              min="1"
              placeholder="全部"
              class="w-20 rounded-md border border-gray-200 dark:border-[#383835] bg-transparent px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </label>
          <span class="ml-auto text-xs font-medium text-accent"
            >将复习 {{ reviewCandidateCount }} 题</span
          >
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button
            class="px-4 py-2 text-xs rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
            @click="showReviewSetup = false"
          >
            取消
          </button>
          <button
            class="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white disabled:opacity-50"
            :disabled="reviewCandidateCount === 0"
            @click="beginConfiguredReview"
          >
            开始练习
          </button>
        </div>
      </div>
    </div>
  </Transition>
  <!-- Batch text import modal -->
  <Transition name="stats">
    <div
      v-if="showBatchImport"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="showBatchImport = false"
    >
      <div
        class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-lg mx-4 p-6"
      >
        <h2 class="text-[15px] font-semibold text-gray-800 dark:text-brand-light-gray mb-1">
          批量导入错题
        </h2>
        <p class="text-[12px] text-gray-400 dark:text-brand-mid mb-4">
          粘贴带序号的题目；“答案：B”会自动识别为可点选的选择题。<br />
          <code class="text-[11px]">1. 题干 A. 选项一 B. 选项二 答案：B</code>
        </p>
        <textarea
          v-model="batchImportText"
          class="w-full h-48 px-3 py-2 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 resize-none"
          placeholder="在此粘贴题目文本..."
          :disabled="batchImportLoading"
        />
        <div class="mt-3 grid grid-cols-2 gap-2">
          <input
            v-model="batchImportSubject"
            class="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
            placeholder="统一板块，例如：英语语法"
            :disabled="batchImportLoading"
          />
          <input
            v-model="batchImportSource"
            class="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
            placeholder="来源"
            :disabled="batchImportLoading"
          />
          <input
            v-model="batchImportTags"
            class="col-span-2 px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
            placeholder="统一标签，多个标签用逗号分隔"
            :disabled="batchImportLoading"
          />
        </div>
        <div class="mt-3 px-3 py-2 rounded-lg bg-accent/5 text-[12px] text-accent">
          已识别 {{ batchImportPreview.length }} 题，其中
          {{ batchImportChoiceCount }} 题为可点选的选择题。
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button
            class="px-4 py-1.5 text-[12px] rounded-lg text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
            @click="showBatchImport = false"
            :disabled="batchImportLoading"
          >
            取消
          </button>
          <button
            class="px-4 py-1.5 text-[12px] font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            :disabled="batchImportPreview.length === 0 || batchImportLoading"
            @click="handleConfirmBatchImport"
          >
            {{ batchImportLoading ? '导入中...' : '一键导入' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- PDF import modal -->
  <Transition name="stats">
    <div
      v-if="showPdfImport"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      @click.self="!pdfImportLoading && (showPdfImport = false)"
    >
      <div
        class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-lg mx-4 p-6"
      >
        <h2 class="text-[15px] font-semibold text-gray-800 dark:text-brand-light-gray mb-1">
          导入 PDF 错题
        </h2>
        <p class="text-[12px] text-gray-400 dark:text-brand-mid mb-4">
          选择 PDF 文件，自动提取文本并按题号切割。仅支持文字型 PDF，扫描件需先用 OCR 识别。
        </p>

        <!-- File drop zone -->
        <label
          class="flex flex-col items-center justify-center gap-2 h-36 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
          :class="[
            pdfFile
              ? 'border-accent/40 bg-accent/5'
              : 'border-gray-200 dark:border-[#2e2e2c] hover:border-accent/30 hover:bg-accent/5',
            pdfImportLoading ? 'pointer-events-none opacity-50' : '',
          ]"
        >
          <input
            type="file"
            accept=".pdf"
            class="hidden"
            :disabled="pdfImportLoading"
            @change="
              (e) => {
                const f = (e.target as HTMLInputElement).files?.[0]
                if (f) handlePdfFileSelected(f)
              }
            "
          />
          <template v-if="!pdfFile">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="text-gray-300 dark:text-brand-mid"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="12" y2="12" />
              <line x1="15" y1="15" x2="12" y2="12" />
            </svg>
            <span class="text-[13px] text-gray-400 dark:text-brand-mid"> 点击选择 PDF 文件 </span>
          </template>
          <template v-else>
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="text-accent"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">
              {{ pdfFile.name }}
            </span>
            <span class="text-[11px] text-gray-400 dark:text-brand-mid">
              {{ (pdfFile.size / 1024).toFixed(0) }} KB
            </span>
            <button
              v-if="!pdfImportLoading && pdfParsedPreview.length === 0 && !pdfError"
              class="text-[11px] text-accent hover:underline"
              @click.prevent="pdfFile = null"
            >
              重新选择
            </button>
          </template>
        </label>

        <!-- Progress -->
        <div
          v-if="pdfImportLoading"
          class="mt-4 flex items-center gap-2 text-[12px] text-gray-500 dark:text-brand-mid"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="animate-spin"
          >
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
          </svg>
          正在解析第 {{ pdfProgress.current }} / {{ pdfProgress.total }} 页...
        </div>

        <!-- Error -->
        <div
          v-if="pdfError"
          class="mt-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-[12px] text-red-600 dark:text-red-300"
        >
          {{ pdfError }}
        </div>

        <!-- Preview -->
        <div
          v-if="pdfParsedPreview.length > 0"
          class="mt-4 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 text-[12px] text-green-700 dark:text-green-300"
        >
          已解析出 {{ pdfParsedPreview.length }} 道题目，正在打开校对界面...
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 mt-4">
          <button
            class="px-4 py-1.5 text-[12px] rounded-lg text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
            :disabled="pdfImportLoading"
            @click="showPdfImport = false"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- PDF review panel -->
  <PdfReviewPanel
    v-if="showPdfReview"
    :entries="pdfParsedPreview"
    :loading="pdfImportLoading"
    @confirm="handleConfirmPdfReview"
    @cancel="handleCancelPdfReview"
  />

  <ImportOptionsModal
    :visible="importModalVisible"
    @keep="handleImportOption(true)"
    @reset="handleImportOption(false)"
    @cancel="handleImportOption(null)"
  />
  <component
    :is="activePlugin?.component"
    v-if="activePlugin && activeNotebookId"
    :notebook-id="activeNotebookId"
    :notebook-name="activeNotebook?.name ?? ''"
    :archive-mistake="
      activePlugin.id === ENGLISH_VOCABULARY_PLUGIN_ID ? archiveVocabularyMistake : undefined
    "
    @close="activePluginId = null"
  />
  <PluginManager
    v-if="pluginManagerOpen"
    :notebook-name="activeNotebook?.name ?? ''"
    :installations="installedPlugins"
    @close="pluginManagerOpen = false"
    @install="installPlugin"
    @uninstall="uninstallPlugin"
  />
  <AppToast :message="toastMsg" />
</template>
