<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

defineProps<{ label: string; icon: 'image' | 'more' }>()
const id = useId()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
function dismiss(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  event.preventDefault()
  open.value = false
  trigger.value?.focus()
}
async function focusFirst() {
  open.value = true
  await nextTick()
  const buttons = panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  Array.from(buttons || [])
    .find((button) => button.getClientRects().length > 0)
    ?.focus()
}
function visibleItems() {
  return Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [],
  ).filter((button) => button.getClientRects().length > 0)
}
async function focusLast() {
  open.value = true
  await nextTick()
  visibleItems().at(-1)?.focus()
}
function navigate(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Tab') {
    open.value = false
    trigger.value?.focus()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = visibleItems()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
function toggle(event: MouseEvent) {
  if (open.value) open.value = false
  else if (event.detail === 0) void focusFirst()
  else open.value = true
}
function selectItem(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('[role="menuitem"]')) return
  const keyboard = panel.value?.contains(document.activeElement)
  open.value = false
  if (keyboard) trigger.value?.focus()
}
onMounted(() => document.addEventListener('pointerdown', dismiss))
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismiss))
</script>

<template>
  <div ref="root" class="editor-tool-menu" data-editor-toolbar @keydown.esc="escape">
    <button
      ref="trigger"
      type="button"
      class="editor-tool-menu-trigger"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-controls="id"
      :title="label"
      @mousedown.prevent
      @click="toggle"
      @keydown.down.prevent="focusFirst"
      @keydown.up.prevent="focusLast"
    >
      <svg
        v-if="icon === 'image'"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 6-6 4 4 3-3 5 5" />
      </svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
      <span v-if="icon === 'image'">插入图片</span>
    </button>
    <!-- Keep teleport targets mounted while the menu is closed. -->
    <div
      v-show="open"
      :id="id"
      ref="panel"
      class="soft-menu editor-tool-menu-panel"
      role="menu"
      :aria-label="label"
      @mousedown.prevent
      @click="selectItem"
      @keydown="navigate"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.editor-tool-menu {
  position: relative;
  display: flex;
  flex-shrink: 0;
}
.editor-tool-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--neo-muted);
}
.editor-tool-menu-trigger:hover,
.editor-tool-menu-trigger[aria-expanded='true'] {
  background: var(--neo-selected);
  color: var(--neo-accent);
}
.editor-tool-menu-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 80;
  width: 190px;
  max-width: calc(100vw - 32px);
  padding: 6px;
  border: 1px solid var(--neo-line);
  border-radius: 10px;
  background: var(--neo-reading);
  box-shadow: 0 8px 28px rgb(0 0 0 / 12%);
}
.editor-tool-menu-panel :deep(button) {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  text-align: left;
}
.editor-layout-menu-hint {
  padding: 6px;
  font-size: 12px;
  color: var(--neo-muted);
  line-height: 1.6;
}
</style>
