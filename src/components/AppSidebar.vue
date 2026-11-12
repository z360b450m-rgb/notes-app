<script setup lang="ts">
import SidebarAnchorIcon from './SidebarAnchorIcon.vue'
import FilterItemRow from './FilterItemRow.vue'
import ActionMenu from './ActionMenu.vue'
import UiModal from './UiModal.vue'
import MetadataSelect from './MetadataSelect.vue'
import type { ActionMenuAction } from '@/types/ui'
import { useInlineReveal } from '@/composables/useInlineReveal'
import { useSidebarWidth } from '@/composables/useSidebarWidth'
const {
  sidebarWidth,
  resizingSidebar,
  startSidebarResize,
  moveSidebarResize,
  stopSidebarResize,
  resizeSidebarByKey,
} = useSidebarWidth()
const { enterReveal, leaveReveal, clearReveal } = useInlineReveal()

// @AI-NOTE: 侧边栏组件 —— 筛选/排序/条目选择由 useFilter/useEntries
// Hook 驱动。禁止在此实现筛选逻辑或直接操作数据库。
import { ref, nextTick, computed, onUnmounted, watch } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import type { SortKey, SortDir } from '@/composables/useFilter'
import SubjectChips from './SubjectChips.vue'
import TagDots from './TagDots.vue'
import TagMultiSelect from './TagMultiSelect.vue'
import FolderEntryTree from './FolderEntryTree.vue'
import { MASTERY_LEVEL_DEFS } from '@/composables/useStats'
import type { NotebookPluginManifest } from '@/plugins/types'

const props = defineProps<{
  notebookName: string
  collapsed: boolean
  entries: NoteEntry[]
  questionGroups: QuestionGroup[]
  filteredEntries: NoteEntry[]
  activeId: string | null
  activeSubject: string
  activeTag: string | null
  activeMastery: string
  sortKey: SortKey
  sortDir: SortDir
  subjectMap: Record<string, number>
  tagMap: Record<string, number>
  masteryMap: Record<string, number>
  allSubjects: string[]
  allTags: string[]
  allSources: string[]
  activeSource: string | null
  sourceMap: Record<string, number>
  allFolders: string[]
  activeFolder: string | null
  selectedIds: Set<string>
  selectedCount: number
  installedPluginIds: string[]
  availablePlugins: NotebookPluginManifest[]
}>()

const emit = defineEmits<{
  select: [id: string]
  'return-to-agent': []
  filterSubject: [subject: string]
  filterTag: [tag: string]
  filterSource: [source: string | null]
  filterFolder: [folder: string | null]
  filterMastery: [label: string]
  quickCreate: [subject: string]
  rename: [id: string, newTitle: string]
  setSort: [key: SortKey, dir?: SortDir]
  reorder: [orderedIds: string[]]
  'toggle-select': [id: string]
  'range-select': [ids: string[], fromIdx: number, toIdx: number]
  'select-all': [ids: string[]]
  'deselect-all': []
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
  'batch-delete': []
  'batch-tag': [tags: string[]]
  'batch-export': []
  'toggle-settings': []
  'open-plugin': [pluginId: string]
  'manage-plugins': []
}>()

const collapsed = computed(() => props.collapsed)
const hoverExpanded = ref(false)
const hoverClosing = ref(false)
const sidebarCompact = computed(
  () => collapsed.value && !hoverExpanded.value && !hoverClosing.value,
)
let closeAnimationTimer: ReturnType<typeof setTimeout> | undefined
let hoverTimer: ReturnType<typeof setTimeout> | undefined
function enterSidebar() {
  clearTimeout(hoverTimer)
  clearTimeout(closeAnimationTimer)
  if (hoverClosing.value) {
    hoverClosing.value = false
    hoverExpanded.value = true
  }
  if (collapsed.value)
    hoverTimer = setTimeout(() => {
      hoverExpanded.value = true
    }, 160)
}
function leaveSidebar() {
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    if (!hoverExpanded.value) return
    hoverClosing.value = true
    hoverExpanded.value = false
    closeAnimationTimer = setTimeout(() => {
      hoverClosing.value = false
    }, 180)
  }, 100)
}
watch(collapsed, () => {
  clearTimeout(hoverTimer)
  clearTimeout(closeAnimationTimer)
  hoverClosing.value = false
  hoverExpanded.value = false
})
onUnmounted(() => {
  clearTimeout(hoverTimer)
  clearTimeout(closeAnimationTimer)
})
const tagInputOpen = ref(false)
const masteryOpen = ref(false)
const batchSelectedTags = ref<string[]>([])
const sourceSectionOpen = ref(false)
const addingSource = ref(false)
const newSourceName = ref('')
const newSourceGlobal = ref(false)
const newSourceInput = ref<HTMLInputElement | null>(null)

