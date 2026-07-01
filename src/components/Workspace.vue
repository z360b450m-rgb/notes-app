<script setup lang="ts">
// @AI-NOTE: 工作区布局组件 —— 仅编排子组件布局。数据通过 props/events
// 委托给 App.vue, 禁止直接操作存储或编写业务逻辑。
import { ref } from 'vue'
import type { NoteEntry } from '@/types'
import type { SortKey, SortDir } from '@/composables/useFilter'
import type { StatsState } from '@/composables/useStats'
import type { SessionRecord } from '@/composables/useReview'
import { PEN_COLORS } from '@/composables/useDrawing'
import AppSidebar from './AppSidebar.vue'
import AppToolbar from './AppToolbar.vue'
import NoteEditor from './NoteEditor.vue'
// import AiChatSidebar from './AiChatSidebar.vue'
import ReviewPanel from './ReviewPanel.vue'
import DeleteModal from './DeleteModal.vue'
import StatsPanel from './StatsPanel.vue'
import UnsavedModal from './UnsavedModal.vue'

const props = defineProps<{
  notebookName: string
  entries: NoteEntry[]
  filteredEntries: NoteEntry[]
  activeId: string | null
  activeEntry: NoteEntry | null | undefined
  answersHidden: boolean
  isDirty: boolean
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
  canUndo: boolean
  canRedo: boolean
  showDeleteModal: boolean
  showBatchDeleteConfirm: boolean
  showUnsavedModal: boolean
  statsOpen: boolean
  settingsOpen: boolean
  stats: StatsState
  isElectron: boolean
  isDark: boolean
  currentCard: NoteEntry | null | undefined
  answered: boolean
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
  activeMastery: string
  allSubjects: string[]
  allTags: string[]
  allSources: string[]
}>()

const emit = defineEmits<{
  // Notebook
  'return-to-menu': []

  // Entry selection
  select: [id: string]

  // Filters
  'filter-subject': [subject: string]
  'filter-tag': [tag: string | null]
  'filter-source': [source: string | null]
  'filter-mastery': [label: string]
  'filter-search': [query: string]

  // Sort & Reorder
  'set-sort': [key: SortKey, dir?: SortDir]
  reorder: [ids: string[]]

  // Entry actions
  'quick-create': [subject: string]
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
  'exit-review': []
  'toggle-mode': []
  reveal: []
  'rate-card': [r: number | string, note: string]
  'dismiss-summary': []

  // Drawing
  'toggle-drawing': []
  'set-tool': [tool: string]
  'set-color': [color: string]
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

  // Unsaved modal
  'save-and-proceed': []
  'discard-and-proceed': []
  'cancel-proceed': []
}>()

const mainArea = ref<HTMLElement | null>(null)
let lastWheelNav = 0

