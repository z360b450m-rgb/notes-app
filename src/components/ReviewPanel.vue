<script setup lang="ts">
// @AI-NOTE: 复习面板组件 —— 复习流程由 useReview Hook 驱动。
// 禁止在此实现 SRS 算法、间隔计算、直接操作复习日志存储。
import { ref, watch, nextTick, onUnmounted, computed } from 'vue'
import type { NoteEntry } from '@/types'
import type { SessionRecord } from '@/composables/useReview'
import { getMasteryColor, getMasteryLabel } from '@/composables/useStats'
import { sanitizeHtml, formatMcOptions } from '@/utils/sanitize'

const props = defineProps<{
  entry: NoteEntry | undefined
  answered: boolean
  elapsedMs: number
  progress: string
  progressPercent: number
  dueCount: number
  reviewedToday: number
  isReviewing: boolean
  sessionDone: boolean
  sessionRecords: SessionRecord[]
  totalSessionMs: number
  reviewQueue: NoteEntry[]
}>()

const emit = defineEmits<{
  reveal: []
  rate: [rating: number | string, note: string]
  startReview: [force: boolean]
  exitReview: []
  dismissSummary: []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
}>()

const showCorrect = ref(false)
const note = ref('')
const rated = ref(false)

const sanitizedQuestion = computed(
  () =>
    sanitizeHtml(formatMcOptions(props.entry?.question || '')) ||
    "<span class='text-gray-300'>无题目内容</span>",
)
const sanitizedWrongAnswer = computed(
  () =>
    sanitizeHtml(formatMcOptions(props.entry?.wrongAnswer || '')) ||
    "<span class='text-gray-300 dark:text-[#4a4a48]'>无内容</span>",
)
const sanitizedCorrectAnswer = computed(
  () =>
    sanitizeHtml(formatMcOptions(props.entry?.correctAnswer || '')) ||
    "<span class='text-gray-300 dark:text-[#4a4a48]'>无内容</span>",
)

function sanitizedFallback(html: string | undefined, fallback: string): string {
  return sanitizeHtml(html || '') || fallback
}
const questionContentRef = ref<HTMLDivElement | null>(null)
const wrongContentRef = ref<HTMLDivElement | null>(null)
const correctContentRef = ref<HTMLDivElement | null>(null)
const questionPanelEl = ref<HTMLDivElement | null>(null)
const resizeH = ref<HTMLDivElement | null>(null)

interface ResizeState {
  startY: number
  questionH: number
  containerH: number
}
let resizeState: ResizeState | null = null

function startResize(e: MouseEvent) {
  e.preventDefault()
  if (!questionPanelEl.value) return
  const container = questionPanelEl.value.parentElement
  if (!container) return
  resizeState = {
    startY: e.clientY,
    questionH: questionPanelEl.value.offsetHeight,
    containerH: container.offsetHeight,
  }
  resizeH.value?.classList.add('dragging')
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (!resizeState || !questionPanelEl.value) return
  const r = resizeState
  const deltaY = e.clientY - r.startY
  const gap = 60
  const minQ = 80
  const minA = 200
  const maxQ = r.containerH - minA - gap
  const newQH = Math.max(minQ, Math.min(maxQ, r.questionH + deltaY))
  questionPanelEl.value.style.flex = '0 0 ' + newQH + 'px'
}

function stopResize() {
  resizeH.value?.classList.remove('dragging')
  resizeState = null
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
})

watch(
  () => props.entry,
  () => {
    showCorrect.value = false
    note.value = ''
    nextTick(() => {
      if (questionContentRef.value && props.entry?.id) {
        emit('mount-canvas', questionContentRef.value, props.entry.id, 'question')
      }
      if (wrongContentRef.value && props.entry?.id) {
        emit('mount-canvas', wrongContentRef.value, props.entry.id, 'wrongAnswer')
      }
      if (correctContentRef.value && props.entry?.id) {
        emit('mount-canvas', correctContentRef.value, props.entry.id, 'correctAnswer')
      }
    })
  },
  { immediate: true },
)

