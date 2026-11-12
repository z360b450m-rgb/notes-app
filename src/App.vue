<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
import { useEditorPreferences } from '@/composables/useEditorPreferences'
const { preferences: editorPreferences } = useEditorPreferences()
// @AI-NOTE: 根组件 —— 状态调度中心。数据通过 composables 获取,
// 通过 props 传递、events 收集。禁止在此编写业务逻辑或直接操作存储。
import { provide, computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui'
import type { ConfirmedReviewBundle } from '@/services/reviewBundles'
import { useEntries } from './composables/useEntries'
import { migrateFromIndexedDB, migrateLegacyWebStorage, prepareUserStorage } from './services/db'
import { localBackendTest, localMode } from './services/localMode'
import { fetchApi, HEALTH_URL } from './services/apiConfig'
import { useFilter } from './composables/useFilter'
import type { SortKey, SortDir } from './composables/useFilter'
import { useMetaStore } from './composables/useMetaStore'
import { useReview, type ReviewOutcome } from './composables/useReview'
import { useReviewSettings } from './composables/useReviewSettings'
import { useNotebooks } from './composables/useNotebooks'
import type { NoteEntry } from '@/types'
import { useDrawing } from './composables/useDrawing'
import { useExport } from './composables/useExport'
import { useStats } from './composables/useStats'
import { useKeyboard } from './composables/useKeyboard'
import { useDarkMode } from './composables/useDarkMode'
import { useBatchActionsFeature } from './features/batch/useBatchActionsFeature'
import { useImportFeature } from './features/import/useImportFeature'
import { usePdfImport } from './composables/usePdfImport'
import { usePluginLaunchFeature } from './features/plugins/usePluginLaunchFeature'
import { useReviewSetupFeature } from './features/review/useReviewSetupFeature'
import Workspace from './components/Workspace.vue'
import NotebookMenu from './components/NotebookMenu.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import ImportOptionsModal from './components/ImportOptionsModal.vue'
import PdfImportDialog from './components/PdfImportDialog.vue'
import AppToast from './components/AppToast.vue'
import BackgroundTaskCenter from './components/BackgroundTaskCenter.vue'
import KnowledgeLibraryDialog from './components/KnowledgeLibraryDialog.vue'
import { createBackgroundTasks, backgroundTasksKey } from './composables/useBackgroundTasks'
import {
  createKnowledgeLibraries,
  knowledgeLibrariesKey,
} from './composables/useKnowledgeLibraries'
import { createNotebookIngest, notebookIngestKey } from './composables/useNotebookIngest'
import { createReviewAgentChats, reviewAgentChatsKey } from './composables/useReviewAgentChats'
import {
  createEntryLearningConversations,
  entryLearningConversationsKey,
} from './composables/useEntryLearningConversation'
import { ENGLISH_VOCABULARY_PLUGIN_ID } from './plugins/english-vocabulary/manifest'
import { notebookPlugins } from './plugins/registry'
import PluginManager from './plugins/PluginManager.vue'
import AuthScreen from './components/AuthScreen.vue'
import {
  AuthError,
  clearSession,
  fetchCurrentUser,
  getStoredUser,
  type AuthUser,
} from './services/auth'

const currentUser = ref<AuthUser | null>(getStoredUser())
let appInitialized = false
const startupLoading = ref(localMode || !!currentUser.value)
const startupError = ref('')
const testConnectionKey = 'renote:local-backend-connected'
const testConnected = ref(!localBackendTest || sessionStorage.getItem(testConnectionKey) === 'yes')
const testConnecting = ref(false)
const testConnectionError = ref('')

function handleAuthenticated(user: AuthUser) {
  currentUser.value = user
  window.location.reload()
}

function handleLogout() {
  clearSession()
  currentUser.value = null
  appInitialized = false
  window.location.reload()
}

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
const menuInitialNav = ref<'home' | 'review'>('home')
const menuNavigationVersion = ref(0)
const backgroundTasks = createBackgroundTasks()
provide(backgroundTasksKey, backgroundTasks)
const agentChats = createReviewAgentChats(backgroundTasks, () => handleReturnToMenu('review'))
provide(reviewAgentChatsKey, agentChats)
const entryLearningChats = createEntryLearningConversations(backgroundTasks, handleOpenAgentEntry)
provide(entryLearningConversationsKey, entryLearningChats)
const knowledge = createKnowledgeLibraries(backgroundTasks)
provide(knowledgeLibrariesKey, knowledge)
const notebookIngest = createNotebookIngest(
  backgroundTasks,
  knowledge.openLibrary,
  () => void knowledge.refresh(),
)
provide(notebookIngestKey, notebookIngest)
onMounted(() => {
  if (testConnected.value && currentUser.value) void notebookIngest.refresh()
})

const {
  entries,
  questionGroups,
  activeId,
  activeEntry,
  activeGroup,
  activeGroupEntries,
  answersHidden,
  isDirty,
  entrySaving,
  entrySaveError,
  selectedIds,
  selectedCount,
  loadEntries,
  listLoading,
  listError,
  detailLoading,
  detailError,
  ensureEntry,
  getFullEntries,
  searchEntryIds,
  checkCrashRecovery,
  createEntry,
  enableQuestionGroup,
  addSubQuestion,
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
  moveEntriesToFolder,
  notebookEntries,
  // entity rename/delete
  renameSubjectInEntries,
  renameTagInEntries,
  renameSourceInEntries,
  removeSubjectFromEntries,
  removeTagFromEntries,
  removeSourceFromEntries,
  renameFolderInEntries,
  removeFolderFromEntries,
} = useEntries(() => activeNotebookId.value ?? '')

const {
  activeSubject,
  activeTag,
  activeSource,
  activeFolder,
  activeMastery,
  searchQuery,
  searchLoading,
  searchError,
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
  setFolder,
  setMastery,
  setSearch,
  setSort,
} = useFilter(notebookEntries, questionGroups, searchEntryIds)

const {
  allSubjects,
  allTags,
  allSources,
  allFolders,
  addSubject,
  removeSubject,
  renameSubject,
  addTag,
  removeTag,
  renameTag,
  addSource,
  removeSource,
  renameSource,
  addFolder,
  removeFolder,
  renameFolder,
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
  savingReview,
  gradingAttempt,
  gradingError,
  gradingLocked,
  explainReview,
  nextGradedCard,
  retryGrading,
  setReviewOutcome,
  exitReview,
  dismissSummary,
  loadLogs,
  cardLoading,
  cardError,
  retryCurrentCard,
} = useReview(notebookEntries, () => activeNotebookId.value ?? '', showToast, ensureEntry)

const bundleStarting = ref(false)
const bundleStartError = ref('')
async function startReviewBundle(bundle: ConfirmedReviewBundle) {
  if (bundleStarting.value) return
  bundleStartError.value = ''
  bundleStarting.value = true
  try {
    if (isDirty.value) throw new Error('题目有未保存的修改，请保存后重新安排')
    if (
      activeNotebookId.value !== bundle.notebook_id ||
      activeId.value !== bundle.anchor_entry_id ||
      mode.value !== 'edit'
    )
      throw new Error('当前题目范围已变化，请重新安排')
    await getFullEntries(bundle.entry_ids)
    if (isDirty.value) throw new Error('题目有未保存的修改，请保存后重新安排')
    if (
      activeNotebookId.value !== bundle.notebook_id ||
      activeId.value !== bundle.anchor_entry_id ||
      mode.value !== 'edit'
    )
      return
    if (!startReview({ scope: 'all', entryIds: bundle.entry_ids, random: false }))
      throw new Error('复习题目未能完整加载，请重试')
    showReviewSetup.value = false
  } catch (error) {
    bundleStartError.value = error instanceof Error ? error.message : '暂时无法进入这组题的复习'
  } finally {
    bundleStarting.value = false
  }
}
watch(activeId, () => {
  bundleStartError.value = ''
})

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
  consumeAllDrawings,
  setStoredDrawing,
  resetDrawingSession,
} = useDrawing(() => {
  if (mode.value === 'edit') markDirty()
})

