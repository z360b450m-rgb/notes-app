<script setup lang="ts">
import { ref } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import type { ActionMenuAction } from '@/types/ui'

withDefaults(
  defineProps<{
    label: string
    actions: ActionMenuAction[]
    align?: 'start' | 'center' | 'end'
    triggerClass?: string
    disabled?: boolean
  }>(),
  { align: 'end', triggerClass: '' },
)
const emit = defineEmits<{ select: [id: string] }>()
const open = ref(false)
const trigger = ref<{ $el: HTMLElement }>()
const portalTarget = ref<HTMLElement | string>('#app')
const icons = {
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v5h8V3M7 21v-8h10v8',
  download: 'M12 3v12m-5-5 5 5 5-5M3 15v5h18v-5',
  upload: 'M12 15V3m-5 5 5-5 5 5M3 15v5h18v-5',
  text: 'M4 4h16M12 4v16M8 20h8',
  pdf: 'M14 2H6v20h14V8ZM14 2v6h6M8 13h8M8 17h8',
  delete: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6m4-6v6',
  edit: 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5',
  add: 'M12 5v14M5 12h14',
  tag: 'M3 3h8l10 10-8 8L3 11ZM7 7h.01',
  clear: 'm6 6 12 12M18 6 6 18',
}
function changeOpen(value: boolean) {
  if (value)
    portalTarget.value =
      trigger.value?.$el.closest('dialog[open], [role="dialog"][aria-modal="true"]') ?? '#app'
  open.value = value
}
function selectAction(id: string) {
  // A selected command may open a dialog; keep its return target mounted.
  trigger.value?.$el.focus({ preventScroll: true })
  emit('select', id)
}
</script>

<template>
  <DropdownMenuRoot :open="open" :modal="false" @update:open="changeOpen">
    <div class="ui-action-menu" @click.stop>
      <DropdownMenuTrigger
        ref="trigger"
        class="ui-button ui-icon-button"
        :class="triggerClass"
        data-variant="text"
        :aria-label="label"
        :title="label"
        :disabled="disabled"
      >
        <slot name="trigger">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </slot>
      </DropdownMenuTrigger>
      <DropdownMenuPortal :to="portalTarget">
        <DropdownMenuContent
          class="ui-command-menu"
          data-ui-menu
          :aria-label="label"
          :align="align"
          :side-offset="6"
          :collision-padding="12"
        >
          <template v-for="action in actions" :key="action.id">
            <DropdownMenuSeparator v-if="action.separatorBefore" class="ui-menu-separator" />
            <DropdownMenuItem
              as="button"
              type="button"
              class="ui-command-item"
              :data-danger="action.danger || undefined"
              :disabled="action.disabled"
              :text-value="action.label"
              @select="selectAction(action.id)"
            >
              <svg
                v-if="action.icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="icons[action.icon]" />
              </svg>
              <span>{{ action.label }}</span>
              <span v-if="action.shortcut" class="ui-menu-shortcut">{{ action.shortcut }}</span>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </div>
  </DropdownMenuRoot>
</template>