function reveal() {
  showCorrect.value = true
  rated.value = false
  emit('reveal')
}

function showWrong() {
  showCorrect.value = false
}

function rate(r: string, n: string) {
  rated.value = true
  emit('rate', r, n)
}

const customRatings = [
  {
    r: 'forgot',
    key: '1',
    label: '完全未掌握',
    desc: '重新开始',
    color: 'bg-red-500 hover:bg-red-600',
  },
  {
    r: 'unfamiliar',
    key: '2',
    label: '不熟练',
    desc: '维持当前等级',
    color: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    r: 'mastered',
    key: '3',
    label: '已掌握',
    desc: '晋级',
    color: 'bg-emerald-500 hover:bg-emerald-600',
  },
]

function currentMasteryHint(): string {
  if (!props.entry) return ''
  return `当前: ${getMasteryLabel(props.entry)}`
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatTotalTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) {
    const sec = s % 60
    return `${m} 分 ${sec} 秒`
  }
  return `${s} 秒`
}

function entryById(id: string): NoteEntry | undefined {
  return props.reviewQueue.find((e) => e.id === id)
}

function masteryBucket(entry: NoteEntry | undefined) {
  if (!entry) return null
  return { label: getMasteryLabel(entry), color: getMasteryColor(entry) }
}

const qualityLabels = ['遗忘', '错误', '勉强', '困难', '犹豫', '完美']
const qualityColors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e']

function ratingLabel(q: number | string): string {
  if (typeof q === 'string') {
    const map: Record<string, string> = {
      forgot: '完全未掌握',
      unfamiliar: '不熟练',
      mastered: '已掌握',
    }
    return map[q] || q
  }
  return qualityLabels[q] ?? String(q)
}

