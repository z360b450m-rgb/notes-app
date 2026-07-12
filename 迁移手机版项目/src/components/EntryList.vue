<script setup lang="ts">
// @AI-NOTE: 条目列表组件 —— 条目展示/选择/排序由 useFilter/useEntries
// Hook 驱动。禁止在此实现筛选/排序逻辑或直接操作存储。
import { ref, nextTick, computed, onUnmounted } from 'vue'
import type { NoteEntry } from '@/types'
import type { SortKey } from '@/composables/useFilter'
import { getMasteryColor } from '@/composables/useStats'

const props = defineProps<{
  entries: NoteEntry[]
  activeId: string | null
  sortKey: SortKey
  selectedIds: Set<string>
}>()

const emit = defineEmits<{
  select: [id: string]
  rename: [id: string, newTitle: string]
  reorder: [orderedIds: string[]]
  'toggle-select': [id: string]
  'range-select': [ids: string[], fromIdx: number, toIdx: number]
}>()

const isCustomSort = computed(() => props.sortKey === 'custom')
const dragId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

function onDragStart(e: DragEvent, id: string) {
  if (!isCustomSort.value) return
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, id: string) {
  if (!isCustomSort.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = id
}

function onDragLeave() {
  dragOverId.value = null
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  dragOverId.value = null
  if (!dragId.value || dragId.value === targetId) {
    dragId.value = null
    return
  }
  const ids = props.entries.map((en) => en.id)
  const fromIdx = ids.indexOf(dragId.value)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx === -1 || toIdx === -1) {
    dragId.value = null
    return
  }
  ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, dragId.value)
  dragId.value = null
  emit('reorder', ids)
}

function onDragEnd() {
  dragId.value = null
  dragOverId.value = null
}

function stripMd(s: string): string {
  return (s || '')
    .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
    .replace(/[#*`~>[\]|]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function preview(s: string, max: number): string {
  const p = stripMd(s)
  return p.length > max ? p.slice(0, max) + '…' : p
}

function masteryColor(entry: NoteEntry): string {
  return getMasteryColor(entry)
}

function formatDate(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatNextReview(ts?: number): { text: string; urgent: boolean } | null {
  if (!ts) return null
  const now = Date.now()
  const diffDays = Math.ceil((ts - now) / 86400000)
  if (diffDays <= 0) return { text: '今天', urgent: true }
  if (diffDays === 1) return { text: '明天', urgent: false }
  if (diffDays <= 7) return { text: diffDays + '天后', urgent: false }
  if (diffDays <= 30) return { text: diffDays + '天后', urgent: false }
  return {
    text: new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    urgent: false,
  }
}

// Checkbox click: toggle select or shift+click range select
function onCheckClick(e: MouseEvent, id: string, idx: number) {
  e.stopPropagation()
  if (e.shiftKey && props.selectedIds.size > 0) {
    const ids = props.entries.map((en) => en.id)
    let lastIdx = -1
    for (let i = ids.length - 1; i >= 0; i--) {
      if (props.selectedIds.has(ids[i])) {
        lastIdx = i
        break
      }
    }
    if (lastIdx >= 0) {
      emit('range-select', ids, lastIdx, idx)
      return
    }
  }
  emit('toggle-select', id)
}

// Click handling: single click navigates, Ctrl+click toggles select, Shift+click range selects
let clickTimer: ReturnType<typeof setTimeout> | null = null

function onItemClick(e: MouseEvent, id: string, idx: number) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    emit('toggle-select', id)
    return
  }
  if (e.shiftKey && props.selectedIds.size > 0) {
    e.preventDefault()
    const ids = props.entries.map((en) => en.id)
    let lastIdx = -1
    for (let i = ids.length - 1; i >= 0; i--) {
      if (props.selectedIds.has(ids[i])) {
        lastIdx = i
        break
      }
    }
    if (lastIdx >= 0) {
      emit('range-select', ids, lastIdx, idx)
    }
    return
  }

  // Normal click: select entry
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    return
  }
  clickTimer = setTimeout(() => {
    clickTimer = null
    emit('select', id)
  }, 250)
}

// Inline rename
const renamingId = ref<string | null>(null)

function getRenameInput(): HTMLInputElement | null {
  return document.querySelector('input[data-renaming]')
}

function onDocumentMouseDown(e: MouseEvent) {
  if (!renamingId.value) return
  const input = getRenameInput()
  if (input && input.contains(e.target as Node)) return
  const entry = props.entries.find((en) => en.id === renamingId.value)
  if (entry) finishRename(entry, true)
}

function startRename(id: string) {
  renamingId.value = id
  document.addEventListener('mousedown', onDocumentMouseDown)
  nextTick(() => {
    const input = getRenameInput()
    input?.focus()
    input?.select()
  })
}

