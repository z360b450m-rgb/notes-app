<script setup lang="ts">
import { computed } from 'vue'
import UiModal from './UiModal.vue'

const props = defineProps<{ visible: boolean; count?: number; busy?: boolean; error?: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const batch = computed(() => props.count !== undefined)
</script>

<template>
  <UiModal
    :visible="visible"
    :title="batch ? '批量删除' : '删除错题'"
    :description="
      batch
        ? `确定删除选中的 ${count} 条错题吗？此操作不可撤销。`
        : '确定删除这道错题吗？此操作不可撤销。'
    "
    :busy="busy"
    :error="error"
    danger
    @cancel="emit('cancel')"
  >
    <template #actions>
      <button
        type="button"
        class="ui-button"
        data-dialog-cancel
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </button>
      <button
        type="button"
        class="ui-button"
        data-variant="danger"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? '正在删除…' : batch ? `删除 ${count} 条` : '确认删除' }}
      </button>
    </template>
  </UiModal>
</template>
