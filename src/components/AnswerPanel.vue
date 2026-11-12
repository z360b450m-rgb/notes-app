<script setup lang="ts">
// @AI-NOTE: 答案面板组件 —— 纯展示 + 编辑。数据通过 props 传入,
// 变更通过 emit 委托。禁止直接操作存储或实现保存逻辑。
import { ref, watch, nextTick, computed, inject, onUnmounted, type Ref } from 'vue'
import ImageTextModal from './ImageTextModal.vue'
import { captureEditorRange } from '@/utils/imageTextInsert'
import { useImageTextInsertion } from '@/composables/useImageTextInsertion'
import CameraCapture from './CameraCapture.vue'
import ScreenshotPicker from './ScreenshotPicker.vue'
import RichTextSizeControls from './RichTextSizeControls.vue'
import EditorImageActions from './EditorImageActions.vue'
import QuestionLinkModal from './QuestionLinkModal.vue'
import type { NoteEntry } from '@/types'
import { toDisplayHtml, toStorageHtml } from '@/services/imageStorage'
import { useRichTextSizing } from '@/composables/useRichTextSizing'
import { pastePlainText } from '@/utils/plainTextPaste'
import { decorateInternalLinks } from '@/utils/internalLinks'
import { useMathPreview } from '@/composables/useMathPreview'

const props = defineProps<{
  type: 'wrong' | 'correct'
  hidden: boolean
  modelValue: string
  entryId: string
  notebookId: string
  layoutEditing?: boolean
  formattingActive: boolean
  entries: NoteEntry[]
}>()

const emit = defineEmits<{
  'update:modelValue': [html: string]
  reveal: []
  blur: []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
  'layout-drag-start': [event: PointerEvent]
  'activate-formatting': [panel: 'wrong' | 'correct']
  'open-entry': [id: string]
}>()

const drawingEnabled = inject<Ref<boolean>>('drawingEnabled', ref(false))

const bodyRef = ref<HTMLDivElement | null>(null)
useMathPreview(() => bodyRef.value)
const canvasContainerRef = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const camOpen = ref(false)
const screenshotOpen = ref(false)
const wrapperRef = ref<HTMLDivElement | null>(null)
const showQuestionLinkModal = ref(false)
const linkedTargetId = ref<string | null>(null)

const {
  hasSelectedImage,
  imageWidth,
  hasTextSelection,
  isBold,
  boldMixed,
  highlightColor,
  captureSelection,
  handleEditorClick,

  toggleBold,
  applyHighlight,
  applyImageWidth,
  serializeHtml,
  resetSizingState,
  insertInternalLink,
  removeInternalLink,
} = useRichTextSizing(
  () => bodyRef.value,
  onInput,
  (targetId) => {
    linkedTargetId.value = targetId
    showQuestionLinkModal.value = true
  },
)

function requestQuestionLink() {
  linkedTargetId.value = null
  showQuestionLinkModal.value = true
}

function chooseQuestionLink(target: NoteEntry) {
  if (target.id === props.entryId) return
  if (insertInternalLink(target.id, target.title || '关联题目')) showQuestionLinkModal.value = false
}

function unlinkQuestion() {
  if (removeInternalLink()) showQuestionLinkModal.value = false
}

function openLinkedEntry(id: string) {
  if (!props.entries.some((entry) => entry.id === id)) return
  showQuestionLinkModal.value = false
  emit('open-entry', id)
}

const isWrong = props.type === 'wrong'
const label = isWrong ? '错误答案' : '正确答案'
const dotClass = isWrong ? 'bg-[#b85c4b] dark:bg-[#df9a8c]' : 'bg-[#63816b] dark:bg-[#a0b8a5]'

const panelBg = isWrong
  ? 'bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
  : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20'
const headerBg = isWrong ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'
const headerBorder = isWrong
  ? 'border-red-100 dark:border-red-500/20'
  : 'border-emerald-100 dark:border-emerald-500/20'
