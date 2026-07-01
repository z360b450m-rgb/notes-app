<script setup lang="ts">
// @AI-NOTE: 答案面板组件 —— 纯展示 + 编辑。数据通过 props 传入,
// 变更通过 emit 委托。禁止直接操作存储或实现保存逻辑。
import { ref, watch, nextTick, computed, inject, type Ref } from 'vue'
import CameraCapture from './CameraCapture.vue'
import ScreenshotPicker from './ScreenshotPicker.vue'

const props = defineProps<{
  type: 'wrong' | 'correct'
  hidden: boolean
  modelValue: string
  entryId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [html: string]
  reveal: []
  blur: []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
}>()

const drawingEnabled = inject<Ref<boolean>>('drawingEnabled', ref(false))

const bodyRef = ref<HTMLDivElement | null>(null)
const canvasContainerRef = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const camOpen = ref(false)
const screenshotOpen = ref(false)
const wrapperRef = ref<HTMLDivElement | null>(null)

const isWrong = props.type === 'wrong'
const label = isWrong ? '错误答案' : '正确答案'
const dotClass = isWrong ? 'bg-red-400' : 'bg-emerald-400'

const panelBg = isWrong
  ? 'bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
  : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20'
const headerBg = isWrong ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'
const headerBorder = isWrong
  ? 'border-red-100 dark:border-red-500/20'
  : 'border-emerald-100 dark:border-emerald-500/20'
const headerText = isWrong
  ? 'text-red-600 dark:text-red-400'
  : 'text-emerald-600 dark:text-emerald-400'
const hiddenBg = isWrong ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'
const hiddenColor = isWrong
  ? 'text-red-500 dark:text-red-400'
  : 'text-emerald-500 dark:text-emerald-400'

let suppressInput = false

const showHidden = computed(() => props.type === 'correct' && props.hidden)

function syncContent() {
  nextTick(() => {
    if (bodyRef.value) {
      suppressInput = true
      bodyRef.value.innerHTML = props.modelValue
      suppressInput = false
    }
  })
}

watch(
  () => props.entryId,
  () => {
    syncContent()
    nextTick(() => {
      if (canvasContainerRef.value && props.entryId) {
        emit(
          'mount-canvas',
          canvasContainerRef.value,
          props.entryId,
          props.type === 'wrong' ? 'wrongAnswer' : 'correctAnswer',
        )
      }
    })
  },
  { immediate: true },
)

watch(showHidden, (hidden) => {
  if (!hidden) {
    syncContent()
    nextTick(() => {
      if (canvasContainerRef.value && props.entryId) {
        emit(
          'mount-canvas',
          canvasContainerRef.value,
          props.entryId,
          props.type === 'wrong' ? 'wrongAnswer' : 'correctAnswer',
        )
      }
    })
  }
})

function onInput() {
  if (suppressInput) return
  if (bodyRef.value) {
    emit('update:modelValue', bodyRef.value.innerHTML)
  }
}

function insertImageAtCursor(src: string) {
  const el = bodyRef.value
  if (!el) return
  el.focus()

  const img = document.createElement('img')
  img.src = src
  img.style.maxWidth = '100%'
  img.style.borderRadius = '6px'

  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(img)
    range.collapse(false)
    const br = document.createElement('br')
    range.insertNode(br)
    range.setStartAfter(br)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } else {
    el.appendChild(img)
    const br = document.createElement('br')
    el.appendChild(br)
  }
  onInput()
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      const reader = new FileReader()
      reader.onload = () => {
        insertImageAtCursor(reader.result as string)
      }
      reader.readAsDataURL(blob)
      break
    }
  }
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
  }
}

function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  e.preventDefault()
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        insertImageAtCursor(reader.result as string)
      }
      reader.readAsDataURL(file)
      break
    }
  }
}

function onBodyWheel(e: WheelEvent) {
  const el = wrapperRef.value
  if (!el) return
  const atTop = el.scrollTop <= 0
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
  if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
    e.preventDefault()
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

function onFileChange() {
  const file = fileInput.value?.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    insertImageAtCursor(reader.result as string)
  }
  reader.readAsDataURL(file)
  fileInput.value!.value = ''
}

function onCameraCapture(dataUrl: string) {
  camOpen.value = false
  insertImageAtCursor(dataUrl)
}

function onScreenshotCapture(dataUrl: string) {
  screenshotOpen.value = false
  insertImageAtCursor(dataUrl)
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    class="answer-panel flex-1 flex flex-col overflow-hidden overscroll-contain rounded-lg border group"
    :class="panelBg"
  >
    <div
      class="panel-label flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b flex-shrink-0"
      :class="[headerBg, headerBorder, headerText]"
    >
      <span class="w-2 h-2 rounded-full" :class="dotClass" />
      {{ label }}

      <!-- Image tools (top-right) -->
      <div v-if="!showHidden" class="ml-auto flex items-center gap-0.5">
        <button
          class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
          title="截屏"
          @click="screenshotOpen = true"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <button
          class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
          title="拍照"
          @click="camOpen = true"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
            />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
          title="导入图片"
          @click="openFilePicker"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange" />
      </div>
    </div>

    <div
      v-if="!showHidden"
      ref="wrapperRef"
      class="flex-1 overflow-y-auto overscroll-contain"
      @wheel="onBodyWheel"
    >
      <div ref="canvasContainerRef" :style="{ position: 'relative', minHeight: '100%' }">
        <div
          ref="bodyRef"
          class="panel-body px-3.5 py-3 text-base leading-relaxed md-content outline-none text-gray-800 dark:text-gray-200 min-h-full"
          :contenteditable="drawingEnabled ? 'false' : 'true'"
          :data-placeholder="'输入' + label + '…'"
          @input="onInput"
          @paste="onPaste"
          @dragover="onDragOver"
          @drop="onDrop"
          @blur="emit('blur')"
        />
      </div>
    </div>

    <div
      v-else
      class="flex-1 flex items-center justify-center cursor-pointer select-none rounded-b-lg transition-all duration-200 ease-out active:scale-[0.98]"
      :class="[hiddenBg, hiddenColor]"
      @click="emit('reveal')"
    >
      <span class="text-sm font-medium">点击显示{{ label }}</span>
    </div>
  </div>

  <CameraCapture v-if="camOpen" @capture="onCameraCapture" @close="camOpen = false" />

  <ScreenshotPicker
    v-if="screenshotOpen"
    @capture="onScreenshotCapture"
    @close="screenshotOpen = false"
  />
</template>

<style scoped>
.panel-body:empty::before {
  content: attr(data-placeholder);
  color: #cbd5e1;
}
.dark .panel-body:empty::before {
  color: #4b5563;
}
</style>
