<script setup lang="ts">
// @AI-NOTE: 工作区布局组件 —— 仅编排子组件布局。数据通过 props/events
// 委托给 App.vue, 禁止直接操作存储或编写业务逻辑。
import { computed, ref, onMounted, onUnmounted } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import type { SortKey, SortDir } from '@/composables/useFilter'
import type { StatsState } from '@/composables/useStats'
import type { ReviewOutcome, SessionRecord } from '@/composables/useReview'
import type { ReviewAttempt } from '@/services/reviewGrading'
import type { ConfirmedReviewBundle } from '@/services/reviewBundles'
import type { NotebookPluginManifest } from '@/plugins/types'
import { PEN_COLORS } from '@/composables/useDrawing'
import AppSidebar from './AppSidebar.vue'
import AppToolbar from './AppToolbar.vue'
import NoteEditor from './NoteEditor.vue'
// import AiChatSidebar from './AiChatSidebar.vue'
import ReviewPanel from './ReviewPanel.vue'
import DeleteModal from './DeleteModal.vue'
import StatsPanel from './StatsPanel.vue'
import UnsavedModal from './UnsavedModal.vue'
import EntrySaveStatus from './EntrySaveStatus.vue'

const props = defineProps<{
  notebookName: string
  entries: NoteEntry[]
  questionGroups: QuestionGroup[]
  filteredEntries: NoteEntry[]
  activeId: string | null
  listLoading?: boolean
  listError?: string
  detailLoading?: boolean
  detailError?: string
  cardLoading?: boolean
  cardError?: string
  searchLoading?: boolean
  searchError?: string
  loadEntriesContent?: (ids: string[]) => Promise<NoteEntry[]>
  activeEntry: NoteEntry | null | undefined
  activeGroup: QuestionGroup | null | undefined
  activeGroupEntries: NoteEntry[]
  answersHidden: boolean
  isDirty: boolean
  entrySaving?: boolean
  entrySaveError?: string
  selectedIds: Set<string>
  selectedCount: number
  subjectMap: Record<string, number>
  tagMap: Record<string, number>
  sourceMap: Record<string, number>
  masteryMap: Record<string, number>
  dueCount: number
  mode: 'edit' | 'review'
  searchQuery: string
  sortKey: SortKey
  sortDir: SortDir
  canGoPrev: boolean
  canGoNext: boolean
  progress: string
  progressPercent: number
  drawingEnabled: boolean
  activeTool: string
  penColor: string
  penSize: number
  eraserSize: number
  canUndo: boolean
  canRedo: boolean
  showDeleteModal: boolean
  showBatchDeleteConfirm: boolean
  showUnsavedModal: boolean
  requireSaveBeforeClose: boolean
  statsOpen: boolean
  settingsOpen: boolean
  stats: StatsState
  isElectron: boolean
  isDark: boolean
  currentCard: NoteEntry | null | undefined
  answered: boolean
  reviewSaving?: boolean
  bundleStarting?: boolean
  bundleStartError?: string
  gradingAttempt?: ReviewAttempt | null
  gradingError?: string
  gradingLocked?: boolean
  elapsedMs: number
  reviewedToday: number
  isReviewing: boolean
  sessionDone: boolean
  sessionRecords: SessionRecord[]
  totalSessionMs: number
  reviewQueue: NoteEntry[]
  activeSubject: string
  activeTag: string | null
  activeSource: string | null
  activeFolder: string | null
  activeMastery: string
  allSubjects: string[]
  allTags: string[]
  allSources: string[]
  allFolders: string[]
  installedPluginIds: string[]
  availablePlugins: NotebookPluginManifest[]
}>()

