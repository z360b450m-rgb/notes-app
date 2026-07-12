<script setup lang="ts">
// @AI-NOTE: 未保存确认对话框 —— 纯 UI 组件。保存/丢弃/取消逻辑
// 由父组件通过 emit 事件驱动。
import { useModalAnimations } from '@/composables/useModalAnimations'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  save: []
  discard: []
  cancel: []
}>()

const { enterModal, leaveModal } = useModalAnimations()
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <Transition :css="false" @enter="enterModal" @leave="leaveModal">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="modal-overlay absolute inset-0 bg-black/30" @click="emit('cancel')" />

      <!-- Dialog -->
      <div
        class="modal-dialog relative bg-white dark:bg-[#141413] rounded-xl shadow-2xl border border-gray-100 dark:border-[#2e2e2c] p-6 w-[360px] max-w-[90vw]"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <div
            class="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center flex-shrink-0"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#d97757"
              stroke-width="2.5"
            >
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"
              />
            </svg>
          </div>
          <div>
            <h3 class="text-[15px] font-bold text-gray-800 dark:text-brand-light">未保存的更改</h3>
            <p class="text-[12px] text-gray-500 dark:text-brand-mid mt-0.5">
              当前错题有未保存的修改，是否保存？
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-100 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900 dark:bg-red-950/50 transition-all duration-200 ease-out active:scale-95"
            @click="emit('discard')"
          >
            不保存
          </button>
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:brightness-110 transition-all"
            @click="emit('save')"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
