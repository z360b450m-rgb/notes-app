<script setup lang="ts">
defineProps<{ value?: number; label: string }>()
</script>

<template>
  <div class="task-progress">
    <progress :value="value" max="100" :aria-label="label" />
    <span v-if="value !== undefined">{{ Math.round(value) }}%</span>
    <span v-else class="text-brand-mid">处理中…</span>
  </div>
</template>

<style scoped>
.task-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 12px;
}
progress {
  display: block;
  flex: 1;
  min-width: 0;
  height: 7px;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(128 128 128 / 16%);
  accent-color: #d97757;
}
progress::-webkit-progress-bar {
  background: rgb(128 128 128 / 16%);
  border-radius: 999px;
}
progress::-webkit-progress-value {
  background: #d97757;
  border-radius: 999px;
  transition: width 0.25s;
}
progress:indeterminate {
  background:
    linear-gradient(90deg, transparent, #d97757, transparent) 0 0 / 45% 100% no-repeat,
    rgb(128 128 128 / 16%);
  animation: task-loading 1.5s ease-in-out infinite alternate;
}
progress:indeterminate::-webkit-progress-bar {
  background: transparent;
}
@keyframes task-loading {
  to {
    background-position: 100% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  progress:indeterminate {
    animation: none;
    background-position: 50% 0;
  }
}
</style>
