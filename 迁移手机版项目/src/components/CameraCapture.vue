<script setup lang="ts">
// @AI-NOTE: 摄像头拍照组件 —— 封装 WebRTC 媒体捕获。拍照结果
// 通过 emit 发送 DataURL, 不在此存储或操作业务数据。
import { ref, onUnmounted } from 'vue'

const emit = defineEmits<{
  capture: [dataUrl: string]
  close: []
}>()

const video = ref<HTMLVideoElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const stream = ref<MediaStream | null>(null)
const error = ref('')
const ready = ref(false)

async function start() {
  error.value = ''
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    })
    if (video.value) {
      video.value.srcObject = stream.value
      ready.value = true
    }
  } catch {
    error.value = '无法访问摄像头，请检查权限设置'
  }
}

function capture() {
  if (!video.value || !canvas.value) return
  const v = video.value
  const c = canvas.value
  c.width = v.videoWidth
  c.height = v.videoHeight
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.drawImage(v, 0, 0)
  const dataUrl = c.toDataURL('image/jpeg', 0.9)
  emit('capture', dataUrl)
}

function stop() {
  if (stream.value) {
    stream.value.getTracks().forEach((t) => t.stop())
    stream.value = null
  }
  ready.value = false
  emit('close')
}

start()

onUnmounted(() => {
  stop()
})
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="stop">
    <div
      class="bg-white dark:bg-[#141413] rounded-2xl shadow-2xl overflow-hidden w-[480px] max-w-[92vw]"
    >
      <div class="relative bg-black">
        <video ref="video" autoplay playsinline class="w-full aspect-[4/3] object-cover" />
        <canvas ref="canvas" class="hidden" />
        <div
          v-if="!ready && !error"
          class="absolute inset-0 flex items-center justify-center text-white text-sm"
        >
          启动摄像头中…
        </div>
        <div
          v-if="error"
          class="absolute inset-0 flex items-center justify-center text-white text-sm px-4 text-center"
        >
          {{ error }}
        </div>
      </div>
      <div class="flex items-center justify-between px-5 py-3">
        <button
          class="px-4 py-2 rounded-lg text-[13px] text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#1e1e1c] transition-all active:scale-95"
          @click="stop"
        >
          取消
        </button>
        <button
          class="w-14 h-14 rounded-full bg-white border-4 border-gray-300 hover:border-accent transition-all active:scale-90 flex items-center justify-center flex-shrink-0"
          :class="{ 'opacity-30 pointer-events-none': !ready }"
          :disabled="!ready"
          @click="capture"
        >
          <div class="w-10 h-10 rounded-full bg-white border-2 border-gray-300" />
        </button>
        <div class="w-[64px]" />
      </div>
    </div>
  </div>
</template>
