<script setup lang="ts">
// @AI-NOTE: Toast 通知组件 —— 纯 UI 组件。消息内容和可见性
// 由父组件通过 props/events 控制, 不在此管理业务反馈逻辑。
import { watch, ref } from 'vue'

const props = defineProps<{ message: string }>()
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.message,
  (msg) => {
    if (timer) clearTimeout(timer)
    if (!msg) {
      visible.value = false
      return
    }
    visible.value = true
    timer = setTimeout(() => {
      visible.value = false
    }, 1600)
  },
)
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <Transition name="toast">
    <div
      v-if="visible"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm z-[1000] pointer-events-none whitespace-nowrap"
    >
      {{ message }}
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
    transform: translateX(-50%) translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