// Source edit/delete state
const editingSource = ref<string | null>(null)
const editSourceValue = ref('')
const editSourceInput = ref<HTMLInputElement | null>(null)
function setEditInput(el: unknown) {
  editSourceInput.value = el instanceof HTMLInputElement ? el : null
}
const deletingSource = ref<string | null>(null)
const filterPanelOpen = ref(false)
const activeFilterCount = computed(
  () =>
    [
      props.activeSubject !== '__all__',
      props.activeTag !== null,
      props.activeSource !== null,
      props.activeMastery !== '__all__',
      props.activeFolder !== null,
    ].filter(Boolean).length,
)
const filterPanelHeight = ref(240)
const {
  enterReveal: enterFilterPanel,
  leaveReveal: leaveFilterPanel,
  clearReveal: clearFilterPanel,
} = useInlineReveal(() => filterPanelHeight.value)
const sidebarEl = ref<HTMLElement | null>(null)
const addingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref<HTMLInputElement | null>(null)
const installedPlugins = computed(() =>
  props.availablePlugins.filter((plugin) => props.installedPluginIds.includes(plugin.id)),
)

function startAddFolder() {
  addingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInput.value?.focus())
}

function confirmAddFolder() {
  const name = newFolderName.value.trim()
  if (name) emit('add-folder', name)
  addingFolder.value = false
}

function cancelAddFolder() {
  addingFolder.value = false
  newFolderName.value = ''
}

let resizeStartY = 0
let resizeStartHeight = 0

function onResizeMove(event: PointerEvent) {
  const sidebarHeight = sidebarEl.value?.clientHeight ?? window.innerHeight
  const maxHeight = Math.max(170, sidebarHeight - 320)
  filterPanelHeight.value = Math.min(
    maxHeight,
    Math.max(130, resizeStartHeight + event.clientY - resizeStartY),
  )
}

function stopResize() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function startResize(event: PointerEvent) {
  if (!filterPanelOpen.value) return
  resizeStartY = event.clientY
  resizeStartHeight = filterPanelHeight.value
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
}

onUnmounted(stopResize)

function startEditSource(name: string) {
  editingSource.value = name
  editSourceValue.value = name
  nextTick(() => editSourceInput.value?.focus())
}

function confirmEditSource() {
  const trimmed = editSourceValue.value.trim()
  if (trimmed && editingSource.value && trimmed !== editingSource.value) {
    emit('rename-source', editingSource.value, trimmed)
  }
  editingSource.value = null
}

function cancelEditSource() {
  editingSource.value = null
}

function startDeleteSource(name: string) {
  deletingSource.value = name
}

function confirmDeleteSource() {
  if (deletingSource.value) {
    emit('delete-source', deletingSource.value)
  }
  deletingSource.value = null
}

function cancelDeleteSource() {
  deletingSource.value = null
}

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'updatedAt', label: '更新时间' },
  { key: 'createdAt', label: '创建时间' },
  { key: 'subject', label: '学科' },
  { key: 'title', label: '标题' },
  { key: 'custom', label: '自定义' },
  { key: 'shuffle', label: '乱序' },
]

function handleSortSelect(key: SortKey) {
  emit('setSort', key)
}

function handleSelectAll() {
  if (props.selectedCount === props.filteredEntries.length && props.selectedCount > 0) {
    emit('deselect-all')
  } else {
    emit(
      'select-all',
      props.filteredEntries.map((e) => e.id),
    )
  }
}

function handleDeselectAll() {
  emit('deselect-all')
}

function handleBatchDelete() {
  emit('batch-delete')
}

