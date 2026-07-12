<script setup lang="ts">
// @AI-NOTE: 图像裁剪器 —— 纯交互组件。裁剪后的 DataURL
// 通过 emit 发送, 不在此存储或操作业务数据。
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

defineProps<{
  imageSrc: string
}>()

const emit = defineEmits<{
  crop: [dataUrl: string]
  skip: []
  cancel: []
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

const imgDisplay = ref({ x: 0, y: 0, w: 0, h: 0 })
const cropRect = ref({ x: 0, y: 0, w: 0, h: 0 })
const imageLoaded = ref(false)

const dragging = ref<'move' | 'nw' | 'ne' | 'sw' | 'se' | 'create' | null>(null)
const dragStart = ref({ x: 0, y: 0, cx: 0, cy: 0, cw: 0, ch: 0 })

const HANDLE = 14
const MIN_SIZE = 20

function initCrop() {
  if (!imgDisplay.value.w || !imgDisplay.value.h) return
  const m = 0.08
  cropRect.value = {
    x: imgDisplay.value.x + imgDisplay.value.w * m,
    y: imgDisplay.value.y + imgDisplay.value.h * m,
    w: imgDisplay.value.w * (1 - m * 2),
    h: imgDisplay.value.h * (1 - m * 2),
  }
}

function onImageLoad() {
  if (!containerRef.value || !imgRef.value) return
  const cw = containerRef.value.clientWidth
  const ch = containerRef.value.clientHeight
  const iw = imgRef.value.naturalWidth
  const ih = imgRef.value.naturalHeight

  const scale = Math.min(cw / iw, ch / ih, 1)
  const dw = iw * scale
  const dh = ih * scale

  imgDisplay.value = {
    x: (cw - dw) / 2,
    y: (ch - dh) / 2,
    w: dw,
    h: dh,
  }

  imageLoaded.value = true
  nextTick(() => initCrop())
}

function hitTest(px: number, py: number): 'nw' | 'ne' | 'sw' | 'se' | 'move' | null {
  const r = cropRect.value
  const h = HANDLE
  if (Math.abs(px - r.x) < h && Math.abs(py - r.y) < h) return 'nw'
  if (Math.abs(px - (r.x + r.w)) < h && Math.abs(py - r.y) < h) return 'ne'
  if (Math.abs(px - r.x) < h && Math.abs(py - (r.y + r.h)) < h) return 'sw'
  if (Math.abs(px - (r.x + r.w)) < h && Math.abs(py - (r.y + r.h)) < h) return 'se'
  if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return 'move'
  return null
}

function clampCrop() {
  const r = cropRect.value
  const img = imgDisplay.value
  if (r.w < MIN_SIZE) r.w = MIN_SIZE
  if (r.h < MIN_SIZE) r.h = MIN_SIZE
  if (r.x < img.x) r.x = img.x
  if (r.y < img.y) r.y = img.y
  if (r.x + r.w > img.x + img.w) r.x = img.x + img.w - r.w
  if (r.y + r.h > img.y + img.h) r.y = img.y + img.h - r.h
  // Re-clamp after coordinate adjustments above could have invalidated size
  if (r.x < img.x) {
    r.w -= img.x - r.x
    r.x = img.x
  }
  if (r.y < img.y) {
    r.h -= img.y - r.y
    r.y = img.y
  }
  if (r.w < MIN_SIZE) r.w = MIN_SIZE
  if (r.h < MIN_SIZE) r.h = MIN_SIZE
}

function onPointerDown(e: PointerEvent) {
  if (!imageLoaded.value) return
  const hit = hitTest(e.clientX, e.clientY)
  if (hit) {
    dragging.value = hit
    dragStart.value = {
      x: e.clientX,
      y: e.clientY,
      cx: cropRect.value.x,
      cy: cropRect.value.y,
      cw: cropRect.value.w,
      ch: cropRect.value.h,
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  } else {
    dragging.value = 'create'
    dragStart.value = {
      x: e.clientX,
      y: e.clientY,
      cx: e.clientX,
      cy: e.clientY,
      cw: 0,
      ch: 0,
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - dragStart.value.x
  const dy = e.clientY - dragStart.value.y
  const ds = dragStart.value

  switch (dragging.value) {
    case 'move':
      cropRect.value.x = ds.cx + dx
      cropRect.value.y = ds.cy + dy
      break
    case 'se': {
      cropRect.value.w = Math.max(MIN_SIZE, ds.cw + dx)
      cropRect.value.h = Math.max(MIN_SIZE, ds.ch + dy)
      break
    }
    case 'nw': {
      const nw = Math.max(MIN_SIZE, ds.cw - dx)
      const nh = Math.max(MIN_SIZE, ds.ch - dy)
      cropRect.value.x = ds.cx + (ds.cw - nw)
      cropRect.value.y = ds.cy + (ds.ch - nh)
      cropRect.value.w = nw
      cropRect.value.h = nh
      break
    }
    case 'ne': {
      const nw = Math.max(MIN_SIZE, ds.cw + dx)
      const nh = Math.max(MIN_SIZE, ds.ch - dy)
      cropRect.value.y = ds.cy + (ds.ch - nh)
      cropRect.value.w = nw
      cropRect.value.h = nh
      break
    }
    case 'sw': {
      const nw = Math.max(MIN_SIZE, ds.cw - dx)
      const nh = Math.max(MIN_SIZE, ds.ch + dy)
      cropRect.value.x = ds.cx + (ds.cw - nw)
      cropRect.value.w = nw
      cropRect.value.h = nh
      break
    }
    case 'create': {
      const x1 = Math.min(e.clientX, ds.cx)
      const y1 = Math.min(e.clientY, ds.cy)
      const x2 = Math.max(e.clientX, ds.cx)
      const y2 = Math.max(e.clientY, ds.cy)
      cropRect.value.x = x1
      cropRect.value.y = y1
      cropRect.value.w = x2 - x1
      cropRect.value.h = y2 - y1
      break
    }
  }
  clampCrop()
}

function onPointerUp() {
  dragging.value = null
}

function doCrop() {
  const canvas = document.createElement('canvas')
  const img = imgRef.value!
  const d = imgDisplay.value
  const c = cropRect.value

  const sx = ((c.x - d.x) / d.w) * img.naturalWidth
  const sy = ((c.y - d.y) / d.h) * img.naturalHeight
  const sw = (c.w / d.w) * img.naturalWidth
  const sh = (c.h / d.h) * img.naturalHeight

  canvas.width = Math.round(sw)
  canvas.height = Math.round(sh)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)

  emit('crop', canvas.toDataURL('image/png'))
}

// Keyboard shortcut: Enter to confirm, Escape to skip
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') doCrop()
  if (e.key === 'Escape') emit('skip')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    ref="containerRef"
    class="fixed inset-0 z-[60] bg-black/80 select-none"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <!-- Image -->
    <img
      ref="imgRef"
      :src="imageSrc"
      class="absolute max-w-none opacity-0"
      :class="{ 'opacity-100': imageLoaded }"
      :style="{
        left: imgDisplay.x + 'px',
        top: imgDisplay.y + 'px',
        width: imgDisplay.w + 'px',
        height: imgDisplay.h + 'px',
        transition: 'opacity 0.15s',
      }"
      @load="onImageLoad"
      draggable="false"
    />

    <!-- Crop overlay -->
    <div v-if="imageLoaded" class="absolute inset-0 pointer-events-none">
      <!-- The crop rect with box-shadow darkening everything outside -->
      <div
        class="absolute pointer-events-none"
        :style="{
          left: cropRect.x + 'px',
          top: cropRect.y + 'px',
          width: cropRect.w + 'px',
          height: cropRect.h + 'px',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          outline: '2px dashed rgba(255,255,255,0.7)',
          outlineOffset: '-1px',
        }"
      >
        <!-- Corner handles -->
        <div
          class="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-gray-300 rounded-sm pointer-events-auto cursor-nwse-resize"
        />
        <div
          class="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-gray-300 rounded-sm pointer-events-auto cursor-nesw-resize"
        />
        <div
          class="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-gray-300 rounded-sm pointer-events-auto cursor-nesw-resize"
        />
        <div
          class="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-gray-300 rounded-sm pointer-events-auto cursor-nwse-resize"
        />

        <!-- Size label -->
        <span
          class="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] text-white/70 whitespace-nowrap font-mono"
        >
          {{ Math.round((cropRect.w / imgDisplay.w) * (imgRef?.naturalWidth ?? 1)) }} ×
          {{ Math.round((cropRect.h / imgDisplay.h) * (imgRef?.naturalHeight ?? 1)) }}
        </span>
      </div>
    </div>

    <!-- Toolbar -->
    <div
      v-if="imageLoaded"
      class="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-gray-900/90 backdrop-blur rounded-xl px-4 py-2.5 shadow-2xl border border-white/10"
    >
      <button
        class="px-4 py-1.5 text-xs font-medium text-white/60 hover:text-white/90 transition-colors rounded-lg hover:bg-white/10"
        @click="emit('cancel')"
      >
        返回
      </button>
      <button
        class="px-4 py-1.5 text-xs font-medium text-white/60 hover:text-white/90 transition-colors rounded-lg hover:bg-white/10"
        @click="emit('skip')"
      >
        跳过裁剪
      </button>
      <button
        class="px-5 py-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 transition-colors rounded-lg active:scale-95"
        @click="doCrop"
      >
        裁剪并插入
      </button>
    </div>

    <!-- Hint -->
    <div
      v-if="imageLoaded && cropRect.w === 0"
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-white/50 pointer-events-none"
    >
      拖拽选择裁剪区域
    </div>
  </div>
</template>