// Review-mode drawings are scratch work by default. Reset the canvas session
// at each mode boundary so temporary review marks can never leak into entries.
watch(mode, resetDrawingSession, { flush: 'sync' })

const { exportPDF } = useExport(showToast)
const { isDark, toggleDark } = useDarkMode()

const stats = useStats(notebookEntries, () => activeNotebookId.value ?? '')
const statsOpen = ref(false)
const settingsOpen = ref(false)
const isElectron = computed(() => typeof window !== 'undefined' && !!window.electronAPI)

// Unsaved changes flow
const showUnsavedModal = ref(false)
const pendingEntryId = ref<string | null>(null)
const pendingAction = ref<'select' | 'create' | 'review' | 'close' | null>(null)
const pendingSubject = ref<string>('')

const {
  showBatchDeleteConfirm,
  handleBatchDelete,
  confirmBatchDelete,
  cancelBatchDelete,
  handleBatchTag,
  handleBatchExport,
} = useBatchActionsFeature({
  selectedIds,
  selectedCount,
  batchDelete,
  batchTag,
  batchExport,
  showToast,
})

const {
  exportData,
  importModalVisible,
  handleImportOption,
  handleImportArchive,
  showBatchImport,
  batchImportText,
  batchImportLoading,
  batchImportSubject,
  batchImportSource,
  batchImportTags,
  batchImportPreview,
  batchImportChoiceCount,
  handleOpenBatchImport,
  handleConfirmBatchImport,
} = useImportFeature({
  entries: notebookEntries,
  getFullEntries,
  questionGroups,
  activeNotebookId,
  loadEntries,
  loadNotebooks,
  showToast,
  resetFilters: () => {
    setSubject('__all__')
    setTag('__all__')
    setSource('__all__')
    setFolder(null)
    setMastery('__all__')
    setSearch('')
  },
})

