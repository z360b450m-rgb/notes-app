<script setup lang="ts">
// @AI-NOTE: 工具栏组件 —— 所有操作通过 emit 事件委托给父组件。
// 禁止在此直接操作存储或执行保存/删除等业务逻辑。
import { computed, ref, onMounted, onUnmounted } from 'vue'
import ActionMenu from './ActionMenu.vue'
import type { ActionMenuAction } from '@/types/ui'

const props = defineProps<{
  sidebarCollapsed: boolean
  activeId: string | null
  searchQuery: string
  mode: 'edit' | 'review'
  dueCount: number
  progress: string
  statsOpen: boolean
  isDirty: boolean
  drawingEnabled: boolean
}>()

const emit = defineEmits<{
  'return-to-menu': []
  'toggle-sidebar': []
  search: [query: string]
  new: []
  delete: []
  save: []
  toggleMode: []
  toggleStats: []
  toggleDrawing: []
  'export-json': []
  'export-pdf': []
  'import-json': []
  'import-text': []
  'import-pdf': []
}>()

const toolbarRef = ref<HTMLElement | null>(null)
const compact = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

let observer: ResizeObserver | null = null

onMounted(() => {
  if (toolbarRef.value) {
    observer = new ResizeObserver(([entry]) => {
      compact.value = entry.contentRect.width < 680
    })
    observer.observe(toolbarRef.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
})

const actions = computed<ActionMenuAction[]>(() => [
  { id: 'save', label: '保存', icon: 'save', shortcut: 'Ctrl+S', disabled: !props.isDirty },
  { id: 'export-json', label: '导出归档', icon: 'download', separatorBefore: true },
  { id: 'export-pdf', label: '导出 PDF (打印)', icon: 'pdf' },
  { id: 'import', label: '导入归档', icon: 'upload', separatorBefore: true },
  { id: 'import-text', label: '导入文本', icon: 'text' },
  { id: 'import-pdf', label: '导入 PDF', icon: 'pdf' },
  {
    id: 'delete',
    label: '删除',
    icon: 'delete',
    danger: true,
    separatorBefore: true,
    disabled: !props.activeId,
  },
])
function moreAction(action: string) {
  if (action === 'save' && props.isDirty) emit('save')
  else if (action === 'export-json') emit('export-json')
  else if (action === 'export-pdf') emit('export-pdf')
  else if (action === 'import') emit('import-json')
  else if (action === 'import-text') emit('import-text')
  else if (action === 'import-pdf') emit('import-pdf')
  else if (action === 'delete' && props.activeId) emit('delete')
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    ref="toolbarRef"
    class="button-tray main-button-tray flex items-center bg-white dark:bg-[#141413] border-b-2 border-gray-100 dark:border-[#2e2e2c] transition-all duration-300"
    :class="compact ? 'gap-1 px-3 py-2' : 'gap-2.5 px-5 py-3'"
    style="-webkit-app-region: drag"
  >
    <div class="workspace-navigation flex shrink-0 items-center gap-3">
      <button
        type="button"
        data-variant="text"
        class="ui-button workspace-back-button flex h-8 shrink-0 items-center justify-center gap-1.5 text-gray-500 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#1e1e1c]"
        title="返回首页"
        aria-label="返回首页"
        @click="emit('return-to-menu')"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">首页</span>
      </button>
      <button
        type="button"
        data-variant="text"
        class="ui-button ui-icon-button flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#1e1e1c]"
        :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :aria-expanded="!sidebarCollapsed"
        @click="emit('toggle-sidebar')"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M9 3v18" />
        </svg>
      </button>
    </div>
    <!-- Mode toggle -->
    <button
      style="-webkit-app-region: no-drag"
      class="ui-button flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
      :class="[
        mode === 'review'
          ? 'bg-accent text-white hover:brightness-110'
          : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-700 dark:text-brand-light-gray',
        compact ? 'px-2 py-1.5' : 'px-3 py-1.5',
      ]"
      :aria-label="mode === 'review' ? '退出复习' : '进入复习'"
      :aria-pressed="mode === 'review'"
      @click="emit('toggleMode')"
    >
      <svg
        v-if="mode === 'edit'"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <svg
        v-else
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
      <span
        class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-300 ease-out"
        :class="compact ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'"
        >{{ mode === 'review' ? '退出复习' : '进入复习' }}</span
      >
      <span
        v-if="mode === 'edit' && dueCount > 0"
        class="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none flex-shrink-0"
        >{{ dueCount }}</span
      >
    </button>

    <!-- Stats toggle -->
    <button
      v-if="mode === 'review'"
      type="button"
      aria-label="切换画笔模式"
      :aria-pressed="drawingEnabled"
      title="开启画笔 / 橡皮"
      class="ui-button"
      data-variant="text"
      @click="emit('toggleDrawing')"
    >
      画笔
    </button>
    <button
      style="-webkit-app-region: no-drag"
      data-variant="text"
      class="ui-button flex items-center gap-1 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
      :class="[
        statsOpen
          ? 'bg-accent text-white hover:brightness-110'
          : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-600 dark:text-brand-light-gray',
        compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
      ]"
      aria-label="统计面板"
      :aria-pressed="statsOpen"
      title="统计面板"
      @click="emit('toggleStats')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
      <span
        class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
        :class="compact ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100'"
        >统计</span
      >
    </button>

    <!-- Divider -->
    <div class="w-px h-5 bg-gray-200 dark:bg-[#2a2a28] flex-shrink-0" />

    <!-- Edit mode controls -->
    <template v-if="mode === 'edit'">
      <!-- Search -->
      <div
        class="workspace-search flex items-center gap-2 bg-brand-light-gray dark:bg-[#1e1e1c] rounded-lg focus-within:bg-white dark:focus-within:bg-gray-700 focus-within:ring-2 focus-within:ring-accent/20"
        :class="compact ? 'px-2 py-1' : 'px-3 py-1.5'"
        @click="searchInput?.focus()"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="text-gray-400 dark:text-brand-mid flex-shrink-0"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref="searchInput"
          type="text"
          aria-label="搜索错题"
          :placeholder="compact ? '搜索...' : '搜索错题...'"
          class="flex-1 border-none bg-transparent text-[13px] outline-none text-gray-800 dark:text-brand-light"
          :value="searchQuery"
          @input="emit('search', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- New entry -->
      <button
        style="-webkit-app-region: no-drag"
        aria-label="新建错题"
        title="新建错题 (Ctrl+N)"
        data-variant="primary"
        class="ui-button btn-primary flex items-center gap-1 rounded-md bg-accent text-white text-[13px] font-medium hover:brightness-110 transition-all"
        :class="compact ? 'px-2.5 py-1.5' : 'px-3.5 py-1.5'"
        @click="emit('new')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span
          class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
          :class="compact ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'"
          >新建错题</span
        >
      </button>

      <div class="w-px h-5 bg-gray-200 dark:bg-[#2a2a28] flex-shrink-0" />
      <ActionMenu label="更多" :actions="actions" @select="moreAction" />
    </template>

    <!-- Review mode: progress + reveal button -->
    <template v-else>
      <div class="flex-1" />
      <span class="text-[13px] text-gray-500 dark:text-brand-mid font-medium tabular-nums">{{
        progress
      }}</span>
    </template>
  </div>
</template>
