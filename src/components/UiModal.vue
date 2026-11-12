<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useDialogBackdropClose } from '@/composables/useDialogBackdropClose'

const props = defineProps<{
  visible: boolean
  title: string
  description?: string
  busy?: boolean
  error?: string
  danger?: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
const descriptionId = useId()
let opener: HTMLElement | null = null
function cancel() {
  if (!props.busy) emit('cancel')
}
const { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick } =
  useDialogBackdropClose(cancel)
function syncVisible() {
  if (!dialog.value) return
  if (props.visible && !dialog.value.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Menu items disappear after selection; return to their persistent trigger.
    const menuTriggerId = opener
      ?.closest('[role="menu"]')
      ?.getAttribute('aria-labelledby')
      ?.split(' ')[0]
    if (menuTriggerId) opener = document.getElementById(menuTriggerId) ?? opener
    dialog.value.showModal()
    dialog.value.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.focus()
  } else if (!props.visible && dialog.value.open) {
    dialog.value.close()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }
}
function trapFocus(event: KeyboardEvent) {
  const items = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
    ) || [],
  ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last) {
    event.preventDefault()
    dialog.value?.focus()
  } else if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last.focus()
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    first.focus()
  }
}
watch(() => props.visible, syncVisible, { flush: 'post' })
onMounted(syncVisible)
onBeforeUnmount(() => {
  if (dialog.value?.open) {
    dialog.value.close()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
  }
})
</script>

<template>
  <Teleport to="#app">
    <dialog
      ref="dialog"
      class="ui-modal"
      tabindex="-1"
      :data-danger="danger || undefined"
      :aria-labelledby="titleId"
      :aria-describedby="description ? descriptionId : undefined"
      :aria-busy="busy || undefined"
      @cancel.prevent="cancel"
      @keydown.tab="trapFocus"
      @pointerdown="onBackdropPointerDown"
      @pointercancel="onBackdropPointerCancel"
      @click="onBackdropClick"
    >
      <header class="ui-modal-heading">
        <h2 :id="titleId">{{ title }}</h2>
        <p v-if="description" :id="descriptionId">{{ description }}</p>
      </header>
      <slot />
      <p v-if="error" role="alert" class="ui-inline-error">{{ error }}</p>
      <footer class="ui-modal-actions"><slot name="actions" /></footer>
    </dialog>
  </Teleport>
</template>