function onWheel(e: WheelEvent) {
  if (props.mode !== 'edit' || !props.activeId) return

  // Only allow wheel navigation from answer panels, not question area
  const inAnswer = (e.target as HTMLElement).closest('.answer-panel')
  if (!inAnswer) return

  const scrollable = (e.target as HTMLElement).closest('.overflow-y-auto')
  if (scrollable) {
    const el = scrollable as HTMLElement
    const atTop = el.scrollTop <= 1
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return
  }

  const now = Date.now()
  if (now - lastWheelNav < 250) return
  lastWheelNav = now

  emit('wheel-nav', e.deltaY > 0 ? 1 : -1)
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="flex h-screen bg-white dark:bg-[#141413]">
    <AppSidebar
      :notebook-name="notebookName"
      :entries="entries"
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
      :due-count="dueCount"
      :mode="mode"
      :selected-ids="selectedIds"
      :selected-count="selectedCount"
      :all-subjects="allSubjects"
      :all-tags="allTags"
      :all-sources="allSources"
      :active-source="activeSource"
      :source-map="sourceMap"
      @return-to-menu="emit('return-to-menu')"
      @select="(id) => emit('select', id)"
      @filter-subject="(s) => emit('filter-subject', s)"
      @filter-tag="(t) => emit('filter-tag', t)"
      @filter-source="(s) => emit('filter-source', s)"
      @filter-mastery="(l) => emit('filter-mastery', l)"
      @quick-create="(s) => emit('quick-create', s)"
      @rename="(id, title) => emit('rename', id, title)"
      @start-review="emit('start-review', false)"
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
      @batch-delete="emit('batch-delete')"
      @batch-tag="(tags) => emit('batch-tag', tags)"
      @batch-export="emit('batch-export')"
      @toggle-settings="emit('toggle-settings')"
    />

    <main class="flex-1 flex flex-col min-w-0">
      <AppToolbar
        :active-id="activeId"
        :answers-hidden="answersHidden"
        :can-go-prev="canGoPrev"
        :can-go-next="canGoNext"
        :search-query="searchQuery"
        :mode="mode"
        :due-count="dueCount"
        :progress="progress"
        :drawing-enabled="drawingEnabled"
        :stats-open="statsOpen"
        :is-dirty="isDirty"
        @new="emit('quick-create', '')"
        @save="emit('save')"
        @reveal="emit('reveal')"
        @delete="emit('delete')"
        @prev="emit('prev')"
        @next="emit('next')"
        @search="(q) => emit('filter-search', q)"
        @toggle-mode="emit('toggle-mode')"
        @toggle-drawing="emit('toggle-drawing')"
        @toggle-stats="emit('toggle-stats')"
        @export-json="emit('export-json')"
        @export-pdf="emit('export-pdf')"
        @import-json="emit('import-json')"
        @import-text="emit('import-text')"
        @import-pdf="emit('import-pdf')"
      />

      <div ref="mainArea" class="flex-1 flex flex-col min-h-0 canvas-host" @wheel="onWheel">
        <div v-if="mode === 'edit' && activeEntry" class="flex-1 flex flex-row min-h-0">
          <NoteEditor
            class="flex-1 min-w-0"
            :entry="activeEntry"
            :answers-hidden="answersHidden"
            :all-subjects="allSubjects"
            :all-tags="allTags"
            :all-sources="allSources"
            @update="emit('mark-dirty')"
            @blur-save="emit('blur-save')"
            @reveal="emit('reveal')"
            @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
            @add-tag="(name, global) => emit('add-tag', name, global)"
          />
          <!-- <AiChatSidebar :entry="activeEntry" /> -->
        </div>

        <ReviewPanel
          v-else-if="mode === 'review'"
          :entry="currentCard!"
          :answered="answered"
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
          @reveal="emit('reveal')"
          @rate="(r, note) => emit('rate-card', r, note)"
          @start-review="(force: boolean) => emit('start-review', force)"
          @exit-review="emit('exit-review')"
          @dismiss-summary="emit('dismiss-summary')"
          @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
        />

        <div
          v-else
          class="flex-1 flex flex-col items-center justify-center gap-4 bg-gray-50/50 dark:bg-[#141413]/50"
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
            开始记录你的知识盲点
          </h2>
          <p class="text-sm text-gray-500 dark:text-brand-mid">
            Ctrl+N 快速新建 · 支持 Markdown · 可直接粘贴图片
          </p>
        </div>
      </div>

      <!-- Floating drawing toolbar -->
      <div
        v-if="drawingEnabled"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-white/90 dark:bg-[#141413]/90 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100 dark:border-[#2e2e2c] px-2.5 py-2"
      >
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
          :class="
            activeTool === 'pen'
              ? 'bg-gray-100 dark:bg-[#1e1e1c] text-gray-800 dark:text-brand-light'
              : 'text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray'
          "
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
          class="w-6 h-6 rounded-full transition-all duration-200 ease-out active:scale-90 border-2 flex-shrink-0"
          :class="
            penColor === c.code && activeTool === 'pen'
              ? 'border-gray-800 scale-110'
              : 'border-transparent hover:scale-105'
          "
          :style="{ backgroundColor: c.code }"
          :title="c.name"
          @click="emit('set-color', c.code)"
        />

        <div class="w-px h-4 bg-gray-200" />
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-95"
          :class="
            activeTool === 'eraser'
              ? 'bg-gray-100 dark:bg-[#1e1e1c] text-gray-800 dark:text-brand-light'
              : 'text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray'
          "
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

    <DeleteModal
      :visible="showDeleteModal"
      @confirm="emit('confirm-delete')"
      @cancel="emit('close-delete-modal')"
    />

    <!-- Batch delete confirmation -->
    <div v-if="showBatchDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/30" @click="emit('cancel-batch-delete')" />
      <div
        class="relative bg-white dark:bg-[#141413] rounded-xl shadow-2xl border border-gray-100 dark:border-[#2e2e2c] p-6 w-[360px] max-w-[90vw]"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              stroke-width="2.5"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </div>
          <div>
            <h3 class="text-[15px] font-bold text-gray-800 dark:text-brand-light">批量删除</h3>
            <p class="text-[12px] text-gray-500 dark:text-brand-mid mt-0.5">
              确定要删除选中的 {{ selectedCount }} 条错题吗？此操作不可撤销。
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-100 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="emit('cancel-batch-delete')"
          >
            取消
          </button>
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 transition-all duration-200 ease-out active:scale-95"
            @click="emit('confirm-batch-delete')"
          >
            删除 {{ selectedCount }} 条
          </button>
        </div>
      </div>
    </div>

    <UnsavedModal
      :visible="showUnsavedModal"
      @save="emit('save-and-proceed')"
      @discard="emit('discard-and-proceed')"
      @cancel="emit('cancel-proceed')"
    />

    <Transition name="stats">
      <StatsPanel v-if="statsOpen" :stats="stats" @close="emit('toggle-stats')" />
    </Transition>
  </div>
</template>
