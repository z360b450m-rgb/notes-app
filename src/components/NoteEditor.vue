<script setup lang="ts">
// @AI-NOTE: 编辑器组件 —— 数据读写通过 useEntries/useDrawing Hook。
// 禁止直接操作数据库、实现 SRS 算法、管理条目生命周期。
import { ref, computed, watch, onUnmounted, nextTick, inject, type Ref } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import { useReviewLogs } from '@/composables/useReviewLogs'
import CameraCapture from './CameraCapture.vue'
import ScreenshotPicker from './ScreenshotPicker.vue'
import ImageCropper from './ImageCropper.vue'
import ImageFilterModal from './ImageFilterModal.vue'
import AnswerPanel from './AnswerPanel.vue'
import TagMultiSelect from './TagMultiSelect.vue'
import RichTextSizeControls from './RichTextSizeControls.vue'
import { saveImage, toDisplayHtml, toStorageHtml } from '@/services/imageStorage'
import { useRichTextSizing } from '@/composables/useRichTextSizing'
// import { useKnowledgeBases } from '@/composables/useKnowledgeBases'
// const { kbs, refresh: refreshKbs } = useKnowledgeBases()
// refreshKbs()

const props = defineProps<{
  entry: NoteEntry
  group?: QuestionGroup | null
  groupEntries?: NoteEntry[]
  answersHidden: boolean
  allSubjects?: string[]
  allTags?: string[]
  allSources?: string[]
}>()

const emit = defineEmits<{
  update: []
  reveal: []
  'blur-save': []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
  'add-tag': [name: string]
  'enable-question-group': []
  'add-sub-question': []
  'select-sub-question': [id: string]
}>()

function onBlur() {
  emit('blur-save')
}

// Template refs
const questionBody = ref<HTMLDivElement | null>(null)
const questionContentRef = ref<HTMLDivElement | null>(null)
const materialBody = ref<HTMLDivElement | null>(null)
const materialContentRef = ref<HTMLDivElement | null>(null)
const materialFileInput = ref<HTMLInputElement | null>(null)
const editorLayoutEl = ref<HTMLDivElement | null>(null)
const materialPanelEl = ref<HTMLElement | null>(null)
const materialResizeHandle = ref<HTMLDivElement | null>(null)
const rightColumnEl = ref<HTMLDivElement | null>(null)
const questionPanelEl = ref<HTMLDivElement | null>(null)
const questionResizeHandle = ref<HTMLDivElement | null>(null)
const answersStackEl = ref<HTMLDivElement | null>(null)
const answerResizeHandle = ref<HTMLDivElement | null>(null)
const wrongPanelEl = ref<HTMLDivElement | null>(null)

const materialWidth = ref<number | null>(null)
const materialHeight = ref<number | null>(null)
const questionHeight = ref<number | null>(null)
const wrongAnswerHeight = ref<number | null>(null)

let suppressInput = false

const {
  hasSelectedImage: questionImageSelected,
  captureSelection: captureQuestionSelection,
  handleEditorClick: handleQuestionEditorClick,
  applyFontSize: applyQuestionFontSize,
  applyImageWidth: applyQuestionImageWidth,
  serializeHtml: serializeQuestionHtml,
  resetSizingState: resetQuestionSizing,
} = useRichTextSizing(() => questionBody.value, onQuestionInput)

const {
  hasSelectedImage: materialImageSelected,
  captureSelection: captureMaterialSelection,
  handleEditorClick: handleMaterialEditorClick,
  applyFontSize: applyMaterialFontSize,
  applyImageWidth: applyMaterialImageWidth,
  serializeHtml: serializeMaterialHtml,
  resetSizingState: resetMaterialSizing,
} = useRichTextSizing(() => materialBody.value, onMaterialInput)

// Helpers so template @event handlers stay single-statement (Vue compiler no ASI)
function onSubjectChange(e: Event) {
  props.entry.subject = (e.target as HTMLSelectElement).value
  emit('update')
}
function onSourceChange(e: Event) {
  props.entry.source = (e.target as HTMLSelectElement).value
  emit('update')
}
function onTagsChange(tags: string[]) {
  props.entry.tags = tags
  emit('update')
}
// function onKbChange(e: Event) {
//   props.entry.kbId = (e.target as HTMLSelectElement).value
//   emit('update')
// }
function onWrongAnswer(val: string) {
  props.entry.wrongAnswer = val
  emit('update')
}
function onCorrectAnswer(val: string) {
  props.entry.correctAnswer = val
  emit('update')
}