const emit = defineEmits<{
  // Notebook
  'return-to-menu': []
  'return-to-agent': []

  // Entry selection
  select: [id: string]
  'retry-list': []
  'retry-entry': []
  'retry-card': []

  // Filters
  'filter-subject': [subject: string]
  'filter-tag': [tag: string | null]
  'filter-source': [source: string | null]
  'filter-folder': [folder: string | null]
  'filter-mastery': [label: string]
  'filter-search': [query: string]

  // Sort & Reorder
  'set-sort': [key: SortKey, dir?: SortDir]
  reorder: [ids: string[]]

  // Entry actions
  'quick-create': [subject: string]
  'enable-question-group': []
  'add-sub-question': []
  rename: [id: string, newTitle: string]
  save: []
  'mark-dirty': []
  'blur-save': []
  delete: []
  'confirm-delete': []
  'close-delete-modal': []

  // Navigation
  prev: []
  next: []
  'wheel-nav': [dir: number]

  // Review
  'start-review': [force: boolean]
  'start-review-bundle': [bundle: ConfirmedReviewBundle]
  'exit-review': []
  'toggle-mode': []
  reveal: []
  'rate-card': [r: number | string, note: string, outcome?: ReviewOutcome]
  'explain-review': [text: string]
  'next-graded-card': []
  'retry-grading': []
  'review-outcome': [outcome: ReviewOutcome]
  'dismiss-summary': []

  // Drawing
  'toggle-drawing': []
  'set-tool': [tool: string]
  'set-color': [color: string]
  'set-pen-size': [size: number]
  'set-eraser-size': [size: number]
  'clear-canvas': []
  undo: []
  redo: []
  'mount-canvas': [el: HTMLElement | null, entryId: string, field: string]

  // Batch
  'toggle-select': [id: string]
  'range-select': [ids: string[], fromIdx: number, toIdx: number]
  'select-all': [ids: string[]]
  'deselect-all': []
  'batch-delete': []
  'confirm-batch-delete': []
  'cancel-batch-delete': []
  'add-subject': [name: string, global?: boolean]
  'add-tag': [name: string, global?: boolean]
  'add-source': [name: string, global?: boolean]
  'rename-subject': [oldName: string, newName: string]
  'delete-subject': [name: string]
  'rename-tag': [oldName: string, newName: string]
  'delete-tag': [name: string]
  'rename-source': [oldName: string, newName: string]
  'delete-source': [name: string]
  'add-folder': [name: string]
  'rename-folder': [oldName: string, newName: string]
  'delete-folder': [name: string]
  'move-selected-to-folder': [folder?: string]
  'batch-tag': [tags: string[]]
  'batch-export': []

  // Export/Import
  'export-json': []
  'export-pdf': []
  'import-json': []
  'import-text': []
  'import-pdf': []

  // Stats
  'toggle-stats': []

  // Settings
  'toggle-settings': []
  'toggle-dark': []
  'change-data-dir': []
  'open-plugin': [pluginId: string]
  'manage-plugins': []

  // Unsaved modal
  'save-and-proceed': []
  'discard-and-proceed': []
  'cancel-proceed': []
}>()

const sidebarCollapsed = ref(false)
const isNarrowScreen = ref(false)
let narrowScreen: MediaQueryList | undefined
function updateSidebarForScreen() {
  isNarrowScreen.value = !!narrowScreen?.matches
  sidebarCollapsed.value = isNarrowScreen.value
}
onMounted(() => {
  narrowScreen = window.matchMedia('(max-width: 1100px)')
  updateSidebarForScreen()
  narrowScreen.addEventListener('change', updateSidebarForScreen)
})
onUnmounted(() => narrowScreen?.removeEventListener('change', updateSidebarForScreen))
function selectEntry(id: string) {
  emit('select', id)
  if (narrowScreen?.matches) sidebarCollapsed.value = true
}
function clearSearchAndFilters() {
  emit('filter-search', '')
  emit('filter-subject', '__all__')
  emit('filter-tag', null)
  emit('filter-source', null)
  emit('filter-folder', null)
  emit('filter-mastery', '__all__')
}
const entryPosition = computed(
  () => props.filteredEntries.findIndex((entry) => entry.id === props.activeId) + 1,
)
const mainArea = ref<HTMLElement | null>(null)
const contentLoading = computed(() =>
  props.mode === 'review' ? props.cardLoading : props.listLoading || props.detailLoading,
)
const contentError = computed(() =>
  props.mode === 'review' ? props.cardError : props.listError || props.detailError,
)
function retryContent() {
  if (props.mode === 'review') emit('retry-card')
  else if (props.listError) emit('retry-list')
  else emit('retry-entry')
}
const reviewGroup = computed(() => {
  const groupId = props.currentCard?.groupId
  return groupId ? props.questionGroups.find((group) => group.id === groupId) : undefined
})
let lastWheelNav = 0
let lastEdgeTime = 0

