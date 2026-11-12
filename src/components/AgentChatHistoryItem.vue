<script setup lang="ts">
import ActionMenu from './ActionMenu.vue'
import type { ActionMenuAction } from '@/types/ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  title: string
  detail: string
  active: boolean
  expanded: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  select: []
  expand: [expanded: boolean]
  rename: []
  delete: []
}>()

const actionWidth = 132
const dragOffset = ref<number | null>(null)
const offset = computed(() => dragOffset.value ?? (props.expanded ? actionWidth : 0))
let gesture: {
  id: number
  x: number
  y: number
  initial: number
  horizontal: boolean
} | null = null
let suppressClick = false

function startDrag(event: PointerEvent) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  suppressClick = false
  gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    initial: offset.value,
    horizontal: false,
  }
}

function moveDrag(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return
  const dx = event.clientX - gesture.x
  const dy = event.clientY - gesture.y
  if (!gesture.horizontal) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
    if (Math.abs(dy) >= Math.abs(dx)) {
      gesture = null
      return
    }
    gesture.horizontal = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  event.preventDefault()
  suppressClick = true
  dragOffset.value = Math.max(0, Math.min(actionWidth, gesture.initial - dx))
}

function finishDrag(event: PointerEvent) {
  // Touch starts with implicit capture on the text span; transferring it to the
  // content emits a bubbling lostpointercapture that must not end the gesture.
  if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return
  if (!gesture || gesture.id !== event.pointerId) return
  const target = event.currentTarget as HTMLElement
  if (gesture.horizontal) {
    emit('expand', event.type === 'pointerup' ? offset.value >= actionWidth / 2 : props.expanded)
  }
  gesture = null
  dragOffset.value = null
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}

function select(event: MouseEvent) {
  if (suppressClick && event.detail > 0) {
    suppressClick = false
    return
  }
  if (props.expanded) emit('expand', false)
  else emit('select')
}

watch(
  () => props.disabled,
  (disabled) => {
    if (!disabled) return
    gesture = null
    dragOffset.value = null
    emit('expand', false)
  },
)
const menuActions = computed<ActionMenuAction[]>(() => [
  { id: 'rename', label: '重命名聊天', icon: 'edit', disabled: props.disabled },
  {
    id: 'delete',
    label: '删除聊天',
    icon: 'delete',
    danger: true,
    separatorBefore: true,
    disabled: props.disabled,
  },
])
function menuAction(id: string) {
  if (props.disabled) return
  emit('expand', false)
  if (id === 'rename') emit('rename')
  else if (id === 'delete') emit('delete')
}
</script>

<template>
  <div
    class="agent-history-item relative min-w-0 shrink-0 overflow-hidden rounded-xl"
    :class="{ 'is-expanded': expanded }"
    @keydown.esc.stop="emit('expand', false)"
  >
    <div
      v-if="expanded || offset > 0"
      class="agent-history-actions absolute inset-y-0 right-0 flex w-[132px] items-stretch gap-1 py-1 pl-1"
      :inert="!expanded || disabled"
      :aria-hidden="!expanded"
    >
      <button
        data-ui-variant="danger-text"
        type="button"
        class="ui-control agent-history-action agent-history-delete flex-1 rounded-lg text-xs font-medium"
        :disabled="disabled"
        :aria-label="`删除聊天：${title}`"
        @click="emit('delete')"
      >
        删除
      </button>
      <button
        data-ui-variant="default"
        type="button"
        class="ui-control agent-history-action agent-history-rename flex-1 rounded-lg text-xs font-medium"
        :disabled="disabled"
        :aria-label="`重命名聊天：${title}`"
        @click="emit('rename')"
      >
        重命名
      </button>
    </div>
    <div
      class="agent-history-content relative flex min-w-0 items-stretch rounded-xl"
      :class="{ 'is-dragging': dragOffset !== null }"
      :style="{ transform: `translateX(${-offset}px)` }"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="finishDrag"
      @pointercancel="finishDrag"
      @lostpointercapture="finishDrag"
    >
      <button
        type="button"
        class="ui-choice agent-history-button min-w-0 flex-1 select-none rounded-xl px-3 py-2 text-left"
        :disabled="disabled"
        :aria-current="active ? 'true' : undefined"
        :title="title"
        @keydown.left.prevent="emit('expand', true)"
        @keydown.right.prevent="emit('expand', false)"
        @click="select"
      >
        <span class="block truncate text-sm">{{ title }}</span>
        <span class="mt-1 block truncate text-xs text-brand-mid">{{ detail }}</span>
      </button>
      <ActionMenu
        :label="`聊天操作：${title}`"
        :disabled="disabled"
        :actions="menuActions"
        @select="menuAction"
      />
    </div>
  </div>
</template>

<style scoped>
.agent-history-content {
  background: var(--neo-surface);
  transition: transform 180ms ease-out;
}
.agent-history-content.is-dragging {
  transition: none;
}
.agent-history-content {
  touch-action: pan-y;
}
.agent-history-item .agent-history-button {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--neo-ink) !important;
}
.agent-history-item .agent-history-button:hover {
  background: var(--neo-selected) !important;
  color: var(--neo-accent) !important;
}
.agent-history-item .agent-history-more {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--neo-muted) !important;
}
.agent-history-item .agent-history-action {
  border: 1px solid var(--neo-line) !important;
  background: color-mix(in srgb, var(--neo-ink) 5%, var(--neo-surface)) !important;
  color: var(--neo-ink) !important;
  box-shadow: none !important;
}
.agent-history-item .agent-history-delete {
  color: #8b5149 !important;
}
.agent-history-item .agent-history-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--neo-ink) 9%, var(--neo-surface)) !important;
}
:global(.dark .agent-history-item .agent-history-delete) {
  color: #c79b93 !important;
}
.agent-history-item button:focus-visible {
  outline: 2px solid var(--neo-accent);
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .agent-history-content {
    transition: none;
  }
}
</style>