function onQuestionInput() {
  if (suppressInput) return
  if (questionBody.value) {
    props.entry.question = toStorageHtml(serializeQuestionHtml())
  }
  emit('update')
}

function onMaterialInput() {
  if (suppressInput || !props.group || !materialBody.value) return
  props.group.material = toStorageHtml(serializeMaterialHtml())
  emit('update')
}

function onQuestionPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      startPipeline(blob, 'question')
      break
    }
  }
}

// Image tools for question panel
const qCamOpen = ref(false)
const qScreenshotOpen = ref(false)
const qFileInput = ref<HTMLInputElement | null>(null)
const imageToolTarget = ref<'question' | 'material'>('question')

// Image pipeline: crop → filter → insert
const pipelineStage = ref<'none' | 'crop' | 'filter'>('none')
const pipelineSrc = ref('')
const pipelineTarget = ref<'question' | 'material'>('question')

function openScreenshot(target: 'question' | 'material') {
  imageToolTarget.value = target
  qScreenshotOpen.value = true
}

function openCamera(target: 'question' | 'material') {
  imageToolTarget.value = target
  qCamOpen.value = true
}

function replacePipelineSource(source = '') {
  if (pipelineSrc.value.startsWith('blob:')) URL.revokeObjectURL(pipelineSrc.value)
  pipelineSrc.value = source
}

function startPipeline(src: string | Blob, target: 'question' | 'material' = 'question') {
  pipelineTarget.value = target
  replacePipelineSource(typeof src === 'string' ? src : URL.createObjectURL(src))
  pipelineStage.value = 'crop'
}

async function doInsertImage(src: string) {
  const el = pipelineTarget.value === 'material' ? materialBody.value : questionBody.value
  if (!el) return
  let displayUrl: string
  try {
    displayUrl = (await saveImage(props.entry.notebookId, src)).displayUrl
  } catch (error) {
    console.error('Failed to save image', error)
    return
  }
  el.focus()

  const img = document.createElement('img')
  img.src = displayUrl
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
    el.appendChild(document.createElement('br'))
  }
  if (pipelineTarget.value === 'material') onMaterialInput()
  else onQuestionInput()
}

// --- Crop stage ---
function onCropConfirm(croppedSrc: string) {
  replacePipelineSource(croppedSrc)
  pipelineStage.value = 'filter'
}

function onCropSkip() {
  pipelineStage.value = 'filter'
}

function onCropCancel() {
  pipelineStage.value = 'none'
  replacePipelineSource()
}

// --- Filter stage ---
async function onFilterConfirm(filteredSrc: string, _threshold: number) {
  pipelineStage.value = 'none'
  await doInsertImage(filteredSrc)
  replacePipelineSource()
}

async function onFilterSkip() {
  pipelineStage.value = 'none'
  await doInsertImage(pipelineSrc.value)
  replacePipelineSource()
}

function onFilterCancel() {
  pipelineStage.value = 'none'
  replacePipelineSource()
}

function insertQuestionImage(src: string) {
  startPipeline(src, imageToolTarget.value)
}

function onQuestionDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
}

function onQuestionDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  e.preventDefault()
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      startPipeline(file)
      break
    }
  }
}

function openQuestionFilePicker() {
  qFileInput.value?.click()
}

function openMaterialFilePicker() {
  materialFileInput.value?.click()
}

function onQuestionFileChange() {
  const file = qFileInput.value?.files?.[0]
  if (!file) return
  startPipeline(file)
  qFileInput.value!.value = ''
}

function onMaterialFileChange() {
  const file = materialFileInput.value?.files?.[0]
  if (!file) return
  startPipeline(file, 'material')
  materialFileInput.value!.value = ''
}

function onMaterialPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    e.preventDefault()
    const blob = item.getAsFile()
    if (blob) startPipeline(blob, 'material')
    break
  }
}

function onMaterialDrop(e: DragEvent) {
  const file = Array.from(e.dataTransfer?.files || []).find((item) =>
    item.type.startsWith('image/'),
  )
  if (!file) return
  e.preventDefault()
  startPipeline(file, 'material')
}