function onWheel(e: WheelEvent) {
  if (props.mode !== 'edit' || !props.activeId) return
  const layout = (e.target as HTMLElement).closest('.editor-layout')
  if (layout && getComputedStyle(layout).display === 'flex') return

  // Only allow wheel navigation from answer panels, not question area
  const inAnswer = (e.target as HTMLElement).closest('.answer-panel')
  if (!inAnswer) {
    lastEdgeTime = 0
    return
  }

  const scrollable = (e.target as HTMLElement).closest('.overflow-y-auto')
  if (scrollable) {
    const el = scrollable as HTMLElement
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 5

    if ((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
      const now = Date.now()
      // Arrived at edge for the first time, or continuous fast scrolling → block
      if (lastEdgeTime === 0 || now - lastEdgeTime < 150) {
        lastEdgeTime = now
        return
      }
      // Paused > 150ms at edge then scrolled again → allow
      lastEdgeTime = now
    } else {
      lastEdgeTime = 0
      return
    }
  }

  const now = Date.now()
  if (now - lastWheelNav < 600) return
  lastWheelNav = now

  lastEdgeTime = 0
  emit('wheel-nav', e.deltaY > 0 ? 1 : -1)
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="workspace-ui flex flex-col h-screen bg-white dark:bg-[#141413]">
    <AppToolbar
      :sidebar-collapsed="sidebarCollapsed"
      @return-to-menu="emit('return-to-menu')"
      @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
      :active-id="activeId"
      :search-query="searchQuery"
      :mode="mode"
      :due-count="dueCount"
      :progress="progress"
      :stats-open="statsOpen"
      :drawing-enabled="drawingEnabled"
      :is-dirty="isDirty"
      @new="emit('quick-create', '')"
      @save="emit('save')"
      @delete="emit('delete')"
      @search="(q) => emit('filter-search', q)"
      @toggle-mode="emit('toggle-mode')"
      @toggle-stats="emit('toggle-stats')"
      @toggle-drawing="emit('toggle-drawing')"
      @export-json="emit('export-json')"
      @export-pdf="emit('export-pdf')"
      @import-json="emit('import-json')"
      @import-text="emit('import-text')"
      @import-pdf="emit('import-pdf')"
    />
    <div class="workspace-body flex flex-1 min-h-0">
      <button
        v-if="isNarrowScreen && !sidebarCollapsed"
        type="button"
        class="workspace-sidebar-backdrop"
        aria-label="关闭题目侧栏"
        @click="sidebarCollapsed = true"
      />
      <AppSidebar
        :collapsed="sidebarCollapsed"
        :notebook-name="notebookName"
        :entries="entries"
        :question-groups="questionGroups"
        :filtered-entries="filteredEntries"
        :active-id="activeId"
        :active-subject="activeSubject"
        :active-tag="activeTag"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        :subject-map="subjectMap"
        :tag-map="tagMap"
        :active-mastery="activeMastery"
        :mastery-map="masteryMap"
        :selected-ids="selectedIds"
        :selected-count="selectedCount"
        :all-subjects="allSubjects"
        :all-tags="allTags"
        :all-sources="allSources"
        :all-folders="allFolders"
        :active-source="activeSource"
        :source-map="sourceMap"
        :active-folder="activeFolder"
        :installed-plugin-ids="installedPluginIds"
        :available-plugins="availablePlugins"
        @return-to-agent="emit('return-to-agent')"
        @select="selectEntry"
        @filter-subject="(s) => emit('filter-subject', s)"
        @filter-tag="(t) => emit('filter-tag', t)"
        @filter-source="(s) => emit('filter-source', s)"
        @filter-folder="(folder) => emit('filter-folder', folder)"
        @filter-mastery="(l) => emit('filter-mastery', l)"
        @quick-create="(s) => emit('quick-create', s)"
        @rename="(id, title) => emit('rename', id, title)"
        @set-sort="(key, dir) => emit('set-sort', key, dir)"
        @reorder="(ids) => emit('reorder', ids)"
        @toggle-select="(id) => emit('toggle-select', id)"
        @range-select="(ids, from, to) => emit('range-select', ids, from, to)"
        @select-all="(ids) => emit('select-all', ids)"
        @deselect-all="emit('deselect-all')"
        @add-subject="(name, global) => emit('add-subject', name, global)"
        @add-tag="(name, global) => emit('add-tag', name, global)"
        @add-source="(name, global) => emit('add-source', name, global)"
        @rename-subject="(oldName, newName) => emit('rename-subject', oldName, newName)"
        @delete-subject="(name) => emit('delete-subject', name)"
        @rename-tag="(oldName, newName) => emit('rename-tag', oldName, newName)"
        @delete-tag="(name) => emit('delete-tag', name)"
        @rename-source="(oldName, newName) => emit('rename-source', oldName, newName)"
        @delete-source="(name) => emit('delete-source', name)"
        @add-folder="(name) => emit('add-folder', name)"
        @rename-folder="(oldName, newName) => emit('rename-folder', oldName, newName)"
        @delete-folder="(name) => emit('delete-folder', name)"
        @move-selected-to-folder="(folder) => emit('move-selected-to-folder', folder)"
        @batch-delete="emit('batch-delete')"
        @batch-tag="(tags) => emit('batch-tag', tags)"
        @batch-export="emit('batch-export')"
        @toggle-settings="emit('toggle-settings')"
        @open-plugin="(pluginId) => emit('open-plugin', pluginId)"
        @manage-plugins="emit('manage-plugins')"
      />

      <main class="workspace-main flex-1 flex flex-col min-w-0">
        <header v-if="mode === 'edit' && activeEntry" class="entry-context-header">
          <div class="entry-context-title">
            <h1 :title="activeEntry.title">{{ activeEntry.title || '未命名错题' }}</h1>
          </div>
          <div class="entry-context-actions">
            <EntrySaveStatus
              :dirty="isDirty"
              :saving="!!entrySaving"
              :error="entrySaveError || ''"
              @save="emit('save')"
            />
            <div class="entry-local-tools" role="group" aria-label="当前题目操作">
              <button
                type="button"
                :aria-pressed="drawingEnabled"
                aria-label="切换画笔模式"
                :title="drawingEnabled ? '关闭画笔，返回文字编辑' : '开启画笔 / 橡皮'"
                @click="emit('toggle-drawing')"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="上一题"
                title="上一题 (Ctrl+←)"
                :disabled="!canGoPrev"
                @click="emit('prev')"
              >
                ‹
              </button>
              <span v-if="entryPosition" class="entry-position"
                >{{ entryPosition }} / {{ filteredEntries.length }}</span
              >
              <button
                type="button"
                aria-label="下一题"
                title="下一题 (Ctrl+→)"
                :disabled="!canGoNext"
                @click="emit('next')"
              >
                ›
              </button>
            </div>
          </div>
        </header>
        <div ref="mainArea" class="flex-1 flex flex-col min-h-0 canvas-host" @wheel="onWheel">
          <p
            v-if="searchLoading || searchError"
            class="px-4 py-2 text-xs text-gray-500 dark:text-brand-mid"
            role="status"
            aria-live="polite"
          >
            {{ searchLoading ? '正在搜索全部题目…' : searchError }}
          </p>
          <div
            v-if="contentLoading || contentError"
            data-testid="entry-loading-state"
            class="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-500 dark:text-brand-mid"
            role="status"
            aria-live="polite"
          >
            <p>
              {{
                contentLoading
                  ? listLoading
                    ? '正在加载题目列表…'
                    : '正在加载题目…'
                  : contentError
              }}
            </p>
            <button
              v-if="contentError && !contentLoading"
              class="rounded-lg bg-accent px-4 py-2 text-white"
              @click="retryContent"
            >
              重试加载
            </button>
          </div>
          <div v-else-if="mode === 'edit' && activeEntry" class="flex-1 flex flex-row min-h-0">
            <NoteEditor
              class="flex-1 min-w-0"
              :entry="activeEntry"
              :group="activeGroup"
              :group-entries="activeGroupEntries"
              :entries="entries"
              :answers-hidden="answersHidden"
              :is-dirty="isDirty"
              :bundle-starting="bundleStarting"
              :bundle-start-error="bundleStartError"
              :all-subjects="allSubjects"
              :all-tags="allTags"
              :all-sources="allSources"
              @update="emit('mark-dirty')"
              @enable-question-group="emit('enable-question-group')"
              @add-sub-question="emit('add-sub-question')"
              @select-sub-question="(id) => emit('select', id)"
              @open-entry="(id) => emit('select', id)"
              @blur-save="emit('blur-save')"
              @start-review-bundle="emit('start-review-bundle', $event)"
              @reveal="emit('reveal')"
              @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
              @add-tag="(name, global) => emit('add-tag', name, global)"
            />
            <!-- <AiChatSidebar :entry="activeEntry" /> -->
          </div>

          <ReviewPanel
            v-else-if="mode === 'review'"
            :entry="currentCard!"
            :group="reviewGroup"
            :answered="answered"
            :submitting="reviewSaving"
            :grading-attempt="gradingAttempt"
            :grading-error="gradingError"
            :grading-locked="gradingLocked"
            :elapsed-ms="elapsedMs"
            :progress="progress"
            :progress-percent="progressPercent"
            :due-count="dueCount"
            :reviewed-today="reviewedToday"
            :is-reviewing="isReviewing"
            :session-done="sessionDone"
            :session-records="sessionRecords"
            :total-session-ms="totalSessionMs"
            :review-queue="reviewQueue"
            :entries="entries"
            @reveal="emit('reveal')"
            @rate="(r, note, outcome) => emit('rate-card', r, note, outcome)"
            @outcome-change="emit('review-outcome', $event)"
            @explain="emit('explain-review', $event)"
            @next-review="emit('next-graded-card')"
            @retry-grading="emit('retry-grading')"
            @start-review="(force: boolean) => emit('start-review', force)"
            @exit-review="emit('exit-review')"
            @dismiss-summary="emit('dismiss-summary')"
            @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
          />

          <div
            v-else
            class="workspace-empty flex-1 flex flex-col items-center justify-center gap-4 bg-gray-50/50 dark:bg-[#141413]/50"
          >
            <div
              class="w-24 h-24 rounded-full bg-accent/10 dark:bg-accent/20 flex items-center justify-center text-accent"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h2 class="text-lg font-bold text-gray-700 dark:text-brand-light-gray">
              {{
                entries.length
                  ? filteredEntries.length
                    ? '选择一道错题开始查看'
                    : '没有找到匹配的错题'
                  : '记录第一道错题'
              }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-brand-mid">
              {{
                entries.length
                  ? filteredEntries.length
                    ? '从左侧列表选择题目，查看材料、答案和复习记录。'
                    : '试试其他关键词，或清除当前筛选条件。'
                  : '输入题目或粘贴图片，逐步整理你的知识盲点。'
              }}
            </p>
            <button
              v-if="!entries.length"
              type="button"
              class="btn-primary rounded-lg bg-accent px-4 py-2 text-sm text-white"
              @click="emit('quick-create', '')"
            >
              新建错题
            </button>
            <button
              v-else-if="filteredEntries.length"
              type="button"
              class="btn-primary rounded-lg bg-accent px-4 py-2 text-sm text-white"
              @click="selectEntry(filteredEntries[0]!.id)"
            >
              查看第一道题
            </button>
            <button
              v-else
              type="button"
              class="btn-primary rounded-lg bg-accent px-4 py-2 text-sm text-white"
              @click="clearSearchAndFilters"
            >
              清除搜索与筛选
            </button>
          </div>
        </div>

        <!-- Floating drawing toolbar -->
        <div
          v-if="drawingEnabled"
          class="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-white/90 dark:bg-[#141413]/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100 dark:border-[#2e2e2c] px-2.5 py-2"
        >
          <span
            v-if="mode === 'review'"
            data-testid="review-drawing-temporary"
            class="whitespace-nowrap rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
            title="复习模式中的画笔内容在切题或退出后自动丢弃"
          >
            临时笔迹 · 不保存
          </span>
          <div v-if="mode === 'review'" class="h-4 w-px bg-gray-200 dark:bg-[#2e2e2c]" />
          <button
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
            :class="
              activeTool === 'pen'
                ? 'bg-accent/10 text-accent ring-1 ring-accent/40'
                : 'text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray'
            "
            type="button"
            :aria-pressed="activeTool === 'pen'"
            title="使用画笔"
            @click="emit('set-tool', 'pen')"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            笔
          </button>

          <div class="w-px h-4 bg-gray-200" />
          <button
            v-for="c in PEN_COLORS"
            :key="c.code"
            type="button"
            :aria-label="`${c.name}色画笔`"
            :aria-pressed="penColor === c.code && activeTool === 'pen'"
            class="w-6 h-6 rounded-full transition-all duration-200 ease-out active:scale-90 border-2 flex-shrink-0 flex items-center justify-center"
            :class="
              penColor === c.code && activeTool === 'pen'
                ? 'border-white dark:border-[#141413] ring-2 ring-accent ring-offset-1 ring-offset-white dark:ring-offset-[#141413] scale-110'
                : 'border-transparent hover:scale-105'
            "
            :style="{ backgroundColor: c.code }"
            :title="c.name"
            @click="emit('set-color', c.code)"
          >
            <svg
              v-if="penColor === c.code && activeTool === 'pen'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-white drop-shadow"
              aria-hidden="true"
            >
              <path d="m5 12 4 4 10-10" />
            </svg>
          </button>

          <div class="w-px h-4 bg-gray-200" />
          <button
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
            :class="
              activeTool === 'eraser'
                ? 'bg-accent/10 text-accent ring-1 ring-accent/40'
                : 'text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray'
            "
            type="button"
            :aria-pressed="activeTool === 'eraser'"
            title="使用橡皮"
            @click="emit('set-tool', 'eraser')"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0L21 5.2c.8.8.8 2 0 2.8L12 17"
              />
              <line x1="6" y1="20" x2="11" y2="20" />
            </svg>
            橡皮
          </button>

          <div class="w-px h-4 bg-gray-200" />
          <div class="flex items-center gap-1.5">
            <input
              type="range"
              :aria-label="activeTool === 'pen' ? '画笔粗细' : '橡皮大小'"
              :min="1"
              :max="activeTool === 'pen' ? 12 : 48"
              :value="activeTool === 'pen' ? penSize : eraserSize"
              class="w-16 h-1 bg-gray-200 dark:bg-[#2e2e2c] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
              @input="
                (e: Event) => {
                  const v = parseInt((e.target as HTMLInputElement).value)
                  activeTool === 'pen' ? emit('set-pen-size', v) : emit('set-eraser-size', v)
                }
              "
            />
            <span
              class="text-[11px] text-gray-400 dark:text-brand-mid w-5 text-right tabular-nums"
              >{{ activeTool === 'pen' ? penSize : eraserSize }}</span
            >
          </div>

          <div class="w-px h-4 bg-gray-200" />
          <button
            class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
            :class="
              canUndo
                ? 'text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#1e1e1c]'
                : 'text-gray-300 dark:text-[#4a4a48] cursor-default'
            "
            :disabled="!canUndo"
            @click="emit('undo')"
            title="撤销 Ctrl+Z"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
            :class="
              canRedo
                ? 'text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#1e1e1c]'
                : 'text-gray-300 dark:text-[#4a4a48] cursor-default'
            "
            :disabled="!canRedo"
            @click="emit('redo')"
            title="重做 Ctrl+Y"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
            </svg>
          </button>
          <div class="w-px h-4 bg-gray-200" />
          <button
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900 dark:bg-red-950 transition-all duration-200 ease-out active:scale-95 font-medium"
            @click="emit('clear-canvas')"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            清除
          </button>
        </div>
      </main>
    </div>

    <DeleteModal
      :visible="showDeleteModal"
      @confirm="emit('confirm-delete')"
      @cancel="emit('close-delete-modal')"
    />

    <DeleteModal
      :visible="showBatchDeleteConfirm"
      :count="selectedCount"
      @cancel="emit('cancel-batch-delete')"
      @confirm="emit('confirm-batch-delete')"
    />

    <UnsavedModal
      :visible="showUnsavedModal"
      :require-save="requireSaveBeforeClose"
      :busy="entrySaving"
      :error="entrySaveError"
      @save="emit('save-and-proceed')"
      @discard="emit('discard-and-proceed')"
      @cancel="emit('cancel-proceed')"
    />

    <Transition name="stats">
      <StatsPanel
        v-if="statsOpen"
        :stats="stats"
        :load-entries-content="loadEntriesContent"
        @close="emit('toggle-stats')"
      />
    </Transition>
  </div>
</template>
