<script setup lang="ts">
// @AI-NOTE: Toast 通知组件 —— 纯 UI 组件。消息内容和可见性
// 由父组件通过 props/events 控制, 不在此管理业务反馈逻辑。
defineProps<{ message: string }>()
defineEmits<{ dismiss: [] }>()
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <Transition name="toast">
    <div
      v-if="message"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      class="app-toast fixed bottom-6 right-6 max-w-[calc(100vw-32px)] flex items-start gap-4 px-4 py-3 rounded-lg bg-slate-800 text-white text-sm z-[1000] break-words"
    >
      <span class="min-w-0">{{ message }}</span>
      <button type="button" aria-label="关闭提示" class="shrink-0" @click="$emit('dismiss')">
        ✕
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active {
  animation: toast-in 0.3s ease;
}
.toast-leave-active {
  animation: toast-in 0.3s ease reverse;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    animation: none;
  }
}
</style>
