<script setup lang="ts">
import UiModal from './UiModal.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <UiModal
    :visible="visible"
    title="转为一拖 N 题组？"
    description="转化后，当前题目会成为该题组的第 1 小题，并新增所有小题共用的材料区域。"
    @cancel="emit('cancel')"
  >
    <template #actions>
      <button type="button" class="ui-button" data-dialog-cancel @click="emit('cancel')">
        取消
      </button>
      <button type="button" class="ui-button" data-variant="primary" @click="emit('confirm')">
        确认转化
      </button>
    </template>
  </UiModal>
</template>