const headerText = isWrong
  ? 'text-[#b85c4b] dark:text-[#df9a8c]'
  : 'text-[#63816b] dark:text-[#a0b8a5]'
const hiddenBg = isWrong ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'
const hiddenColor = isWrong
  ? 'text-red-500 dark:text-red-400'
  : 'text-emerald-500 dark:text-emerald-400'

let suppressInput = false

const showHidden = computed(() => props.hidden)

function syncContent() {
  nextTick(() => {
    if (bodyRef.value) {
      suppressInput = true
      bodyRef.value.innerHTML = toDisplayHtml(props.modelValue)
      decorateInternalLinks(bodyRef.value, props.entries)
      suppressInput = false
    }
  })
}

watch(
  () => props.entryId,
  () => {
    showQuestionLinkModal.value = false
    linkedTargetId.value = null
    resetSizingState()
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

watch(
  () => props.entries.map((entry) => `${entry.id}\u0000${entry.title}`).join('\u0001'),
  () => {
    nextTick(() => {
      if (bodyRef.value) decorateInternalLinks(bodyRef.value, props.entries)
    })
  },
)

function onInput() {
  if (suppressInput) return
  if (bodyRef.value) {
    emit('update:modelValue', toStorageHtml(serializeHtml()))
  }
}

const imageTextSrc = ref('')
let imageInsertionRange: Range | null = null
const {
  insert: insertRecognized,
  inserting: imageInserting,
  insertionError: imageInsertionError,
  cancelInsertion,
} = useImageTextInsertion(
  () => `${props.notebookId}/${props.entryId}/${props.hidden}`,
  () => props.notebookId,
)
function closeImageText() {
  cancelInsertion()
  if (imageTextSrc.value.startsWith('blob:')) URL.revokeObjectURL(imageTextSrc.value)
  imageTextSrc.value = ''
  imageInsertionRange = null
}
function insertImageAtCursor(source: Blob | string) {
  const position = captureEditorRange(bodyRef.value) || imageInsertionRange
  closeImageText()
  imageInsertionRange = position
  imageTextSrc.value = source instanceof Blob ? URL.createObjectURL(source) : source
}
async function onTextConfirm(text: string, source: string, keepOriginal: boolean) {
  if (!imageTextSrc.value) return
  if (
    await insertRecognized(
      bodyRef.value,
      text,
      keepOriginal ? source : undefined,
      imageInsertionRange,
      onInput,
    )
  )
    closeImageText()
}
async function onImageOnly(source: string) {
  await onTextConfirm('', source, true)
}
watch(
  () => [props.notebookId, props.entryId, props.hidden],
  () => {
    closeImageText()
    camOpen.value = false
    screenshotOpen.value = false
  },
  { flush: 'sync' },
)
onUnmounted(closeImageText)

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  for (const item of Array.from(items || [])) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      void insertImageAtCursor(blob)
      return
    }
  }
  if (pastePlainText(e, bodyRef.value)) onInput()
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
      void insertImageAtCursor(file)
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
  imageInsertionRange = captureEditorRange(bodyRef.value)
  fileInput.value?.click()
}

function openCapture(kind: 'camera' | 'screenshot') {
  imageInsertionRange = captureEditorRange(bodyRef.value)
  if (kind === 'camera') camOpen.value = true
  else screenshotOpen.value = true
}

function onFileChange() {
  const file = fileInput.value?.files?.[0]
  if (!file) return
  void insertImageAtCursor(file)
  fileInput.value!.value = ''
}

function onCameraCapture(dataUrl: string) {
  camOpen.value = false
  void insertImageAtCursor(dataUrl)
}