function onQuestionCamCapture(dataUrl: string) {
  qCamOpen.value = false
  insertQuestionImage(dataUrl)
}

function onQuestionScreenshotCapture(dataUrl: string) {
  qScreenshotOpen.value = false
  // ScreenshotPicker already has its own crop, go straight to filter
  pipelineTarget.value = imageToolTarget.value
  replacePipelineSource(dataUrl)
  pipelineStage.value = 'filter'
}

const drawingEnabled = inject<Ref<boolean>>('drawingEnabled', ref(false))
const resizeCanvas = inject<() => void>('resizeCanvas', () => {})

type PanelResizeType = 'material' | 'question' | 'answers'

interface PanelResizeState {
  type: PanelResizeType
  axis: 'x' | 'y'
  startPosition: number
  startSize: number
  availableSize: number
}

let panelResizeState: PanelResizeState | null = null

function startPanelResize(e: MouseEvent, type: PanelResizeType) {
  e.preventDefault()

  let startSize: number
  let availableSize: number
  let axis: 'x' | 'y' = 'y'

  if (type === 'material') {
    if (!editorLayoutEl.value || !materialPanelEl.value) return
    axis = window.matchMedia('(min-width: 1024px)').matches ? 'x' : 'y'
    if (axis === 'x') {
      startSize = materialPanelEl.value.offsetWidth
      availableSize =
        editorLayoutEl.value.clientWidth - (materialResizeHandle.value?.offsetWidth || 12)
    } else {
      startSize = materialPanelEl.value.offsetHeight
      availableSize = 680
    }
  } else if (type === 'question') {
    if (!rightColumnEl.value || !questionPanelEl.value) return
    startSize = questionPanelEl.value.offsetHeight
    availableSize =
      rightColumnEl.value.clientHeight - (questionResizeHandle.value?.offsetHeight || 12)
  } else {
    if (!answersStackEl.value || !wrongPanelEl.value) return
    startSize = wrongPanelEl.value.offsetHeight
    availableSize =
      answersStackEl.value.clientHeight - (answerResizeHandle.value?.offsetHeight || 12)
  }

  const startPosition = axis === 'x' ? e.clientX : e.clientY
  panelResizeState = { type, axis, startPosition, startSize, availableSize }
  document.body.classList.add('panel-resizing')
  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
  window.addEventListener('mousemove', resizePanels)
  window.addEventListener('mouseup', stopPanelResize)
}

function resizePanels(e: MouseEvent) {
  if (!panelResizeState) return
  const state = panelResizeState
  const currentPosition = state.axis === 'x' ? e.clientX : e.clientY
  const delta = currentPosition - state.startPosition

  if (state.type === 'material') {
    if (state.axis === 'x') {
      const max = Math.max(260, state.availableSize - 360)
      materialWidth.value = Math.max(260, Math.min(max, state.startSize + delta))
    } else {
      materialHeight.value = Math.max(180, Math.min(state.availableSize, state.startSize + delta))
    }
  } else if (state.type === 'question') {
    const max = Math.max(150, state.availableSize - 250)
    questionHeight.value = Math.max(150, Math.min(max, state.startSize + delta))
  } else {
    const max = Math.max(110, state.availableSize - 110)
    wrongAnswerHeight.value = Math.max(110, Math.min(max, state.startSize + delta))
  }

  resizeCanvas()
}

function stopPanelResize() {
  panelResizeState = null
  document.body.classList.remove('panel-resizing')
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', resizePanels)
  window.removeEventListener('mouseup', stopPanelResize)
  resizeCanvas()
}

function resetPanelSize(type: PanelResizeType) {
  if (type === 'material') {
    materialWidth.value = null
    materialHeight.value = null
  } else if (type === 'question') questionHeight.value = null
  else wrongAnswerHeight.value = null
  nextTick(resizeCanvas)
}

const currentGroupIndex = computed(() =>
  (props.groupEntries || []).findIndex((entry) => entry.id === props.entry.id),
)

function selectSibling(offset: number) {
  const siblings = props.groupEntries || []
  const next = siblings[currentGroupIndex.value + offset]
  if (next) emit('select-sub-question', next.id)
}

// Review history
const { reviewLogs } = useReviewLogs(() => props.entry.notebookId)
const historyOpen = ref(false)