function finishRename(entry: NoteEntry, save: boolean) {
  const input = getRenameInput()
  if (!input || renamingId.value !== entry.id) return
  const newTitle = input.value.trim()
  if (save && newTitle && newTitle !== entry.title) {
    emit('rename', entry.id, newTitle)
  }
  renamingId.value = null
  document.removeEventListener('mousedown', onDocumentMouseDown)
}

function onRenameKeydown(e: KeyboardEvent, entry: NoteEntry) {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishRename(entry, true)
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    finishRename(entry, false)
  }
}

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown)
})
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    v-if="entries.length === 0"
    class="p-6 text-center text-gray-400 dark:text-brand-mid text-xs"
  >
    暂无错题
  </div>
  <div
    v-for="(entry, idx) in entries"
    :key="entry.id"
    class="entry-item flex items-center gap-1 mx-2 mb-0.5 px-2.5 py-2.5 cursor-pointer transition-all duration-200 border-l-[3px] select-none rounded-lg"
    :class="{
      '!bg-accent-light dark:!bg-accent/20 !border-l-accent shadow-md ring-1 ring-accent/15':
        entry.id === activeId,
      'border-l-accent bg-accent-light/50 dark:bg-accent/10':
        selectedIds.has(entry.id) && entry.id !== activeId,
      'opacity-50': isCustomSort && dragId === entry.id,
      'border-t-2 border-t-accent': isCustomSort && dragOverId === entry.id,
      'border-l-transparent hover:bg-gray-50 dark:hover:bg-[#1e1e1c]/50':
        !selectedIds.has(entry.id) && entry.id !== activeId,
    }"
    :title="selectedIds.has(entry.id) ? undefined : 'Ctrl+点击选择 · Shift+点击范围选择'"
    :draggable="isCustomSort"
    @click="onItemClick($event, entry.id, idx)"
    @dragstart="onDragStart($event, entry.id)"
    @dragover="onDragOver($event, entry.id)"
    @dragleave="onDragLeave"
    @drop="onDrop($event, entry.id)"
    @dragend="onDragEnd"
  >
    <!-- Checkbox -->
    <div
      class="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded border-2 transition-all duration-200 ease-out active:scale-90 cursor-pointer"
      :class="
        selectedIds.has(entry.id)
          ? 'bg-accent border-accent text-white'
          : 'border-gray-200 dark:border-[#2e2e2c] hover:border-accent dark:hover:border-accent'
      "
      @click.stop="onCheckClick($event, entry.id, idx)"
    >
      <svg
        v-if="selectedIds.has(entry.id)"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>

    <!-- Mastery dot -->
    <span
      v-if="entry.masteryLevel !== undefined || entry.easeFactor !== undefined"
      class="w-2 h-2 rounded-full flex-shrink-0"
      :style="{ backgroundColor: masteryColor(entry) }"
    />

    <!-- Drag handle (custom sort only) -->
    <div
      v-if="isCustomSort"
      class="flex-shrink-0 text-gray-300 hover:text-gray-500 dark:text-brand-mid dark:hover:text-gray-300 cursor-grab active:cursor-grabbing"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="5" r="2" />
        <circle cx="15" cy="5" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="9" cy="19" r="2" />
        <circle cx="15" cy="19" r="2" />
      </svg>
    </div>

    <div class="flex-1 min-w-0">
      <!-- Title (view mode) -->
      <div v-if="renamingId !== entry.id" class="flex items-center gap-1.5 mb-0.5 min-w-0">
        <span
          class="text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis cursor-text"
          :class="{ 'text-accent font-semibold': entry.id === activeId }"
          @dblclick.stop="startRename(entry.id)"
        >
          {{ entry.title || preview(entry.question, 28) || '无题目' }}
        </span>
        <span
          v-if="formatNextReview(entry.nextReviewDate)"
          class="text-[10px] px-1.5 py-px rounded-full flex-shrink-0 font-medium"
          :class="
            formatNextReview(entry.nextReviewDate)!.urgent
              ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
              : 'bg-gray-100 dark:bg-[#1e1e1c] text-gray-400 dark:text-brand-mid'
          "
        >
          {{ formatNextReview(entry.nextReviewDate)!.text }}
        </span>
      </div>
      <!-- Title (edit mode) -->
      <input
        v-else
        data-renaming
        class="text-[13px] font-medium w-[calc(100%+8px)] -ml-1 px-1 py-0.5 border border-accent rounded outline-none bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light"
        :value="entry.title"
        @blur="finishRename(entry, true)"
        @keydown="onRenameKeydown($event, entry)"
      />

      <div class="text-[11px] text-gray-400 dark:text-brand-mid flex gap-1.5 items-center">
        <span
          v-if="entry.subject"
          class="px-1.5 py-px rounded-sm bg-gray-100 dark:bg-[#1e1e1c] text-[10px]"
        >
          {{ entry.subject }}
        </span>
        <span>{{ formatDate(entry.updatedAt) }}</span>
        <span v-if="entry.source" class="opacity-60">{{ entry.source }}</span>
      </div>
    </div>
  </div>
</template>