const {
  showPdfImport,
  pdfImportLoading,
  pdfImportProgress,
  pdfImportError,
  pdfImportResult,
  pdfImportDraft,
  pdfImportConfirming,
  pdfImportCancelling,
  handleOpenPdfImport,
  handleClosePdfImport,
  handleSubmitPdfImport,
  handleConfirmPdfImport,
  handleReloadPdfDraft,
  handleBackgroundPdfImport,
} = usePdfImport({
  activeNotebookId,
  loadEntries,
  loadNotebooks,
  showToast,
  tasks: backgroundTasks,
  openNotebook: handleEnterNotebook,
})

const {
  installedPlugins,
  pluginManagerOpen,
  pendingPluginId,
  pendingPluginOperation,
  pluginActionError,
  activePluginId,
  activePlugin,
  installedPluginIds,
  loadInstalledPlugins,
  resetPluginLaunch,
  installPlugin,
  uninstallPlugin,
  openPlugin,
  archiveVocabularyMistake,
} = usePluginLaunchFeature({
  activeNotebookId,
  ensureEntry,
  entries: notebookEntries,
  loadEntries,
  showToast,
})

const {
  showReviewSetup,
  reviewScope,
  reviewTags,
  reviewSubjects,
  reviewRandom,
  reviewLimit,
  reviewCandidateCount,
  handleStartReview,
  doStartReview,
  toggleReviewTag,
  toggleReviewSubject,
  beginConfiguredReview,
} = useReviewSetupFeature({
  entries: notebookEntries,
  startReview,
  showToast,
  runAfterDirtyCheck: (action) => checkDirtyThen(action, 'review'),
})

async function handleEnterNotebook(id: string) {
  selectNotebook(id)
  showNotebookMenu.value = false
  await loadEntries()
  const recovered = await checkCrashRecovery()
  if (recovered.length) showToast(`已恢复 ${recovered.length} 条未保存的内容`)
  await loadLogs()
  await loadInstalledPlugins(id)
}

async function handleOpenAgentEntry(notebookId: string, entryId: string) {
  await handleEnterNotebook(notebookId)
  if (!entries.value.some((entry) => entry.id === entryId)) {
    showToast('原题已不可用，请返回复习助手重新查询。')
    return
  }
  if (mode.value === 'review') exitReview()
  setSubject('__all__')
  setTag('__all__')
  setSource('__all__')
  setFolder(null)
  setMastery('__all__')
  setSearch('')
  deselectAll()
  answersHidden.value = false
  loadEntry(entryId)
}

function handleReturnToMenu(destination: 'home' | 'review' = 'home') {
  clearLastNotebook()
  menuInitialNav.value = destination
  menuNavigationVersion.value++
  showNotebookMenu.value = true
  activeId.value = null
  resetPluginLaunch()
}