const entryLogs = computed(() =>
  reviewLogs.value
    .filter((l) => l.entryId === props.entry.id)
    .sort((a, b) => a.timestamp - b.timestamp),
)

const QUALITY_DEFS: Record<number | string, { label: string; color: string }> = {
  0: { label: '遗忘', color: '#ef4444' },
  1: { label: '错误', color: '#f97316' },
  2: { label: '勉强', color: '#f59e0b' },
  3: { label: '困难', color: '#eab308' },
  4: { label: '犹豫', color: '#84cc16' },
  5: { label: '完美', color: '#22c55e' },
  forgot: { label: '遗忘', color: '#ef4444' },
  unfamiliar: { label: '不熟练', color: '#f59e0b' },
  mastered: { label: '掌握', color: '#22c55e' },
}

function qualityInfo(q: number | string) {
  return QUALITY_DEFS[q] ?? { label: String(q), color: '#9ca3af' }
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Set question content when entry changes, without v-html interference
watch(
  () => props.entry.id,
  () => {
    resetQuestionSizing()
    nextTick(() => {
      if (questionBody.value) {
        suppressInput = true
        questionBody.value.innerHTML = toDisplayHtml(props.entry.question)
        suppressInput = false
      }
      if (questionContentRef.value) {
        emit('mount-canvas', questionContentRef.value, props.entry.id, 'question')
      }
    })
  },
  { immediate: true },
)

watch(
  () => [props.group?.id, props.entry.id] as const,
  () => {
    resetMaterialSizing()
    nextTick(() => {
      if (!materialBody.value) return
      suppressInput = true
      materialBody.value.innerHTML = toDisplayHtml(props.group?.material || '')
      suppressInput = false
      if (props.group && materialContentRef.value) {
        emit('mount-canvas', materialContentRef.value, props.entry.id, 'material')
      }
    })
  },
  { immediate: true },
)

onUnmounted(() => {
  replacePipelineSource()
  stopPanelResize()
})

function onQuestionWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  const atTop = el.scrollTop <= 0
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
  if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
    e.preventDefault()
  }
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="flex-1 flex flex-col overflow-hidden overscroll-contain p-4 gap-3">
    <!-- Meta row -->
    <div class="flex items-center gap-2.5 px-1 flex-wrap">
      <!-- Subject select -->
      <div class="relative w-[130px]">
        <select
          class="w-full border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] rounded-lg px-2.5 py-1.5 text-xs outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all appearance-none cursor-pointer"
          :value="entry.subject"
          @change="onSubjectChange($event)"
          @blur="onBlur"
        >
          <option value="">-- 选择学科 --</option>
          <option v-for="s in allSubjects || []" :key="s" :value="s">{{ s }}</option>
          <option
            v-if="entry.subject && !(allSubjects || []).includes(entry.subject)"
            :value="entry.subject"
            hidden
          >
            {{ entry.subject }}
          </option>
        </select>
        <svg
          class="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-gray-400 dark:text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      <!-- Source select -->
      <div class="relative w-[130px]">
        <select
          class="w-full border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] rounded-lg px-2.5 py-1.5 text-xs outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all appearance-none cursor-pointer"
          :value="entry.source"
          @change="onSourceChange($event)"
          @blur="onBlur"
        >
          <option value="">-- 选择来源 --</option>
          <option v-for="s in allSources || []" :key="s" :value="s">{{ s }}</option>
          <option
            v-if="entry.source && !(allSources || []).includes(entry.source)"
            :value="entry.source"
            hidden
          >
            {{ entry.source }}
          </option>
        </select>
        <svg
          class="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-gray-400 dark:text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <!-- <select ...> ... </select> -->

      <!-- Tags multi-select (same style as subject/source) -->
      <div class="relative w-[150px]">
        <TagMultiSelect
          :model-value="entry.tags"
          :all-tags="allTags || []"
          @update:model-value="onTagsChange($event)"
          @add-tag="(name) => emit('add-tag', name)"
        />
      </div>
    </div>

    <!-- Review history timeline -->
    <div
      v-if="entryLogs.length > 0"
      class="mx-1 border border-gray-100 dark:border-[#2e2e2c] rounded-lg overflow-hidden flex-shrink-0"
    >
      <button
        class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-gray-400 dark:text-brand-mid hover:bg-gray-50 dark:hover:bg-[#1e1e1c] transition-colors"
        @click="historyOpen = !historyOpen"
      >
        <span class="flex items-center gap-1.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          复习历史 ({{ entryLogs.length }})
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="transition-transform duration-200"
          :class="{ 'rotate-180': historyOpen }"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div v-if="historyOpen" class="px-3 pb-2.5 overflow-x-auto">
        <div class="flex items-start min-w-max pt-1">
          <template v-for="(log, i) in entryLogs" :key="log.id">
            <div class="flex flex-col items-center gap-0.5 flex-shrink-0" style="min-width: 44px">
              <span
                class="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-900"
                :style="{ backgroundColor: qualityInfo(log.quality).color }"
              />
              <span class="text-[9px] text-gray-400 dark:text-brand-mid leading-none">{{
                fmtDate(log.timestamp)
              }}</span>
              <span
                class="text-[9px] font-medium leading-none"
                :style="{ color: qualityInfo(log.quality).color }"
              >
                {{ qualityInfo(log.quality).label }}
              </span>
            </div>
            <div
              v-if="i < entryLogs.length - 1"
              class="flex-shrink-0 h-px mt-[5px] w-5 bg-gray-200 dark:bg-[#2a2a28]"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- Shared material on the left; active sub-question and answers on the right. -->
    <div
      ref="editorLayoutEl"
      class="editor-layout flex-1 min-h-0 grid gap-y-3 overflow-y-auto lg:overflow-hidden"
      :class="{ 'has-group': group }"
      :style="{
        '--material-width': materialWidth ? `${materialWidth}px` : undefined,
        '--material-height': materialHeight ? `${materialHeight}px` : undefined,
      }"
    >
      <section
        v-if="group"
        ref="materialPanelEl"
        class="material-panel min-h-[220px] bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm flex flex-col overflow-hidden group"
      >
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-500 dark:text-brand-mid border-b border-gray-100 dark:border-[#2e2e2c] bg-brand-light dark:bg-[#1e1e1c] flex-shrink-0"
        >
          <span class="w-2 h-2 rounded-full bg-sky-400" />
          公共材料
          <span class="text-xs font-normal text-gray-400">
            一拖 {{ groupEntries?.length || 1 }}
          </span>
          <div v-if="!drawingEnabled" class="ml-auto flex items-center gap-0.5">
            <RichTextSizeControls
              :image-selected="materialImageSelected"
              @preserve-selection="captureMaterialSelection"
              @font-size="applyMaterialFontSize"
              @image-width="applyMaterialImageWidth"
            />
            <span class="mx-0.5 h-4 w-px bg-gray-200 dark:bg-[#3a3a37]" />
            <button class="editor-tool" title="截屏" @click="openScreenshot('material')">▧</button>
            <button class="editor-tool" title="拍照" @click="openCamera('material')">◎</button>
            <button class="editor-tool" title="导入图片" @click="openMaterialFilePicker">＋</button>
            <input
              ref="materialFileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onMaterialFileChange"
            />
          </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain" @wheel="onQuestionWheel">
          <div ref="materialContentRef" class="relative min-h-full">
            <div
              ref="materialBody"
              class="panel-body px-4 py-3 text-base leading-relaxed md-content outline-none min-h-full"
              :contenteditable="drawingEnabled ? 'false' : 'true'"
              data-placeholder="在这里输入所有小题共用的材料、图表或题干…"
              @input="onMaterialInput"
              @paste="onMaterialPaste"
              @dragover="onQuestionDragOver"
              @drop="onMaterialDrop"
              @click="handleMaterialEditorClick"
              @mouseup="captureMaterialSelection"
              @keyup="captureMaterialSelection"
              @blur="onBlur"
            />
          </div>
        </div>
      </section>

      <div
        v-if="group"
        ref="materialResizeHandle"
        class="panel-resizer panel-resizer-material"
        role="separator"
        aria-label="调整公共材料区域大小"
        title="拖动调整公共材料区域大小 · 双击恢复默认"
        @mousedown="startPanelResize($event, 'material')"
        @dblclick="resetPanelSize('material')"
      >
        <span />
      </div>

      <div ref="rightColumnEl" class="min-h-[560px] lg:min-h-0 flex flex-col overflow-hidden">
        <!-- Question panel -->
        <div
          ref="questionPanelEl"
          class="min-h-[150px] flex-[1.15] bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm flex flex-col overflow-hidden group"
          :style="questionHeight ? { flex: `0 0 ${questionHeight}px` } : undefined"
        >
          <div
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-400 dark:text-brand-mid border-b border-gray-100 dark:border-[#2e2e2c] bg-brand-light dark:bg-[#1e1e1c] flex-shrink-0"
          >
            <span class="w-2 h-2 rounded-full bg-accent" />
            题目

            <div v-if="group" class="ml-2 flex items-center gap-1">
              <button
                class="question-nav"
                :disabled="currentGroupIndex <= 0"
                title="上一小题"
                @click="selectSibling(-1)"
              >
                ‹
              </button>
              <span
                class="min-w-[58px] text-center text-[10px] font-medium text-gray-400 tabular-nums"
              >
                第 {{ currentGroupIndex + 1 }} / {{ groupEntries?.length || 1 }} 题
              </span>
              <button
                class="question-nav"
                :disabled="currentGroupIndex >= (groupEntries?.length || 1) - 1"
                title="下一小题"
                @click="selectSibling(1)"
              >
                ›
              </button>
              <button
                class="ml-1 px-2 py-1 rounded-md text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/15 transition-colors"
                @click="emit('add-sub-question')"
              >
                ＋ 添加小题
              </button>
            </div>
            <button
              v-else
              class="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#bd5c3d] bg-[#d97757] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:bg-[#c96849] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/45 focus-visible:ring-offset-2 active:translate-y-0 active:shadow-sm dark:border-[#e18a6d] dark:bg-[#c96849] dark:hover:bg-[#d97757] dark:focus-visible:ring-offset-[#141413]"
              title="将当前题目转换为包含公共材料和多个小题的题组"
              @click="emit('enable-question-group')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="7" height="6" rx="1" />
                <rect x="14" y="4" width="7" height="6" rx="1" />
                <rect x="8.5" y="14" width="7" height="6" rx="1" />
                <path d="M6.5 10v2h11v-2M12 12v2" />
              </svg>
              转为一拖 N 题组
            </button>

            <!-- Image tools (top-right) -->
            <div v-if="!drawingEnabled" class="ml-auto flex items-center gap-0.5">
              <RichTextSizeControls
                :image-selected="questionImageSelected"
                @preserve-selection="captureQuestionSelection"
                @font-size="applyQuestionFontSize"
                @image-width="applyQuestionImageWidth"
              />
              <span class="mx-0.5 h-4 w-px bg-gray-200 dark:bg-[#3a3a37]" />
              <button
                class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-brand-mid dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
                title="截屏"
                @click="openScreenshot('question')"
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
                class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-brand-mid dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
                title="拍照"
                @click="openCamera('question')"
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
                class="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-brand-mid dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-all active:scale-90"
                title="导入图片"
                @click="openQuestionFilePicker"
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
              <input
                ref="qFileInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="onQuestionFileChange"
              />
            </div>
          </div>
          <div class="flex-1 overflow-y-auto overscroll-contain" @wheel="onQuestionWheel">
            <div ref="questionContentRef" :style="{ position: 'relative', minHeight: '100%' }">
              <div class="relative h-full">
                <div
                  ref="questionBody"
                  class="panel-body px-3.5 py-3 text-base leading-relaxed md-content outline-none min-h-full"
                  :contenteditable="drawingEnabled ? 'false' : 'true'"
                  data-placeholder="在此输入当前小题…"
                  @input="onQuestionInput"
                  @paste="onQuestionPaste"
                  @dragover="onQuestionDragOver"
                  @drop="onQuestionDrop"
                  @click="handleQuestionEditorClick"
                  @mouseup="captureQuestionSelection"
                  @keyup="captureQuestionSelection"
                  @blur="onBlur"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          ref="questionResizeHandle"
          class="panel-resizer panel-resizer-h"
          role="separator"
          aria-label="调整题目和答案区域的高度"
          title="拖动调整上下高度 · 双击恢复默认"
          @mousedown="startPanelResize($event, 'question')"
          @dblclick="resetPanelSize('question')"
        >
          <span />
        </div>

        <!-- Answers stack -->
        <div
          ref="answersStackEl"
          class="flex-[2] flex flex-col min-h-[270px] overflow-hidden overscroll-contain"
        >
          <div
            ref="wrongPanelEl"
            class="flex-1 flex min-h-0"
            :style="wrongAnswerHeight ? { flex: `0 0 ${wrongAnswerHeight}px` } : undefined"
          >
            <AnswerPanel
              type="wrong"
              :hidden="false"
              :model-value="entry.wrongAnswer"
              :entry-id="entry.id"
              :notebook-id="entry.notebookId"
              @update:model-value="onWrongAnswer($event)"
              @reveal="emit('reveal')"
              @blur="onBlur"
              @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
            />
          </div>

          <div
            ref="answerResizeHandle"
            class="panel-resizer panel-resizer-h"
            role="separator"
            aria-label="调整错误答案和正确答案区域的高度"
            title="拖动调整上下高度 · 双击恢复默认"
            @mousedown="startPanelResize($event, 'answers')"
            @dblclick="resetPanelSize('answers')"
          >
            <span />
          </div>

          <div class="flex-1 flex min-h-0">
            <AnswerPanel
              type="correct"
              :hidden="answersHidden"
              :model-value="entry.correctAnswer"
              :entry-id="entry.id"
              :notebook-id="entry.notebookId"
              @update:model-value="onCorrectAnswer($event)"
              @reveal="emit('reveal')"
              @blur="onBlur"
              @mount-canvas="(el, entryId, field) => emit('mount-canvas', el, entryId, field)"
            />
          </div>
        </div>
      </div>
    </div>

    <CameraCapture v-if="qCamOpen" @capture="onQuestionCamCapture" @close="qCamOpen = false" />

    <ScreenshotPicker
      v-if="qScreenshotOpen"
      @capture="onQuestionScreenshotCapture"
      @close="qScreenshotOpen = false"
    />

    <ImageCropper
      v-if="pipelineStage === 'crop'"
      :image-src="pipelineSrc"
      @crop="onCropConfirm"
      @skip="onCropSkip"
      @cancel="onCropCancel"
    />

    <ImageFilterModal
      v-if="pipelineStage === 'filter'"
      :image-src="pipelineSrc"
      @confirm="onFilterConfirm"
      @skip="onFilterSkip"
      @cancel="onFilterCancel"
    />
  </div>
</template>

<style scoped>
.editor-layout {
  grid-template-columns: minmax(0, 1fr);
}

.editor-layout.has-group .material-panel {
  height: var(--material-height, 280px);
}

@media (min-width: 1024px) {
  .editor-layout.has-group {
    grid-template-columns:
      minmax(260px, var(--material-width, calc(48% - 6px))) 12px
      minmax(360px, 1fr);
  }

  .editor-layout.has-group .material-panel {
    height: auto;
  }
}

.panel-resizer {
  position: relative;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background-color 150ms ease;
  touch-action: none;
}

.panel-resizer-h {
  display: flex;
  height: 12px;
  cursor: row-resize;
}

.panel-resizer-material {
  display: flex;
  height: 12px;
  cursor: row-resize;
}

.panel-resizer span {
  display: block;
  border-radius: 999px;
  background: #cbd5e1;
  transition:
    background-color 150ms ease,
    transform 150ms ease;
}

.panel-resizer-h span {
  width: 48px;
  height: 3px;
}

.panel-resizer-material span {
  width: 48px;
  height: 3px;
}

@media (min-width: 1024px) {
  .panel-resizer-material {
    width: 12px;
    height: auto;
    cursor: col-resize;
  }

  .panel-resizer-material span {
    width: 3px;
    height: 48px;
  }
}

.panel-resizer:hover {
  background: rgb(217 119 87 / 10%);
}

.panel-resizer:hover span {
  background: #d97757;
  transform: scale(1.08);
}

:global(.panel-resizing) {
  user-select: none;
}

.dark .panel-resizer span {
  background: #4b5563;
}

.dark .panel-resizer:hover span {
  background: #d97757;
}

.editor-tool,
.question-nav {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  transition: all 150ms ease;
}
.editor-tool:hover,
.question-nav:hover:not(:disabled) {
  color: #4b5563;
  background: rgb(0 0 0 / 5%);
}
.question-nav:disabled {
  opacity: 0.3;
  cursor: default;
}

.panel-body:empty::before {
  content: attr(data-placeholder);
  color: #cbd5e1;
}
.dark .panel-body:empty::before {
  color: #4b5563;
}
</style>