function ratingColor(q: number | string): string {
  if (typeof q === 'string') {
    const map: Record<string, string> = {
      forgot: '#ef4444',
      unfamiliar: '#f59e0b',
      mastered: '#22c55e',
    }
    return map[q] || '#9ca3af'
  }
  return qualityColors[q] ?? '#9ca3af'
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="flex-1 flex flex-col overflow-hidden p-4 gap-3">
    <!-- Session summary -->
    <template v-if="sessionDone">
      <div class="flex-1 flex flex-col items-center overflow-y-auto">
        <div class="flex flex-col items-center gap-2 py-6">
          <div
            class="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              stroke-width="3"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 class="text-lg font-bold text-gray-800 dark:text-brand-light">复习完成</h2>
          <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-brand-mid">
            <span>共 {{ sessionRecords.length }} 题</span>
            <span>总用时 {{ formatTotalTime(totalSessionMs) }}</span>
          </div>
        </div>

        <div class="w-full max-w-lg flex flex-col gap-2 pb-10">
          <div
            v-for="(rec, i) in sessionRecords"
            :key="rec.entryId"
            class="flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl"
          >
            <span class="text-[11px] text-gray-300 dark:text-[#4a4a48] w-5 tabular-nums">{{
              i + 1
            }}</span>
            <span
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: ratingColor(rec.quality) }"
            />
            <div class="flex-1 min-w-0">
              <div
                class="text-[13px] text-gray-800 dark:text-brand-light-gray truncate"
                v-html="sanitizedFallback(entryById(rec.entryId)?.question, '(无题目)')"
              />
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-gray-400 dark:text-brand-mid">{{
                  entryById(rec.entryId)?.subject || ''
                }}</span>
                <span
                  v-if="masteryBucket(entryById(rec.entryId))"
                  class="text-[10px] px-1.5 py-px rounded-full text-white"
                  :style="{ backgroundColor: masteryBucket(entryById(rec.entryId))!.color }"
                  >{{ masteryBucket(entryById(rec.entryId))!.label }}</span
                >
              </div>
            </div>
            <span
              class="text-[11px] text-gray-400 dark:text-brand-mid tabular-nums flex-shrink-0"
              >{{ formatTime(rec.elapsedMs) }}</span
            >
            <span
              class="text-[11px] font-medium flex-shrink-0 w-16 text-right"
              :style="{ color: ratingColor(rec.quality) }"
              >{{ ratingLabel(rec.quality) }}</span
            >
          </div>
        </div>

        <button
          class="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:brightness-110 transition-all active:scale-95 mb-10"
          @click="emit('dismissSummary')"
        >
          返回编辑
        </button>
      </div>
    </template>

    <!-- Review card -->
    <template v-else-if="entry">
      <!-- Progress bar + timer -->
      <div class="flex items-center gap-3 px-1 flex-shrink-0">
        <div class="flex-1 h-1.5 bg-gray-100 dark:bg-[#1e1e1c] rounded-full overflow-hidden">
          <div
            class="h-full bg-accent rounded-full transition-all duration-300"
            :style="{ width: progressPercent + '%' }"
          />
        </div>
        <span
          class="text-xs tabular-nums font-medium min-w-[60px] text-right"
          :class="answered ? 'text-gray-400 dark:text-brand-mid' : 'text-accent'"
        >
          {{ formatTime(elapsedMs) }}
        </span>
        <span class="text-xs text-gray-400 dark:text-brand-mid font-medium tabular-nums">{{
          progress
        }}</span>
        <span class="text-[10px] text-gray-300 dark:text-[#4a4a48] tabular-nums"
          >今日已复习 {{ reviewedToday }}</span
        >
      </div>

      <!-- Question -->
      <div
        ref="questionPanelEl"
        class="bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm flex flex-col overflow-hidden"
        style="flex: 2 1 0%; min-height: 80px"
      >
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-400 dark:text-brand-mid border-b border-gray-100 dark:border-[#2e2e2c] bg-brand-light dark:bg-[#1e1e1c] flex-shrink-0"
        >
          <span class="w-2 h-2 rounded-full bg-accent" />
          题目
          <span
            v-if="entry.subject"
            class="ml-auto text-[10px] text-gray-300 dark:text-[#4a4a48]"
            >{{ entry.subject }}</span
          >
        </div>
        <div class="flex-1 overflow-y-auto">
          <div ref="questionContentRef" :style="{ position: 'relative', minHeight: '100%' }">
            <div
              class="preserve-input-format px-3.5 py-3 text-base leading-relaxed md-content"
              v-html="sanitizedQuestion"
            />
          </div>
        </div>
      </div>

      <!-- Resize handle: question <-> answers -->
      <div
        ref="resizeH"
        class="resize-h flex-shrink-0 h-2 cursor-row-resize bg-transparent hover:bg-accent/20 transition-colors relative -my-0.5 rounded"
        @mousedown="startResize($event)"
      >
        <span
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-0.5 rounded-sm bg-gray-200 dark:bg-[#2e2e2c] resize-h-bar"
        />
      </div>

      <!-- Wrong answer: expanded by default, clickable header when collapsed -->
      <div
        class="flex flex-col overflow-hidden rounded-lg border transition-all duration-300"
        :class="
          !showCorrect
            ? 'flex-1 min-h-0 bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20'
            : 'flex-shrink-0 bg-red-50/30 dark:bg-red-500/5 border-red-100/50 dark:border-red-500/10 cursor-pointer hover:brightness-[0.97]'
        "
        @click="showCorrect ? showWrong() : undefined"
      >
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-600 dark:text-red-400 border-b border-red-100 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 flex-shrink-0"
        >
          <span class="w-2 h-2 rounded-full bg-red-400" />
          错误答案
          <span v-if="showCorrect" class="ml-auto text-[10px] text-red-500 dark:text-red-400"
            >点击查看</span
          >
        </div>
        <div v-if="!showCorrect" class="flex-1 overflow-y-auto">
          <div ref="wrongContentRef" :style="{ position: 'relative', minHeight: '100%' }">
            <div
              class="preserve-input-format px-3.5 py-3 text-base leading-relaxed md-content text-gray-800 dark:text-brand-light-gray"
              v-html="sanitizedWrongAnswer"
            />
          </div>
        </div>
        <div v-else class="flex items-center justify-center py-4">
          <span class="text-sm font-medium text-red-500 dark:text-red-400">点击显示错误答案</span>
        </div>
      </div>

      <!-- Correct answer: collapsed by default, clickable header when collapsed -->
      <div
        class="flex flex-col overflow-hidden rounded-lg border transition-all duration-300"
        :class="
          showCorrect
            ? 'flex-1 min-h-0 bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20'
            : 'flex-shrink-0 bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20 cursor-pointer hover:brightness-[0.97]'
        "
        @click="!showCorrect ? reveal() : undefined"
      >
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border-b border-emerald-100 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 flex-shrink-0"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400" />
          正确答案
          <span
            v-if="!showCorrect"
            class="ml-auto text-[10px] text-emerald-500 dark:text-emerald-400"
            >点击查看</span
          >
        </div>
        <div v-if="showCorrect" class="flex-1 overflow-y-auto">
          <div ref="correctContentRef" :style="{ position: 'relative', minHeight: '100%' }">
            <div
              class="preserve-input-format px-3.5 py-3 text-base leading-relaxed md-content text-gray-800 dark:text-brand-light-gray"
              v-html="sanitizedCorrectAnswer"
            />
          </div>
        </div>
        <div v-else class="flex items-center justify-center py-4">
          <span class="text-sm font-medium text-emerald-500 dark:text-emerald-400"
            >点击显示正确答案</span
          >
        </div>
      </div>

      <!-- Review note -->
      <div v-if="answered && !rated" class="flex-shrink-0 flex flex-col gap-1.5">
        <label class="text-[11px] font-semibold text-gray-400 dark:text-brand-mid">复习批注</label>
        <textarea
          v-model="note"
          class="w-full h-20 resize-none rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] px-3 py-2 text-sm text-gray-800 dark:text-brand-light-gray outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600"
          placeholder="记录这次复习的收获或思路…"
        />
      </div>

      <!-- Current mastery hint -->
      <div
        v-if="answered && !rated"
        class="flex-shrink-0 text-[11px] text-gray-400 dark:text-brand-mid text-center"
      >
        {{ currentMasteryHint() }}
      </div>

      <!-- Rating buttons -->
      <div v-if="answered && !rated" class="flex-shrink-0 flex gap-2">
        <button
          v-for="r in customRatings"
          :key="r.r"
          class="flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-white text-xs font-medium transition-all hover:brightness-110 active:scale-[0.97]"
          :class="r.color"
          :title="`按 ${r.key} —— ${r.desc}`"
          @click="rate(r.r, note)"
        >
          <span class="text-lg font-bold">{{ r.key }}</span>
          <span class="text-[11px]">{{ r.label }}</span>
          <span class="text-[10px] opacity-70">{{ r.desc }}</span>
        </button>
      </div>

      <!-- Exit review -->
      <button
        class="flex-shrink-0 self-center px-3 py-1.5 rounded-md border border-gray-100 dark:border-[#2e2e2c] text-xs text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1e1e1c] transition-all duration-200 ease-out active:scale-95"
        @click="emit('exitReview')"
      >
        退出复习
      </button>
    </template>
    <div
      v-else
      class="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-brand-mid"
    >
      暂无复习卡片
    </div>
  </div>
</template>

<style scoped>
.resize-h-bar {
  background: #e5e7eb;
}
.dark .resize-h-bar {
  background: #4b5563;
}
.resize-h:hover .resize-h-bar,
.resize-h.dragging .resize-h-bar {
  background: #d97757;
}
.dark .resize-h:hover .resize-h-bar,
.dark .resize-h.dragging .resize-h-bar {
  background: #e8a87c;
}
</style>