function onScreenshotCapture(dataUrl: string) {
  screenshotOpen.value = false
  void insertImageAtCursor(dataUrl)
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    class="answer-panel flex-1 min-h-0 flex flex-col overflow-hidden overscroll-contain rounded-lg border group"
    :class="panelBg"
    @mousedown="emit('activate-formatting', type)"
    @focusin="emit('activate-formatting', type)"
  >
    <div
      class="panel-label flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b flex-shrink-0"
      :class="[headerBg, headerBorder, headerText]"
    >
      <span class="w-2 h-2 rounded-full" :class="dotClass" />
      {{ label }}
      <button
        type="button"
        class="answer-visibility-action ml-auto inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-normal"
        :data-testid="isWrong ? 'wrong-answer-toggle' : 'correct-answer-toggle'"
        :aria-label="showHidden ? `显示${label}` : `隐藏${label}`"
        :aria-expanded="!showHidden"
        :title="showHidden ? `显示${label}` : `隐藏${label}`"
        @click.stop="emit('reveal')"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
          <path v-if="!showHidden" d="M2 2l20 20" />
        </svg>
        {{ showHidden ? '显示' : '隐藏' }}
      </button>

      <button
        v-show="layoutEditing"
        class="panel-drag-button ml-1 inline-flex touch-none cursor-grab items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[10px] font-semibold opacity-70 transition-opacity hover:opacity-100 active:cursor-grabbing"
        :title="`拖动${label}板块换位`"
        :aria-label="`拖动${label}板块换位`"
        @pointerdown.stop="emit('layout-drag-start', $event)"
        @click.stop
      >
        ⠿ 拖动
      </button>

      <!-- Panel-specific image insertion tools -->
      <Teleport defer to="#shared-image-tools"
        ><div v-show="formattingActive && !showHidden" class="flex items-center gap-1">
          <EditorImageActions
            @screenshot="openCapture('screenshot')"
            @camera="openCapture('camera')"
            @import="openFilePicker"
          />
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onFileChange"
          /></div
      ></Teleport>
    </div>

    <div
      v-if="!showHidden"
      ref="wrapperRef"
      class="flex-1 min-h-0 overflow-y-auto overscroll-contain"
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
          @click="handleEditorClick"
          @mouseup="captureSelection"
          @keyup="captureSelection"
          @blur="emit('blur')"
        />
      </div>
    </div>

    <div
      v-else
      class="flex-1 flex items-center justify-center select-none transition-all duration-200 ease-out"
      :class="[hiddenBg, hiddenColor]"
    >
      <span class="text-sm font-medium">{{ label }}已隐藏</span>
    </div>
  </div>

  <Teleport v-if="formattingActive && !showHidden" defer to="#rich-text-formatting-toolbar">
    <RichTextSizeControls
      :image-selected="hasSelectedImage"
      :image-width="imageWidth"
      :text-selected="hasTextSelection"
      :bold="isBold"
      :bold-mixed="boldMixed"
      :highlight-color="highlightColor"
      @preserve-selection="captureSelection"
      @toggle-bold="toggleBold"
      @highlight="applyHighlight"
      @image-width="applyImageWidth"
      @link="requestQuestionLink"
    />
  </Teleport>

  <Transition name="modal"
    ><CameraCapture v-if="camOpen" @capture="onCameraCapture" @close="camOpen = false"
  /></Transition>

  <ScreenshotPicker
    v-if="screenshotOpen"
    @capture="onScreenshotCapture"
    @close="screenshotOpen = false"
  />

  <ImageTextModal
    v-if="imageTextSrc"
    :image-src="imageTextSrc"
    :notebook-id="notebookId"
    :inserting="imageInserting"
    :insertion-error="imageInsertionError"
    @confirm="onTextConfirm"
    @skip="onImageOnly"
    @cancel="closeImageText"
  />

  <QuestionLinkModal
    :visible="showQuestionLinkModal"
    :entries="entries"
    :current-entry-id="entryId"
    :linked-target-id="linkedTargetId"
    @choose="chooseQuestionLink"
    @open="openLinkedEntry"
    @remove="unlinkQuestion"
    @cancel="showQuestionLinkModal = false"
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
