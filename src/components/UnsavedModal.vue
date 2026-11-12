<script setup lang="ts">
import UiModal from './UiModal.vue'

defineProps<{ visible: boolean; requireSave?: boolean; busy?: boolean; error?: string }>()
const emit = defineEmits<{ save: []; discard: []; cancel: [] }>()
</script>

<template>
  <UiModal
    :visible="visible"
    :title="requireSave ? '保存后关闭' : '未保存的更改'"
    :description="
      requireSave
        ? '当前错题有未保存的修改，保存后才能关闭。'
        : '当前错题有未保存的修改，是否保存？'
    "
    :busy="busy"
    :error="error"
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
        v-if="!requireSave"
        type="button"
        class="ui-button"
        data-variant="danger-text"
        :disabled="busy"
        @click="emit('discard')"
      >
        不保存
      </button>
      <button
        type="button"
        class="ui-button"
        data-variant="primary"
        :disabled="busy"
        @click="emit('save')"
      >
        {{ busy ? '保存中…' : requireSave ? '保存并关闭' : '保存' }}
      </button>
    </template>
  </UiModal>
</template>
