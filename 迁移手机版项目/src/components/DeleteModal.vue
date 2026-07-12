<script setup lang="ts">
// @AI-NOTE: 删除确认对话框 —— 纯 UI 组件。删除逻辑由父组件通过
// emit 事件驱动。禁止在此直接执行删除操作。
import { useModalAnimations } from '@/composables/useModalAnimations'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { enterModal, leaveModal } = useModalAnimations()
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <Transition :css="false" @enter="enterModal" @leave="leaveModal">
    <div
      v-if="visible"
      class="modal-overlay fixed inset-0 bg-black/30 flex items-center justify-center z-[999]"
      @click.self="emit('cancel')"
    >
      <div
        class="modal-dialog bg-white dark:bg-[#141413] rounded-lg p-5 shadow-xl max-w-[380px] w-[90%]"
      >
        <h3 class="text-base font-semibold mb-1.5">删除错题</h3>
        <p class="text-gray-400 dark:text-brand-mid text-sm mb-4">
          确定要删除这道错题吗？此操作不可撤销。
        </p>
        <div class="flex gap-2 justify-end">
          <button
            class="px-3.5 py-1.5 rounded-md text-sm font-medium text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c] transition-all duration-200 ease-out active:scale-95"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            class="px-3.5 py-1.5 rounded-md text-sm font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 transition-all duration-200 ease-out active:scale-95"
            @click="emit('confirm')"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
