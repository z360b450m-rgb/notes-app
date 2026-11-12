<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ dirty: boolean; saving: boolean; error: string }>()
defineEmits<{ save: [] }>()
const label = computed(() =>
  props.saving ? '保存中…' : props.error ? props.error : props.dirty ? '有未保存的修改' : '已保存',
)
</script>

<template>
  <div
    class="entry-save-status"
    :data-state="saving ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved'"
  >
    <span role="status" aria-live="polite" aria-atomic="true" class="save-status-message">
      <span class="save-status-dot" aria-hidden="true" />{{ label }}
    </span>
    <button
      v-if="dirty || error"
      class="ui-button"
      data-variant="text"
      type="button"
      :disabled="saving"
      @click="$emit('save')"
    >
      {{ error ? '重试保存' : '保存' }}
    </button>
  </div>
</template>
