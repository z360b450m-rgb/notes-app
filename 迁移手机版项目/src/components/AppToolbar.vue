<script setup lang="ts">
// @AI-NOTE: 工具栏组件 —— 所有操作通过 emit 事件委托给父组件。
// 禁止在此直接操作存储或执行保存/删除等业务逻辑。
import { ref, onMounted, onUnmounted } from 'vue'

defineProps<{
  activeId: string | null
  answersHidden: boolean
  canGoPrev: boolean
  canGoNext: boolean
  searchQuery: string
  mode: 'edit' | 'review'
  dueCount: number
  progress: string
  drawingEnabled: boolean
  statsOpen: boolean
  isDirty: boolean
}>()

const emit = defineEmits<{
  search: [query: string]
  new: []
  prev: []
  next: []
  reveal: []
  delete: []
  save: []
  toggleMode: []
  toggleDrawing: []
  toggleStats: []
  'export-json': []
  'export-pdf': []
  'import-json': []
  'import-text': []
  'import-pdf': []
}>()

const moreMenuOpen = ref(false)
const toolbarRef = ref<HTMLElement | null>(null)
const compact = ref(false)

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

function moreAction(
  action: 'export-json' | 'export-pdf' | 'import' | 'import-text' | 'import-pdf' | 'delete',
) {
  if (action === 'export-json') emit('export-json')
  else if (action === 'export-pdf') emit('export-pdf')
  else if (action === 'import') emit('import-json')
  else if (action === 'import-text') emit('import-text')
  else if (action === 'import-pdf') emit('import-pdf')
  else if (action === 'delete') emit('delete')
  moreMenuOpen.value = false
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    ref="toolbarRef"
    class="flex items-center bg-white dark:bg-[#141413] border-b-2 border-gray-100 dark:border-[#2e2e2c] transition-all duration-300"
    :class="compact ? 'gap-1 px-3 py-2' : 'gap-2.5 px-5 py-3'"
    style="-webkit-app-region: drag"
  >
    <!-- Mode toggle -->
    <button
      style="-webkit-app-region: no-drag"
      class="flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
      :class="[
        mode === 'review'
          ? 'bg-accent text-white hover:brightness-110'
          : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-700 dark:text-brand-light-gray',
        compact ? 'px-2 py-1.5' : 'px-3 py-1.5',
      ]"
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
        >{{ mode === 'review' ? '退出复习' : '复习模式' }}</span
      >
      <span
        v-if="mode === 'edit' && dueCount > 0"
        class="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none flex-shrink-0"
        >{{ dueCount }}</span
      >
    </button>

    <!-- Drawing toggle -->
    <button
      style="-webkit-app-region: no-drag"
      class="flex items-center gap-1 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
      :class="[
        drawingEnabled
          ? 'bg-amber-500 text-white hover:brightness-110'
          : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-600 dark:text-brand-light-gray',
        compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
      ]"
      title="画笔 / 橡皮"
      @click="emit('toggleDrawing')"
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
      <span
        class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
        :class="compact ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100'"
        >画笔</span
      >
    </button>

    <!-- Stats toggle -->
    <button
      style="-webkit-app-region: no-drag"
      class="flex items-center gap-1 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
      :class="[
        statsOpen
          ? 'bg-accent text-white hover:brightness-110'
          : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-600 dark:text-brand-light-gray',
        compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
      ]"
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
        class="flex-1 flex items-center gap-2 bg-brand-light-gray dark:bg-[#1e1e1c] rounded-lg focus-within:bg-white dark:focus-within:bg-gray-700 focus-within:ring-2 focus-within:ring-accent/20 transition-all"
        :class="compact ? 'px-2 py-1' : 'px-3 py-1.5'"
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
          type="text"
          :placeholder="compact ? '搜索...' : '搜索错题...'"
          class="flex-1 border-none bg-transparent text-[13px] outline-none text-gray-800 dark:text-brand-light"
          :value="searchQuery"
          @input="emit('search', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- New entry -->
      <button
        style="-webkit-app-region: no-drag"
        class="btn-primary flex items-center gap-1 rounded-md bg-accent text-white text-[13px] font-medium hover:brightness-110 transition-all"
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

      <!-- Prev/Next (visible when entry active) -->
      <button
        v-if="activeId"
        style="-webkit-app-region: no-drag"
        class="flex items-center gap-1 rounded-md border border-gray-100 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-[13px] transition-all duration-200 ease-out active:scale-95"
        :class="[
          canGoPrev
            ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c]'
            : 'opacity-40 pointer-events-none',
          compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
        ]"
        title="上一题 (Ctrl+←)"
        @click="emit('prev')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span
          class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
          :class="compact ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100'"
          >上一题</span
        >
      </button>
      <button
        v-if="activeId"
        style="-webkit-app-region: no-drag"
        class="flex items-center gap-1 rounded-md border border-gray-100 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-[13px] transition-all duration-200 ease-out active:scale-95"
        :class="[
          canGoNext
            ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c]'
            : 'opacity-40 pointer-events-none',
          compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
        ]"
        title="下一题 (Ctrl+→)"
        @click="emit('next')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span
          class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
          :class="compact ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100'"
          >下一题</span
        >
      </button>

      <!-- Reveal toggle -->
      <button
        v-if="activeId"
        style="-webkit-app-region: no-drag"
        class="btn-icon flex items-center gap-1 rounded-md border text-[13px] cursor-pointer transition-all"
        :class="[
          answersHidden
            ? 'bg-accent text-white border-accent'
            : 'border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] hover:bg-gray-100 dark:hover:bg-[#2a2a28] text-gray-700 dark:text-brand-light-gray',
          compact ? 'px-2 py-1.5' : 'px-2.5 py-1.5',
        ]"
        title="显示/隐藏正确答案"
        @click="emit('reveal')"
      >
        <template v-if="answersHidden">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
            />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </template>
        <template v-else>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </template>
        <span
          class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
          :class="compact ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'"
          >{{ answersHidden ? '显示正确答案' : '隐藏正确答案' }}</span
        >
      </button>

      <!-- Save -->
      <button
        v-if="activeId"
        style="-webkit-app-region: no-drag"
        class="flex items-center gap-1 rounded-md text-[13px] font-medium transition-all duration-200 ease-out active:scale-95"
        :class="[
          isDirty
            ? 'bg-accent text-white hover:brightness-110 cursor-pointer'
            : 'border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] text-gray-300 dark:text-[#4a4a48] cursor-not-allowed',
          compact ? 'px-2 py-1.5' : 'px-3 py-1.5',
        ]"
        :disabled="!isDirty"
        title="保存 (Ctrl+S)"
        @click="isDirty && emit('save')"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span
          class="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out"
          :class="compact ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100'"
          >保存</span
        >
        <span
          v-if="isDirty"
          class="w-1.5 h-1.5 rounded-full bg-white dark:bg-[#141413] ml-0.5 flex-shrink-0"
        />
      </button>

      <!-- More menu (···) -->
      <div class="w-px h-5 bg-gray-200 dark:bg-[#2a2a28] flex-shrink-0" />
      <div class="relative flex-shrink-0">
        <button
          style="-webkit-app-region: no-drag"
          class="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-500 dark:text-brand-light-gray hover:text-gray-700 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-all"
          title="更多"
          @click.stop="moreMenuOpen = !moreMenuOpen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        <div
          v-if="moreMenuOpen"
          class="absolute right-0 top-10 z-30 bg-white dark:bg-[#141413] rounded-xl shadow-lg border border-gray-100 dark:border-[#2e2e2c] py-1 min-w-[150px]"
          @click.stop
        >
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="moreAction('export-json')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            导出归档
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="moreAction('export-pdf')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            导出 PDF (打印)
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="moreAction('import')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="3 10 8 15 13 10" />
              <line x1="8" y1="15" x2="8" y2="3" />
            </svg>
            导入归档
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="moreAction('import-text')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            导入文本
          </button>
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="moreAction('import-pdf')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="12" y2="12" />
              <line x1="15" y1="15" x2="12" y2="12" />
            </svg>
            导入 PDF
          </button>
          <div class="border-t border-gray-100 dark:border-[#2e2e2c] my-1" />
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900 dark:bg-red-950/50 transition-all duration-200 ease-out active:scale-95"
            :class="{ 'opacity-30 pointer-events-none': !activeId }"
            :disabled="!activeId"
            @click="moreAction('delete')"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            删除
          </button>
        </div>

        <!-- Click outside to close -->
        <div v-if="moreMenuOpen" class="fixed inset-0 z-20" @click="moreMenuOpen = false" />
      </div>
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