async function initializeApp() {
  if (appInitialized) return
  if (localMode) await migrateLegacyWebStorage()
  else await prepareUserStorage()
  await loadNotebooks()

  // Migrate from IndexedDB to file storage on first launch in Electron
  const migrated = await migrateFromIndexedDB()
  if (migrated > 0) {
    await loadNotebooks()
    await loadEntries()
    await loadLogs()
    showToast(`已迁移 ${migrated} 条错题到本地文件`)
  }

  // Restore last notebook — only show menu on first visit
  const preferredId = editorPreferences.value.defaultNotebookId
  const lastId = notebooks.value.some((notebook) => notebook.id === preferredId)
    ? preferredId
    : restoreLastNotebook()
  if (lastId && notebooks.value.some((n) => n.id === lastId)) {
    selectNotebook(lastId)
    showNotebookMenu.value = false
    await loadEntries()
    const restored = await checkCrashRecovery()
    if (restored.length) showToast(`已恢复 ${restored.length} 条未保存的内容`)
    await loadLogs()
    await loadInstalledPlugins(lastId)
  }
  appInitialized = true
}

async function startApp() {
  if (!testConnected.value) return
  if (!localMode && !currentUser.value) return
  startupLoading.value = true
  startupError.value = ''
  try {
    if (!localMode) currentUser.value = await fetchCurrentUser()
    await initializeApp()
  } catch (error) {
    if (error instanceof AuthError && (error.status === 401 || error.status === 403)) {
      handleLogout()
      return
    }
    startupError.value = error instanceof Error ? error.message : '页面加载失败，请重试'
  } finally {
    startupLoading.value = false
  }
}

async function connectLocalBackend() {
  testConnecting.value = true
  testConnectionError.value = ''
  try {
    const response = await fetchApi(HEALTH_URL, { signal: AbortSignal.timeout(30000) })
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error()
    sessionStorage.setItem(testConnectionKey, 'yes')
    testConnected.value = true
    await startApp()
    if (currentUser.value) void notebookIngest.refresh()
  } catch {
    testConnectionError.value = '无法连接本机服务。请确认错题本后端已启动，并在浏览器提示时允许访问本机网络。'
  } finally {
    testConnecting.value = false
  }
}

onMounted(startApp)

