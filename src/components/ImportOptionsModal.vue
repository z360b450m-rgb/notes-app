<script setup lang="ts">
import UiModal from './UiModal.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ keep: []; reset: []; cancel: [] }>()
</script>

<template>
  <UiModal
    :visible="visible"
    title="导入归档"
    description="支持 .ctb 和 .zip。完整归档恢复原有错题本、题组和图片，旧版归档导入当前错题本。相同 ID 的题目将被覆盖，请选择是否保留复习进度。"
    @cancel="emit('cancel')"
  >
    <template #actions>
      <button type="button" class="ui-button" data-dialog-cancel @click="emit('cancel')">
        取消
      </button>
      <button type="button" class="ui-button" @click="emit('reset')">重置为未复习</button>
      <button type="button" class="ui-button" data-variant="primary" @click="emit('keep')">
        保留复习进度
      </button>
    </template>
  </UiModal>
</template>
