<script setup lang="ts">
import { ref, useId } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

defineProps<{ label: string; title: string; description: string; confirmText?: string }>()
const emit = defineEmits<{ confirm: [] }>()
const open = ref(false)
const cancelButton = ref<HTMLButtonElement>()
const titleId = useId()
const descriptionId = useId()
function confirm() {
  open.value = false
  emit('confirm')
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      class="ui-button ui-icon-button folder-delete-trigger"
      data-variant="text"
      :aria-label="label"
      :title="label"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        aria-hidden="true"
      >
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </svg>
    </PopoverTrigger>
    <PopoverPortal to="#app">
      <PopoverContent
        class="ui-popconfirm"
        align="end"
        :side-offset="8"
        :collision-padding="12"
        :aria-describedby="descriptionId"
        @open-auto-focus.prevent="cancelButton?.focus()"
      >
        <h3 :id="titleId">{{ title }}</h3>
        <p :id="descriptionId">{{ description }}</p>
        <div class="ui-modal-actions">
          <button ref="cancelButton" type="button" class="ui-button" @click="open = false">
            取消
          </button>
          <button type="button" class="ui-button" data-variant="danger" @click="confirm">
            {{ confirmText || '确认删除' }}
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