// Crash protection plus a native fallback for browser reload/close.
function onBeforeUnload(event: BeforeUnloadEvent) {
  syncDrawingToEntry()
  snapshotSave()
  if (isDirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

let removeCloseRequestedListener: (() => void) | undefined

function confirmDesktopClose() {
  return window.electronAPI?.confirmClose()
}

function handleDesktopCloseRequest() {
  if (!isDirty.value) {
    void confirmDesktopClose()
    return
  }
  pendingEntryId.value = null
  pendingSubject.value = ''
  pendingAction.value = 'close'
  showUnsavedModal.value = true
}

onMounted(() => {
  removeCloseRequestedListener = window.electronAPI?.onCloseRequested(handleDesktopCloseRequest)
})
onUnmounted(() => removeCloseRequestedListener?.())

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
  const folder =
    activeFolder.value && activeFolder.value !== '__none__' ? activeFolder.value : undefined
  checkDirtyThen(() => createEntry(subject, folder), 'create')
}

function doCreate() {
  const folder =
    activeFolder.value && activeFolder.value !== '__none__' ? activeFolder.value : undefined
  createEntry(pendingSubject.value || undefined, folder)
}

async function handleEnableQuestionGroup() {
  if (isDirty.value && !(await handleSave())) return
  await enableQuestionGroup()
}

async function handleAddSubQuestion() {
  if (isDirty.value && !(await handleSave())) return
  await addSubQuestion()
}

function handleDelete() {
  openDeleteModal()
}

function handleConfirmDelete() {
  deleteCurrent()
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

function handleAddFolder(name: string) {
  addFolder(name)
  setFolder(name)
  showToast(`文件夹 "${name}" 已创建`)
}

async function handleRenameFolder(oldName: string, newName: string) {
  try {
    await renameFolderInEntries(oldName, newName)
    renameFolder(oldName, newName)
    if (activeFolder.value === oldName) activeFolder.value = newName
    showToast(`文件夹已重命名为 "${newName}"`)
  } catch (err) {
    console.error('Rename folder failed:', err)
    showToast('重命名失败，请重试')
  }
}

async function handleDeleteFolder(name: string) {
  try {
    await removeFolderFromEntries(name)
    removeFolder(name)
    if (activeFolder.value === name) activeFolder.value = '__none__'
    showToast(`文件夹 "${name}" 已删除，题目已移到未归档`)
  } catch (err) {
    console.error('Delete folder failed:', err)
    showToast('删除失败，请重试')
  }
}

async function handleMoveSelectedToFolder(folder?: string) {
  if (selectedIds.value.size === 0) return
  const count = selectedIds.value.size
  try {
    await moveEntriesToFolder([...selectedIds.value], folder)
    showToast(folder ? `已将 ${count} 道错题移入 "${folder}"` : `已将 ${count} 道错题移到未归档`)
  } catch (err) {
    console.error('Move entries to folder failed:', err)
    showToast('移动失败，请重试')
  }
}

function handleExportPDF() {
  void exportPDF(notebookEntries.value, () => getFullEntries())
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

function handleMountCanvas(el: HTMLElement, entryId: string, field: string) {
  // Consume modified canvases before replacing any mounted field. Canvas
  // remounts can also happen within the same entry when panels are revealed.
  if (mode.value === 'edit' && currentEntryId.value) {
    const oldEntry = entries.value.find((e) => e.id === currentEntryId.value)
    if (oldEntry) {
      const all = consumeAllDrawings()
      const { material, ...entryDrawings } = all
      if (Object.keys(entryDrawings).length > 0) {
        oldEntry.drawings = { ...oldEntry.drawings, ...entryDrawings }
      }
      const oldGroup = oldEntry.groupId
        ? questionGroups.value.find((group) => group.id === oldEntry.groupId)
        : undefined
      if (material && oldGroup) {
        oldGroup.drawings = { ...oldGroup.drawings, material }
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
  if (field === 'material' && entry?.groupId) {
    const group = questionGroups.value.find((item) => item.id === entry.groupId)
    const materialDrawing = group?.drawings?.material
    if (materialDrawing) setStoredDrawing(entryId, 'material', materialDrawing)
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
  if (mode.value === 'review') return
  if (!activeId.value) return
  const entry = entries.value.find((e) => e.id === activeId.value)
  if (!entry) return
  try {
    const all = consumeAllDrawings()
    const { material, ...entryDrawings } = all
    if (Object.keys(entryDrawings).length > 0) {
      entry.drawings = { ...entry.drawings, ...entryDrawings }
    } else if (!entry.drawings || Object.keys(entry.drawings).length === 0) {
      delete entry.drawings
    }
    if (material && entry.groupId) {
      const group = questionGroups.value.find((item) => item.id === entry.groupId)
      if (group) group.drawings = { ...group.drawings, material }
    }
  } catch (err) {
    console.error('syncDrawingToEntry failed', err)
  }
}

async function handleSave(silent: boolean | Event = false): Promise<boolean> {
  syncDrawingToEntry()
  try {
    const saved = await saveEntry(silent === true)
    if (!saved) showToast('保存失败，请重试')
    return saved
  } catch (err) {
    console.error('handleSave failed', err)
    showToast('保存失败，请重试')
    return false
  }
}

function handleBlurSave() {
  syncDrawingToEntry()
  if (editorPreferences.value.autoSave && isDirty.value) void handleSave(true)
  else snapshotSave()
}

let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
let autoSaving = false
watch(
  () => [
    editorPreferences.value.autoSave,
    isDirty.value,
    activeId.value,
    activeEntry.value?.question,
    activeEntry.value?.wrongAnswer,
    activeEntry.value?.correctAnswer,
    activeEntry.value?.subject,
    activeEntry.value?.source,
    activeEntry.value?.tags.join('\u0000'),
    activeGroup.value?.material,
  ],
  () => {
    clearTimeout(autoSaveTimer)
    if (!editorPreferences.value.autoSave || !isDirty.value) return
    const entryId = activeId.value
    autoSaveTimer = setTimeout(async () => {
      if (autoSaving || activeId.value !== entryId || !isDirty.value) return
      autoSaving = true
      try {
        await handleSave(true)
      } finally {
        autoSaving = false
      }
    }, 800)
  },
)
onUnmounted(() => clearTimeout(autoSaveTimer))

function handleExitReview() {
  exitReview()
}

// Unsaved modal handlers
async function handleSaveAndProceed() {
  if (await handleSave()) proceedAfterSave()
}

async function handleDiscardAndProceed() {
  try {
    await discardChanges()
    // Discard means both the persisted model and the in-memory canvas session.
    // Clear it before mounting the next entry so stale strokes cannot be synced
    // back into the entry that was just restored from storage.
    resetDrawingSession()
    proceedAfterSave()
  } catch (err) {
    console.error('discardChanges failed', err)
    showToast('放弃修改失败，请重试')
  }
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
  } else if (action === 'close') {
    void confirmDesktopClose()
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
  <main
    v-if="!testConnected"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-6 text-center text-stone-800 dark:bg-stone-900 dark:text-stone-200"
  >
    <h1 class="text-2xl font-semibold">网站联调</h1>
    <p>在运行错题本后端的电脑上打开此页面，连接后使用测试账号登录。</p>
    <button
      type="button"
      data-ui-variant="primary"
      class="ui-control rounded-lg bg-accent px-5 py-2 text-white"
      :disabled="testConnecting"
      @click="connectLocalBackend"
    >
      {{ testConnecting ? '正在连接…' : '连接本机服务' }}
    </button>
    <p v-if="testConnectionError" role="alert" class="max-w-md text-sm text-red-600">
      {{ testConnectionError }}
    </p>
  </main>
  <AuthScreen v-else-if="!localMode && !currentUser" @authenticated="handleAuthenticated" />
  <div
    v-else-if="startupLoading || startupError"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 px-6 text-center text-stone-600 dark:bg-stone-900 dark:text-stone-300"
    role="status"
    aria-live="polite"
  >
    <p>{{ startupLoading ? '正在加载错题本…' : startupError }}</p>
    <button
      data-ui-variant="default"
      type="button"
      v-if="startupError && !startupLoading"
      class="ui-control rounded-lg bg-stone-800 px-5 py-2 text-white dark:bg-stone-200 dark:text-stone-900"
      @click="startApp"
    >
      重新加载
    </button>
  </div>
  <template v-else>
    <Transition name="page">
      <NotebookMenu
        :navigation-version="menuNavigationVersion"
        v-if="showNotebookMenu"
        key="menu"
        :initial-nav="menuInitialNav"
        @enter="handleEnterNotebook"
        @open-entry="handleOpenAgentEntry"
        @open-settings="settingsOpen = true"
      />
      <Workspace
        v-else
        key="workspace"
        :notebook-name="activeNotebook?.name ?? ''"
        :entries="notebookEntries"
        :question-groups="questionGroups"
        :filtered-entries="filteredEntries"
        :active-id="activeId"
        :list-loading="listLoading"
        :list-error="listError"
        :detail-loading="detailLoading"
        :detail-error="detailError"
        :card-loading="cardLoading"
        :card-error="cardError"
        :search-loading="searchLoading"
        :search-error="searchError"
        :load-entries-content="getFullEntries"
        @retry-list="loadEntries"
        @retry-entry="activeId && loadEntry(activeId)"
        @retry-card="retryCurrentCard"
        :active-entry="activeEntry"
        :active-group="activeGroup"
        :active-group-entries="activeGroupEntries"
        :answers-hidden="answersHidden"
        :is-dirty="isDirty"
        :entry-saving="entrySaving"
        :entry-save-error="entrySaveError"
        :selected-ids="selectedIds"
        :selected-count="selectedCount"
        :subject-map="subjectMap"
        :tag-map="tagMap"
        :all-subjects="allSubjects"
        :all-tags="allTags"
        :all-sources="allSources"
        :all-folders="allFolders"
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
        :require-save-before-close="pendingAction === 'close'"
        :stats-open="statsOpen"
        :settings-open="settingsOpen"
        :is-electron="isElectron"
        :is-dark="isDark"
        :current-card="currentCard"
        :answered="answered"
        :review-saving="savingReview"
        :bundle-starting="bundleStarting"
        :bundle-start-error="bundleStartError"
        :grading-attempt="gradingAttempt"
        :grading-error="gradingError"
        :grading-locked="gradingLocked"
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
        :active-folder="activeFolder"
        :active-mastery="activeMastery"
        :source-map="sourceMap"
        :installed-plugin-ids="installedPluginIds"
        :available-plugins="notebookPlugins"
        :stats="stats"
        @return-to-menu="handleReturnToMenu"
        @return-to-agent="handleReturnToMenu('review')"
        @select="handleSelectEntry"
        @filter-subject="setSubject"
        @filter-tag="setTag"
        @filter-source="setSource"
        @filter-folder="setFolder"
        @filter-mastery="setMastery"
        @filter-search="setSearch"
        @set-sort="(key: SortKey, dir?: SortDir) => setSort(key, dir)"
        @reorder="reorderEntries"
        @quick-create="handleCreate"
        @enable-question-group="handleEnableQuestionGroup"
        @add-sub-question="handleAddSubQuestion"
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
        @start-review-bundle="startReviewBundle"
        @exit-review="handleExitReview"
        @toggle-mode="mode === 'review' ? handleExitReview() : handleStartReview()"
        @reveal="mode === 'review' ? revealAnswer() : (answersHidden = !answersHidden)"
        @rate-card="
          (r: number | string, note: string, outcome?: ReviewOutcome) => rateCard(r, note, outcome)
        "
        @review-outcome="setReviewOutcome"
        @explain-review="explainReview"
        @next-graded-card="nextGradedCard"
        @retry-grading="retryGrading"
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
        @add-folder="handleAddFolder"
        @rename-folder="handleRenameFolder"
        @delete-folder="handleDeleteFolder"
        @move-selected-to-folder="handleMoveSelectedToFolder"
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
        :user-email="currentUser?.email"
        @close="settingsOpen = false"
        @toggle-dark="toggleDark"
        @change-data-dir="handleChangeDataDir"
        @logout="handleLogout"
      />
    </Transition>
    <Transition name="stats">
      <div
        v-if="showReviewSetup"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        @click.self="showReviewSetup = false"
      >
        <div
          v-dialog-surface="'错题操作'"
          class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-xl max-h-[85vh] overflow-y-auto mx-4 p-6"
        >
          <h2 class="text-[16px] font-semibold text-gray-800 dark:text-brand-light-gray">
            开始复习
          </h2>
          <p class="text-[12px] text-gray-400 dark:text-brand-mid mt-1 mb-5">
            按本轮目标选择范围；答对会记录掌握度，但不会删除原题。
          </p>

          <RadioGroupRoot
            class="grid grid-cols-2 gap-2 mb-5"
            aria-label="复习范围"
            :model-value="reviewScope"
            @update:model-value="reviewScope = $event === 'all' ? 'all' : 'due'"
          >
            <RadioGroupItem
              as="button"
              value="due"
              type="button"
              class="ui-choice rounded-xl border px-3 py-3 text-left transition-colors"
              :class="
                reviewScope === 'due'
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-gray-200 dark:border-[#383835] text-gray-600 dark:text-brand-light-gray'
              "
            >
              <span class="block text-sm font-semibold">到期复习</span>
              <span class="text-[11px] opacity-70">仅练习当前到期题目</span>
            </RadioGroupItem>
            <RadioGroupItem
              as="button"
              value="all"
              type="button"
              class="ui-choice rounded-xl border px-3 py-3 text-left transition-colors"
              :class="
                reviewScope === 'all'
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-gray-200 dark:border-[#383835] text-gray-600 dark:text-brand-light-gray'
              "
            >
              <span class="block text-sm font-semibold">自由练习</span>
              <span class="text-[11px] opacity-70">从全部题目中抽题</span>
            </RadioGroupItem>
          </RadioGroupRoot>

          <div v-if="allSubjects.length" class="mb-4">
            <p class="text-xs font-medium text-gray-600 dark:text-brand-light-gray mb-2">
              板块（可多选）
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                v-for="subject in allSubjects"
                :key="subject"
                role="checkbox"
                :aria-checked="reviewSubjects.includes(subject)"
                class="ui-choice px-2.5 py-1 rounded-full text-xs border transition-colors"
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
                type="button"
                v-for="tag in allTags"
                :key="tag"
                role="checkbox"
                :aria-checked="reviewTags.includes(tag)"
                class="ui-choice px-2.5 py-1 rounded-full text-xs border transition-colors"
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
                class="ui-field w-20 rounded-md border border-gray-200 dark:border-[#383835] bg-transparent px-2 py-1 text-xs outline-none focus:border-accent"
              />
            </label>
            <span class="ml-auto text-xs font-medium text-accent"
              >将复习 {{ reviewCandidateCount }} 题</span
            >
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button
              data-ui-variant="default"
              type="button"
              data-dialog-cancel
              class="ui-control px-4 py-2 text-xs rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
              @click="showReviewSetup = false"
            >
              取消
            </button>
            <button
              data-ui-variant="primary"
              type="button"
              class="ui-control px-4 py-2 text-xs font-medium rounded-lg bg-accent text-white disabled:opacity-50"
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
          v-dialog-surface="'错题操作'"
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
            class="ui-field w-full h-48 px-3 py-2 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 resize-none"
            placeholder="在此粘贴题目文本..."
            :disabled="batchImportLoading"
          />
          <div class="mt-3 grid grid-cols-2 gap-2">
            <input
              v-model="batchImportSubject"
              class="ui-field px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
              placeholder="统一板块，例如：英语语法"
              :disabled="batchImportLoading"
            />
            <input
              v-model="batchImportSource"
              class="ui-field px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
              placeholder="来源"
              :disabled="batchImportLoading"
            />
            <input
              v-model="batchImportTags"
              class="ui-field col-span-2 px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141412] outline-none focus:border-accent/40"
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
              data-ui-variant="default"
              type="button"
              data-dialog-cancel
              class="ui-control px-4 py-1.5 text-[12px] rounded-lg text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
              @click="showBatchImport = false"
              :disabled="batchImportLoading"
            >
              取消
            </button>
            <button
              data-ui-variant="primary"
              type="button"
              class="ui-control px-4 py-1.5 text-[12px] font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              :disabled="batchImportPreview.length === 0 || batchImportLoading"
              @click="handleConfirmBatchImport"
            >
              {{ batchImportLoading ? '导入中...' : '一键导入' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <PdfImportDialog
      v-if="
        showPdfImport ||
        pdfImportLoading ||
        pdfImportConfirming ||
        pdfImportDraft ||
        pdfImportResult
      "
      :visible="showPdfImport"
      :loading="pdfImportLoading"
      :progress="pdfImportProgress"
      :error="pdfImportError"
      :result="pdfImportResult"
      :draft="pdfImportDraft"
      :confirming="pdfImportConfirming"
      :cancelling="pdfImportCancelling"
      @close="handleClosePdfImport"
      @background="handleBackgroundPdfImport"
      @submit="handleSubmitPdfImport"
      @confirm="handleConfirmPdfImport"
      @reload="handleReloadPdfDraft"
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
      :pending-id="pendingPluginId"
      :pending-operation="pendingPluginOperation"
      :action-error="pluginActionError"
      @close="pluginManagerOpen = false"
      @install="installPlugin"
      @uninstall="uninstallPlugin"
    />
    <KnowledgeLibraryDialog
      v-if="knowledge.libraryMode.value"
      :key="knowledge.focusVersion.value"
      :mode="knowledge.libraryMode.value"
      :libraries="knowledge.libraries.value"
      :selected="knowledge.selectedLibraries.value"
      :error="knowledge.error.value"
      :importing="knowledge.importing.value"
      :import-progress="knowledge.importProgress.value"
      :import-results="knowledge.importResults.value"
      :active-import-id="knowledge.activeImportId.value"
      :action-ids="knowledge.actionIds.value"
      :focus-library-id="knowledge.focusLibraryId.value"
      :focus-notebook-id="knowledge.focusNotebookId.value"
      @close="knowledge.libraryMode.value = null"
      @insert="knowledge.selectLibraries"
      @save="knowledge.save"
      @archive="knowledge.archive"
      @import="knowledge.importFiles"
      @cancel-import="knowledge.cancelImport"
      @delete="knowledge.deleteLibrary"
      @refresh="knowledge.refresh"
    />
    <BackgroundTaskCenter />
    <AppToast :message="toastMsg" @dismiss="toastMsg = ''" />
  </template>
</template>