function handleBatchExport() {
  emit('batch-export')
}

function openTagInput() {
  batchSelectedTags.value = []
  tagInputOpen.value = true
}

function confirmBatchTags() {
  if (batchSelectedTags.value.length > 0) {
    emit('batch-tag', batchSelectedTags.value)
  }
  tagInputOpen.value = false
  batchSelectedTags.value = []
}

function cancelBatchTags() {
  tagInputOpen.value = false
  batchSelectedTags.value = []
}

function startAddSource() {
  sourceSectionOpen.value = true
  addingSource.value = true
  newSourceName.value = ''
  newSourceGlobal.value = false
  nextTick(() => newSourceInput.value?.focus({ preventScroll: true }))
}

function confirmAddSource() {
  const name = newSourceName.value.trim()
  if (name) emit('add-source', name, newSourceGlobal.value)
  addingSource.value = false
}

function cancelAddSource() {
  addingSource.value = false
}
const batchActions = computed<ActionMenuAction[]>(() => [
  { id: 'deselect', label: '取消选择', icon: 'clear', disabled: !props.selectedCount },
  { id: 'tags', label: '批量标签', icon: 'tag', disabled: !props.selectedCount },
  { id: 'export', label: '批量导出', icon: 'download', disabled: !props.selectedCount },
  {
    id: 'delete',
    label: '批量删除',
    icon: 'delete',
    danger: true,
    separatorBefore: true,
    disabled: !props.selectedCount,
  },
])
function handleBatchAction(id: string) {
  if (id === 'deselect') handleDeselectAll()
  else if (id === 'tags') openTagInput()
  else if (id === 'export') handleBatchExport()
  else if (id === 'delete') handleBatchDelete()
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    class="sidebar-hover-host"
    :class="{ 'is-collapsed': collapsed, 'is-resizing': resizingSidebar }"
    :style="{ '--sidebar-width': `${sidebarWidth}px` }"
    @mouseenter="enterSidebar"
    @mouseleave="leaveSidebar"
  >
    <aside
      ref="sidebarEl"
      class="bg-white dark:bg-[#141413] border-r border-gray-100 dark:border-[#2e2e2c] flex flex-col overflow-hidden transition-[width] duration-300 ease-out"
      :class="[
        collapsed && !hoverExpanded ? 'w-[48px]' : 'w-[280px]',
        { 'sidebar-hover-open': collapsed && hoverExpanded, 'sidebar-hover-closing': hoverClosing },
      ]"
    >
      <!-- Expanded content -->
      <div
        class="sidebar-expanded-content"
        :class="{ 'content-compact': sidebarCompact, 'content-closing': hoverClosing }"
      >
        <div class="sidebar-notebook-row px-4 pt-4">
          <div v-if="notebookName" class="mb-3 flex items-center gap-2">
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium hover:bg-accent/10 transition-colors"
              title="返回 AI 助手"
              @click="emit('return-to-agent')"
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
                <path
                  d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"
                />
              </svg>
              返回 AI 助手
            </button>
            <button
              class="sidebar-filter-toggle ml-auto flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#242422] dark:hover:text-brand-light-gray"
              :title="filterPanelOpen ? '收起筛选面板' : '展开筛选面板'"
              :aria-label="filterPanelOpen ? '收起筛选面板' : '展开筛选面板'"
              :aria-expanded="filterPanelOpen"
              aria-controls="workspace-filters"
              data-testid="toggle-filter-panel"
              @click="filterPanelOpen = !filterPanelOpen"
            >
              <span
                >筛选<span v-if="activeFilterCount"> {{ activeFilterCount }}</span></span
              >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                class="transition-transform duration-200 ease-out motion-reduce:transition-none"
                :class="filterPanelOpen ? '' : 'rotate-180'"
              >
                <polyline points="6 15 12 9 18 15" />
              </svg>
            </button>
          </div>
        </div>

        <Transition
          :css="false"
          @enter="enterFilterPanel"
          @leave="leaveFilterPanel"
          @enter-cancelled="clearFilterPanel"
          @leave-cancelled="clearFilterPanel"
        >
          <div
            id="workspace-filters"
            v-show="filterPanelOpen"
            class="sidebar-filter-content shrink-0 overflow-y-auto px-4 pb-3"
            :style="{ height: `${filterPanelHeight}px` }"
          >
            <div class="sidebar-filter-group">
              <!-- Subject filter -->
              <SubjectChips
                :active-subject="activeSubject"
                :subject-map="subjectMap"
                :all-subjects="allSubjects"
                :all-count="entries.length"
                :none-count="entries.filter((e) => !e.subject).length"
                @filter="emit('filterSubject', $event)"
                @quick-create="emit('quickCreate', $event)"
                @add-subject="(name, global) => emit('add-subject', name, global)"
                @rename-subject="(oldName, newName) => emit('rename-subject', oldName, newName)"
                @delete-subject="(name) => emit('delete-subject', name)"
              />

              <!-- Tag filter -->
              <TagDots
                :active-tag="activeTag"
                :tag-map="tagMap"
                :all-tags="allTags"
                :all-count="entries.length"
                @filter="emit('filterTag', $event)"
                @add-tag="(name, global) => emit('add-tag', name, global)"
                @rename-tag="(oldName, newName) => emit('rename-tag', oldName, newName)"
                @delete-tag="(name) => emit('delete-tag', name)"
              />

              <!-- Source filter -->
              <div class="sidebar-section mb-3.5">
                <div class="filter-section-header flex items-center justify-between mb-1.5">
                  <button
                    class="min-h-10 px-3 py-2 rounded-xl flex items-center gap-2 text-base font-semibold uppercase tracking-[0.5px] text-gray-500 dark:text-brand-mid hover:text-gray-700 dark:hover:text-brand-light-gray transition-colors"
                    :aria-expanded="sourceSectionOpen"
                    @click="sourceSectionOpen = !sourceSectionOpen"
                  >
                    <SidebarAnchorIcon kind="source" />
                    来源
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      class="transition-transform duration-200"
                      :class="sourceSectionOpen ? 'rotate-180' : ''"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <button
                    class="w-6 h-6 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-accent dark:hover:text-accent hover:bg-accent/10 transition-colors"
                    title="新建来源"
                    @click="startAddSource()"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                <div class="section-collapse" :class="{ active: sourceSectionOpen }">
                  <div class="section-collapse-inner">
                    <!-- Inline input for new source -->
                    <Transition
                      :css="false"
                      @enter="enterReveal"
                      @leave="leaveReveal"
                      @enter-cancelled="clearReveal"
                      @leave-cancelled="clearReveal"
                      ><div v-if="addingSource" class="mb-1.5 space-y-1.5">
                        <input
                          ref="newSourceInput"
                          v-model="newSourceName"
                          type="text"
                          class="w-full text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                          placeholder="新来源名称"
                          @keydown.enter="confirmAddSource()"
                          @keydown.escape="cancelAddSource()"
                        />
                        <div class="flex items-center justify-end gap-1">
                          <button
                            class="text-xs px-2 py-1.5 rounded-l-md border border-accent bg-accent text-white hover:brightness-110 transition-colors flex-shrink-0"
                            @click="confirmAddSource()"
                          >
                            确定
                          </button>
                          <button
                            class="text-xs px-2 py-1.5 rounded-r-md border border-l-0 border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                            @click="cancelAddSource()"
                          >
                            取消
                          </button>
                        </div>
                        <label
                          class="flex items-center gap-1 text-xs text-gray-500 dark:text-brand-mid cursor-pointer select-none"
                        >
                          <input
                            v-model="newSourceGlobal"
                            type="checkbox"
                            class="w-3.5 h-3.5 rounded accent-accent"
                          />
                          应用于所有错题本
                        </label>
                      </div></Transition
                    >
                    <div class="filter-item-list">
                      <FilterItemRow
                        label="全部"
                        :count="entries.length"
                        :selected="!activeSource"
                        @select="emit('filterSource', '__all__')"
                      />
                      <template v-if="allSources.length === 0">
                        <span class="text-xs text-gray-500 dark:text-brand-mid">暂无来源</span>
                      </template>
                      <template v-for="source in allSources" :key="source">
                        <!-- Inline edit mode -->
                        <span
                          v-if="editingSource === source"
                          class="inline-flex items-center gap-1"
                        >
                          <input
                            :ref="setEditInput"
                            v-model="editSourceValue"
                            type="text"
                            class="text-sm px-3 py-1.5 rounded-md border border-accent bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light w-28 focus:ring-2 focus:ring-accent/20 transition-all"
                            @keydown.enter="confirmEditSource()"
                            @keydown.escape="cancelEditSource()"
                          />
                          <button
                            class="text-xs px-1.5 py-1.5 rounded bg-accent text-white hover:bg-accent/90 transition-colors flex-shrink-0"
                            @click="confirmEditSource()"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                            >
                              <path
                                :d="
                                  selectedCount > 0 && selectedCount < filteredEntries.length
                                    ? 'M4 12h16'
                                    : 'm4 12 5 5L20 6'
                                "
                              />
                            </svg>
                          </button>
                          <button
                            class="text-xs px-1.5 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                            @click="cancelEditSource()"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </span>

                        <!-- Delete confirmation -->
                        <span
                          v-else-if="deletingSource === source"
                          class="inline-flex items-center gap-1"
                        >
                          <span class="text-xs text-red-500 dark:text-red-400 px-1"
                            >删除 "{{ source }}" ({{ sourceMap[source] || 0 }} 条)?</span
                          >
                          <button
                            class="text-xs px-1.5 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors flex-shrink-0"
                            @click="confirmDeleteSource()"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button
                            class="text-xs px-1.5 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                            @click="cancelDeleteSource()"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="3"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </span>

                        <FilterItemRow
                          v-else
                          :label="source"
                          :count="sourceMap[source] || 0"
                          :selected="activeSource === source"
                          manageable
                          @select="emit('filterSource', activeSource === source ? null : source)"
                          @edit="startEditSource(source)"
                          @delete="startDeleteSource(source)"
                        />
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Mastery filter -->
              <div class="sidebar-section">
                <div class="filter-section-header flex items-center mb-1.5">
                  <button
                    class="min-h-10 px-3 py-2 rounded-xl flex items-center gap-2 text-base font-semibold uppercase tracking-[0.5px] text-gray-500 dark:text-brand-mid hover:text-gray-700 dark:hover:text-brand-light-gray transition-colors"
                    :aria-expanded="masteryOpen"
                    @click="masteryOpen = !masteryOpen"
                  >
                    <SidebarAnchorIcon kind="mastery" />
                    掌握程度
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      class="transition-transform duration-200"
                      :class="masteryOpen ? 'rotate-180' : ''"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
                <div class="section-collapse" :class="{ active: masteryOpen }">
                  <div class="section-collapse-inner">
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        v-for="b in MASTERY_LEVEL_DEFS"
                        :key="b.label"
                        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 ease-out active:scale-95"
                        :class="
                          activeMastery === b.label
                            ? 'text-white shadow-sm'
                            : 'bg-brand-light-gray dark:bg-[#2a2a28] text-brand-dark dark:text-brand-light-gray hover:ring-1'
                        "
                        :style="{
                          backgroundColor: activeMastery === b.label ? b.color : undefined,
                          ['--ring-color' as any]: b.color,
                        }"
                        @mouseenter="
                          (e: MouseEvent) => {
                            if (activeMastery !== b.label)
                              (e.target as HTMLElement).style.boxShadow = `0 0 0 1px ${b.color}40`
                          }
                        "
                        @mouseleave="
                          (e: MouseEvent) => {
                            if (activeMastery !== b.label)
                              (e.target as HTMLElement).style.boxShadow = ''
                          }
                        "
                        @click="emit('filterMastery', b.label)"
                      >
                        <span
                          class="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-200"
                          :class="activeMastery === b.label ? 'bg-white' : ''"
                          :style="{
                            backgroundColor: activeMastery === b.label ? undefined : b.color,
                          }"
                        />
                        {{ b.label }} ({{ masteryMap[b.label] || 0 }})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
        <Transition
          :css="false"
          @enter="enterReveal"
          @leave="leaveReveal"
          @enter-cancelled="clearReveal"
          @leave-cancelled="clearReveal"
        >
          <div
            v-if="filterPanelOpen"
            class="group relative h-4 shrink-0 cursor-row-resize bg-transparent"
            title="拖动调整上下区域大小"
            data-testid="sidebar-resizer"
            @pointerdown.prevent="startResize"
          >
            <span
              class="pointer-events-none absolute inset-x-4 top-1/2 h-px bg-gray-300/50 dark:bg-[#444440]"
            />
            <span
              class="absolute left-1/2 top-1/2 h-0.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400/40 transition-[width,background-color] duration-150 group-hover:w-10 group-hover:bg-accent/70 group-active:bg-accent dark:bg-[#686860] dark:group-hover:bg-accent/70"
            />
          </div>
        </Transition>
        <!-- Entry list -->
        <div class="sidebar-list-heading">
          <strong :title="notebookName">{{
            notebookName ? `错题本：${notebookName}` : '错题'
          }}</strong
          ><span>{{ filteredEntries.length }} 道</span
          ><button
            v-if="activeFilterCount && !filterPanelOpen"
            type="button"
            @click="filterPanelOpen = true"
          >
            {{ activeFilterCount }} 项筛选生效中
          </button>
        </div>
        <div class="sidebar-entry-list flex-1 min-h-0 overflow-y-auto">
          <div
            class="button-tray sidebar-action-tray px-4 py-2.5 text-[11px] text-gray-400 dark:text-brand-mid font-semibold uppercase tracking-[0.5px] flex justify-between items-center"
          >
            <!-- Select all + Batch dropdown -->
            <div class="sidebar-action-cluster flex items-center gap-2">
              <button
                class="sidebar-select-all w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0"
                role="checkbox"
                :aria-checked="
                  selectedCount > 0 && selectedCount === filteredEntries.length
                    ? true
                    : selectedCount > 0
                      ? 'mixed'
                      : false
                "
                aria-label="全选题目"
                title="全选"
                @click="handleSelectAll"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  :stroke-width="selectedCount > 0 ? 3 : 2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>

              <ActionMenu
                label="批量管理"
                :actions="batchActions"
                trigger-class="sidebar-batch-toggle"
                align="start"
                @select="handleBatchAction"
              >
                <template #trigger>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    aria-hidden="true"
                  >
                    <path d="m3 6 1 1 2-2M9 6h12M3 12h3M9 12h12M3 18h3M9 18h12" />
                  </svg>
                  <span v-if="selectedCount" class="ui-batch-count">{{ selectedCount }}</span>
                </template>
              </ActionMenu>

              <button
                class="sidebar-folder-create flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-accent/10 hover:text-accent"
                title="新建文件夹"
                data-testid="add-folder"
                @click="startAddFolder"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
                  />
                  <path d="M12 11v6M9 14h6" />
                </svg>
              </button>
            </div>

            <!-- Sort selector -->
            <div class="sidebar-sort-controls">
              <MetadataSelect
                label="排序方式"
                :model-value="sortKey"
                :clearable="false"
                :options="sortOptions.map((option) => ({ value: option.key, label: option.label }))"
                @update:model-value="handleSortSelect"
              />
              <button
                type="button"
                class="ui-button ui-icon-button"
                data-variant="text"
                :aria-label="
                  sortKey === 'shuffle'
                    ? '重新打乱顺序'
                    : sortDir === 'asc'
                      ? '改为降序'
                      : '改为升序'
                "
                :title="
                  sortKey === 'shuffle'
                    ? '重新打乱顺序'
                    : sortDir === 'asc'
                      ? '当前升序，点击改为降序'
                      : '当前降序，点击改为升序'
                "
                @click="emit('setSort', sortKey)"
              >
                {{ sortKey === 'shuffle' ? '⤨' : sortDir === 'asc' ? '↑' : '↓' }}
              </button>
            </div>
          </div>

          <div v-if="addingFolder" class="mx-3 mb-2 flex items-center gap-1.5">
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              class="min-w-0 flex-1 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-[12px] text-gray-700 outline-none ring-2 ring-accent/10 dark:bg-[#141413] dark:text-brand-light"
              placeholder="文件夹名称"
              data-testid="folder-name-input"
              @keydown.enter="confirmAddFolder"
              @keydown.escape="cancelAddFolder"
            />
            <button
              type="button"
              class="shrink-0 whitespace-nowrap rounded-md bg-accent px-2 py-1.5 text-[11px] text-white"
              @click="confirmAddFolder"
            >
              创建
            </button>
            <button
              type="button"
              class="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:text-brand-mid dark:hover:bg-[#242422]"
              @click="cancelAddFolder"
            >
              取消
            </button>
          </div>

          <FolderEntryTree
            :entries="filteredEntries"
            :folders="allFolders"
            :question-groups="questionGroups"
            :active-id="activeId"
            :active-folder="activeFolder"
            :sort-key="sortKey"
            :selected-ids="selectedIds"
            :selected-count="selectedCount"
            @select="emit('select', $event)"
            @select-folder="emit('filterFolder', $event ?? '__none__')"
            @rename-entry="(id, title) => emit('rename', id, title)"
            @reorder="emit('reorder', $event)"
            @toggle-select="emit('toggle-select', $event)"
            @range-select="(ids, from, to) => emit('range-select', ids, from, to)"
            @rename-folder="(oldName, newName) => emit('rename-folder', oldName, newName)"
            @delete-folder="emit('delete-folder', $event)"
            @move-selected="emit('move-selected-to-folder', $event)"
          />
        </div>

        <!-- Installed notebook features -->
        <div class="sidebar-features px-4 pt-3 border-t border-gray-100 dark:border-[#2e2e2c]">
          <button
            v-for="plugin in installedPlugins"
            :key="plugin.id"
            class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[13px] text-brand-mid dark:text-brand-mid hover:text-brand-dark dark:hover:text-brand-light-gray hover:bg-brand-light-gray dark:hover:bg-[#2a2a28] transition-colors"
            @click="emit('open-plugin', plugin.id)"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
              <path d="M4 5.5v16M8 7h8M8 11h8" />
            </svg>
            {{ plugin.name }}
          </button>
          <button
            class="sidebar-footer-action w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[13px] text-brand-mid dark:text-brand-mid hover:text-brand-dark dark:hover:text-brand-light-gray hover:bg-brand-light-gray dark:hover:bg-[#2a2a28] transition-colors"
            @click="emit('manage-plugins')"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加功能
          </button>
        </div>

        <!-- Settings -->
        <div class="sidebar-settings px-4 py-3 border-t border-gray-100 dark:border-[#2e2e2c]">
          <button
            class="sidebar-footer-action w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[13px] text-brand-mid dark:text-brand-mid hover:text-brand-dark dark:hover:text-brand-light-gray hover:bg-brand-light-gray dark:hover:bg-[#2a2a28] transition-colors"
            data-testid="settings-toggle"
            @click="emit('toggle-settings')"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            设置
          </button>
        </div>
      </div>
      <UiModal
        :visible="tagInputOpen"
        title="批量添加标签"
        :description="`为已选的 ${selectedCount} 道错题添加标签。`"
        @cancel="cancelBatchTags"
      >
        <div class="ui-batch-tag-picker">
          <TagMultiSelect
            v-model="batchSelectedTags"
            :all-tags="allTags"
            @add-tag="(name) => emit('add-tag', name)"
          />
        </div>
        <template #actions>
          <button type="button" class="ui-button" data-dialog-cancel @click="cancelBatchTags">
            取消
          </button>
          <button
            type="button"
            class="ui-button"
            data-variant="primary"
            :disabled="!batchSelectedTags.length || !selectedCount"
            @click="confirmBatchTags"
          >
            添加标签
          </button>
        </template>
      </UiModal>
    </aside>
    <div
      v-if="!collapsed"
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      :aria-valuenow="sidebarWidth"
      aria-valuemin="220"
      aria-valuemax="480"
      tabindex="0"
      data-testid="sidebar-width-resizer"
      class="absolute -right-1 top-0 bottom-0 z-50 w-2 cursor-col-resize touch-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      @pointerdown="startSidebarResize"
      @pointermove="moveSidebarResize"
      @pointerup="stopSidebarResize"
      @pointercancel="stopSidebarResize"
      @lostpointercapture="stopSidebarResize"
      @keydown="resizeSidebarByKey"
    />
  </div>
</template>
