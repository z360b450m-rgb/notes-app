<script setup lang="ts">
// @AI-NOTE: 复习面板组件 —— 复习流程由 useReview Hook 驱动。
// 禁止在此实现 SRS 算法、间隔计算、直接操作复习日志存储。
import { ref, watch, nextTick, computed, useId } from 'vue'
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui'
import type { NoteEntry, QuestionGroup } from '@/types'
import type { ReviewOutcome, SessionRecord } from '@/composables/useReview'
import { sanitizeHtml, formatMcOptions } from '@/utils/sanitize'
import { parseMultipleChoice } from '@/utils/multipleChoice'
import { stripInternalLinks } from '@/utils/internalLinks'
import { localMode } from '@/services/localMode'
import {
  canAdvanceReviewAttempt,
  isReviewAttemptComplete,
  type ReviewAttempt,
} from '@/services/reviewGrading'
import ReviewFollowupDialog from './ReviewFollowupDialog.vue'

const props = defineProps<{
  entry: NoteEntry | undefined
  group?: QuestionGroup
  answered: boolean
  submitting?: boolean
  gradingAttempt?: ReviewAttempt | null
  gradingError?: string
  gradingLocked?: boolean
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
  entries: NoteEntry[]
}>()

const emit = defineEmits<{
  reveal: []
  rate: [rating: number | string, note: string, outcome?: ReviewOutcome]
  startReview: [force: boolean]
  exitReview: []
  dismissSummary: []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
  'outcome-change': [outcome: ReviewOutcome]
  explain: [text: string]
  'next-review': []
  'retry-grading': []
}>()

const answerText = ref('')
const explanationText = ref('')
const followupOpen = ref(false)
const answerInputId = useId()
const selectedChoice = ref<string | null>(null)
const localRatings = [
  { value: 'forgot', label: '完全未掌握' },
  { value: 'unfamiliar', label: '不熟练' },
  { value: 'mastered', label: '已掌握' },
]
const answerLocked = computed(() => props.gradingLocked || (localMode && props.answered))
const summaryEntryId = ref<string | null>(null)
const canAdvance = computed(
  () =>
    isReviewAttemptComplete(props.gradingAttempt) &&
    props.gradingAttempt?.entry_id === props.entry?.id,
)
const unjudged = computed(() => canAdvance.value && !canAdvanceReviewAttempt(props.gradingAttempt))
const canDiscuss = computed(() => canAdvance.value)
const isLastCard = computed(
  () => !!props.entry && props.entry.id === props.reviewQueue[props.reviewQueue.length - 1]?.id,
)
const multipleChoice = computed(() =>
  parseMultipleChoice(
    stripInternalLinks(props.entry?.question || ''),
    stripInternalLinks(props.entry?.correctAnswer || ''),
  ),
)
const reviewOutcome = computed<ReviewOutcome>(() => {
  const correctChoice = multipleChoice.value?.correctOption
  return selectedChoice.value && correctChoice
    ? {
        selectedChoice: selectedChoice.value,
        correctChoice,
        isCorrect: selectedChoice.value === correctChoice,
        answerText: answerText.value,
      }
    : { selectedChoice: selectedChoice.value ?? undefined, answerText: answerText.value }
})
watch(reviewOutcome, (outcome) => emit('outcome-change', outcome), { flush: 'sync' })
const sanitizedChoiceStem = computed(() =>
  sanitizeHtml(formatMcOptions(multipleChoice.value?.stem || '')),
)

const sanitizedQuestion = computed(
  () =>
    sanitizeHtml(formatMcOptions(stripInternalLinks(props.entry?.question || ''))) ||
    "<span class='text-gray-300'>无题目内容</span>",
)
const sanitizedMaterial = computed(
  () =>
    sanitizeHtml(stripInternalLinks(props.group?.material || '')) ||
    "<span class='text-gray-300 dark:text-[#4a4a48]'>无公共材料</span>",
)

function sanitizedFallback(html: string | undefined, fallback: string): string {
  return sanitizeHtml(stripInternalLinks(html || '')) || fallback
}
const questionContentRef = ref<HTMLDivElement | null>(null)
const materialContentRef = ref<HTMLDivElement | null>(null)
watch(
  () => props.entry,
  () => {
    answerText.value = ''
    explanationText.value = ''
    followupOpen.value = false
    selectedChoice.value = null
    nextTick(() => {
      if (questionContentRef.value && props.entry?.id) {
        emit('mount-canvas', questionContentRef.value, props.entry.id, 'question')
      }
      if (materialContentRef.value && props.entry?.id && props.group) {
        emit('mount-canvas', materialContentRef.value, props.entry.id, 'material')
      }
    })
  },
  { immediate: true },
)

watch(
  () => props.sessionDone,
  (done) => {
    if (done) {
      summaryEntryId.value = null
    }
  },
)

function selectChoice(key: string) {
  if (props.submitting || answerLocked.value) return
  selectedChoice.value = key
}

function choiceClass(key: string): string {
  const selected = selectedChoice.value
  return key === selected
    ? 'border-accent bg-accent/5 text-accent dark:border-accent/70 dark:bg-accent/10'
    : 'border-gray-200 dark:border-[#3a3a37] bg-white dark:bg-[#1e1e1c] hover:border-accent/50 hover:bg-accent/5'
}

function submitAnswer() {
  if (props.gradingLocked) {
    emit('retry-grading')
    return
  }
  if (props.submitting || (!answerText.value.trim() && !selectedChoice.value)) return
  emit('rate', 'submitted', '', reviewOutcome.value)
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
  return props.entries.find((e) => e.id === id) ?? props.reviewQueue.find((e) => e.id === id)
}

const summaryEntry = computed(() =>
  summaryEntryId.value ? entryById(summaryEntryId.value) : undefined,
)

function openSummaryEntry(entryId: string) {
  summaryEntryId.value = entryId
}

function closeSummaryEntry() {
  summaryEntryId.value = null
}

function summaryEntryHtml(
  entry: NoteEntry | undefined,
  field: 'question' | 'wrongAnswer' | 'correctAnswer',
) {
  if (!entry) return "<span class='text-gray-300'>题目已删除</span>"
  return sanitizedFallback(entry[field], '(无内容)')
}

const qualityLabels = ['遗忘', '错误', '勉强', '困难', '犹豫', '完美']
const qualityColors = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e']

function ratingLabel(q: number | string): string {
  if (typeof q === 'string') {
    const map: Record<string, string> = {
      forgot: '完全未掌握',
      unfamiliar: '不熟练',
      mastered: '已掌握',
      submitted: '已作答',
      agent_correct: '答对',
      agent_incorrect: '答错',
      agent_unjudged: '待核对',
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
      agent_correct: '#22c55e',
      agent_incorrect: '#ef4444',
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

        <div class="w-full max-w-lg pb-10">
          <div v-if="summaryEntry" class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <button
                data-ui-variant="text"
                type="button"
                data-dialog-cancel
                class="ui-control text-xs text-accent hover:underline"
                @click="closeSummaryEntry"
              >
                ← 返回列表
              </button>
              <span class="text-[11px] text-gray-400 dark:text-brand-mid">{{
                summaryEntry.subject
              }}</span>
            </div>
            <div
              class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-[#2e2e2c] dark:bg-[#141413]"
            >
              <div class="mb-2 text-xs font-semibold text-accent">题目</div>
              <div
                class="preserve-input-format text-sm leading-relaxed text-gray-800 dark:text-brand-light-gray"
                v-html="summaryEntryHtml(summaryEntry, 'question')"
              />
            </div>
            <div
              v-if="
                sessionRecords.find((record) => record.entryId === summaryEntry?.id)?.answerText
              "
              class="rounded-xl border border-[var(--neo-line)] p-4"
            >
              <div class="mb-2 text-xs font-semibold text-accent">本次作答</div>
              <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {{
                  sessionRecords.find((record) => record.entryId === summaryEntry?.id)?.answerText
                }}
              </p>
            </div>
            <div
              class="rounded-xl border border-red-100 bg-red-50/60 p-4 dark:border-red-500/20 dark:bg-red-500/10"
            >
              <div class="mb-2 text-xs font-semibold text-red-600 dark:text-red-400">
                错误答案 / 你的记录
              </div>
              <div
                class="preserve-input-format text-sm leading-relaxed text-gray-800 dark:text-brand-light-gray"
                v-html="summaryEntryHtml(summaryEntry, 'wrongAnswer')"
              />
            </div>
            <div
              v-if="
                sessionRecords.find((record) => record.entryId === summaryEntry?.id)?.gradeComment
              "
              class="rounded-xl border border-gray-100 bg-white p-4 dark:border-[#2e2e2c] dark:bg-[#141413]"
            >
              <div class="mb-2 text-xs font-semibold text-accent">解题理由与智能点评</div>
              <p class="whitespace-pre-wrap break-words text-sm">
                {{
                  sessionRecords.find((record) => record.entryId === summaryEntry?.id)
                    ?.explanationText
                }}
              </p>
              <p class="mt-2 whitespace-pre-wrap break-words text-sm">
                {{
                  sessionRecords.find((record) => record.entryId === summaryEntry?.id)?.gradeComment
                }}
              </p>
            </div>
            <div
              class="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10"
            >
              <div class="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                正确答案 / 解析
              </div>
              <div
                class="preserve-input-format text-sm leading-relaxed text-gray-800 dark:text-brand-light-gray"
                v-html="summaryEntryHtml(summaryEntry, 'correctAnswer')"
              />
            </div>
          </div>

          <div v-else class="flex flex-col gap-2">
            <button
              type="button"
              v-for="(rec, i) in sessionRecords"
              :key="rec.entryId"
              class="ui-choice flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 dark:border-[#2e2e2c] dark:bg-[#141413] dark:hover:bg-accent/10"
              @click="openSummaryEntry(rec.entryId)"
            >
              <span class="w-5 text-[11px] tabular-nums text-gray-300 dark:text-[#4a4a48]">{{
                i + 1
              }}</span>
              <span
                class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: ratingColor(rec.quality) }"
              />
              <div class="flex-1 min-w-0">
                <div
                  class="truncate text-[13px] text-gray-800 dark:text-brand-light-gray"
                  v-html="sanitizedFallback(entryById(rec.entryId)?.question, '(无题目)')"
                />
                <div class="mt-0.5 flex items-center gap-2">
                  <span class="text-[10px] text-gray-400 dark:text-brand-mid">{{
                    entryById(rec.entryId)?.subject || ''
                  }}</span>
                  <span v-if="rec.isCorrect === false" class="text-[10px] text-red-500">{{
                    rec.selectedChoice && rec.correctChoice
                      ? `选 ${rec.selectedChoice}，正确 ${rec.correctChoice}`
                      : '本次答错'
                  }}</span>
                </div>
              </div>
              <span class="text-[11px] tabular-nums text-gray-400 dark:text-brand-mid">{{
                formatTime(rec.elapsedMs)
              }}</span>
              <span
                class="w-16 flex-shrink-0 text-right text-[11px] font-medium"
                :style="{ color: ratingColor(rec.quality) }"
                >{{ ratingLabel(rec.quality) }}</span
              >
            </button>
          </div>
        </div>

        <button
          data-ui-variant="default"
          type="button"
          data-dialog-cancel
          class="ui-control px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:brightness-110 transition-all active:scale-95 mb-10"
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

      <div
        class="flex-1 min-h-0 grid gap-3 overflow-y-auto lg:overflow-hidden"
        :class="
          group
            ? 'grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_minmax(360px,1.08fr)]'
            : 'grid-cols-1'
        "
      >
        <section
          v-if="group"
          class="min-h-[180px] bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm flex flex-col overflow-hidden"
        >
          <div
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-gray-500 dark:text-brand-mid border-b border-gray-100 dark:border-[#2e2e2c] bg-brand-light dark:bg-[#1e1e1c]"
          >
            <span class="w-2 h-2 rounded-full bg-sky-400" />
            公共材料
          </div>
          <div class="flex-1 overflow-y-auto">
            <div ref="materialContentRef" class="relative min-h-full">
              <div
                class="preserve-input-format px-4 py-3 text-base leading-relaxed md-content"
                v-html="sanitizedMaterial"
              />
            </div>
          </div>
        </section>

        <div class="min-h-[500px] lg:min-h-0 flex flex-col gap-3 overflow-hidden">
          <!-- Question -->
          <div
            class="bg-white dark:bg-[#141413] border border-gray-100 dark:border-[#2e2e2c] rounded-xl shadow-sm flex flex-col overflow-hidden"
            style="flex: 1.15 1 0%; min-height: 100px"
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
                <div v-if="multipleChoice" class="px-3.5 py-3">
                  <div
                    class="preserve-input-format text-base leading-relaxed md-content"
                    v-html="sanitizedChoiceStem"
                  />
                  <RadioGroupRoot
                    class="mt-4 grid gap-2"
                    orientation="vertical"
                    aria-label="选择答案"
                    :model-value="selectedChoice ?? undefined"
                    :disabled="submitting || answerLocked"
                    @update:model-value="selectChoice"
                  >
                    <RadioGroupItem
                      as="button"
                      :value="option.key"
                      v-for="option in multipleChoice.options"
                      :key="option.key"
                      type="button"
                      class="ui-choice w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-all duration-200 disabled:cursor-default"
                      :class="choiceClass(option.key)"
                      :disabled="submitting || answerLocked"
                    >
                      <span
                        class="w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold flex-shrink-0"
                        >{{ option.key }}</span
                      >
                      <span
                        class="preserve-input-format md-content leading-relaxed"
                        v-html="sanitizeHtml(formatMcOptions(option.content))"
                      />
                    </RadioGroupItem>
                  </RadioGroupRoot>
                </div>
                <div
                  v-else
                  class="preserve-input-format px-3.5 py-3 text-base leading-relaxed md-content"
                  v-html="sanitizedQuestion"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Independent answer, available before revealing the reference answer. -->
      <div class="flex-shrink-0 flex flex-col gap-1.5">
        <label
          :for="answerInputId"
          class="text-[11px] font-semibold text-gray-400 dark:text-brand-mid"
          >我的作答</label
        >
        <textarea
          :id="answerInputId"
          v-model="answerText"
          data-testid="review-answer-input"
          maxlength="20000"
          :disabled="submitting || answerLocked"
          class="ui-field w-full h-20 resize-none rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] px-3 py-2 text-sm text-gray-800 dark:text-brand-light-gray outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all placeholder:text-gray-300 dark:placeholder:text-gray-600"
          placeholder="请输入本次作答，可分行写出解题步骤…"
        />
        <p v-if="!localMode" class="text-[11px] text-gray-400 dark:text-brand-mid">
          只选答案时先解释一次；也可将答案和解析一起提交。判完可继续追问或进入下一题。
        </p>
      </div>

      <section
        v-if="gradingAttempt || gradingError"
        data-testid="review-grading-feedback"
        class="flex-shrink-0 max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#1e1e1c] p-3 text-sm"
      >
        <p class="text-xs font-semibold text-accent">智能判卷 · AI 建议</p>
        <p
          v-if="gradingAttempt"
          data-testid="review-grade-comment"
          class="mt-2 whitespace-pre-wrap text-gray-800 dark:text-brand-light-gray"
        >
          {{ gradingAttempt.comment }}
        </p>
        <p
          v-if="!canAdvance && gradingAttempt?.followup_question"
          class="mt-2 text-gray-500 dark:text-brand-mid"
        >
          {{ gradingAttempt.followup_question }}
        </p>
        <p v-if="gradingError" role="alert" class="mt-2 text-rose-600 dark:text-rose-400">
          {{ gradingError }}
        </p>
        <p v-if="unjudged" role="status" class="mt-3 text-xs text-amber-700 dark:text-amber-300">
          本题已完成一次核对，结果暂不确定，不计入答对或答错。可继续追问或进入下一题。
        </p>
        <template v-if="gradingAttempt?.status === 'awaiting_explanation' && !canAdvance">
          <label for="review-explanation" class="mt-3 block text-xs text-gray-500">解题理由</label>
          <textarea
            id="review-explanation"
            v-model="explanationText"
            data-testid="review-explanation-input"
            maxlength="20000"
            :disabled="submitting"
            class="ui-field mt-1 h-20 w-full resize-none rounded-lg border border-gray-200 bg-transparent p-2 dark:border-[#2e2e2c]"
            placeholder="说明你为什么选择这个答案，提交后只判断一次…"
          />
          <div class="mt-2 flex justify-end">
            <button
              data-ui-variant="primary"
              data-testid="submit-review-explanation"
              type="button"
              :disabled="submitting || !explanationText.trim()"
              class="ui-control rounded-lg bg-accent px-3 py-2 text-xs text-white disabled:opacity-50"
              @click="emit('explain', explanationText)"
            >
              {{ submitting ? '正在核对…' : '提交解题理由' }}
            </button>
          </div>
        </template>
        <div v-if="canAdvance" class="mt-3 border-t border-gray-200 pt-3 dark:border-[#2e2e2c]">
          <p class="mb-2 text-xs font-semibold text-accent">参考答案与解析</p>
          <div
            class="md-content break-words"
            v-html="sanitizedFallback(entry.correctAnswer, '暂无参考答案')"
          />
        </div>
      </section>

      <template v-if="localMode">
        <button
          v-if="!answered"
          type="button"
          data-ui-variant="primary"
          class="ui-control flex-shrink-0 self-end rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white"
          @click="emit('reveal')"
        >
          查看参考答案
        </button>
        <section
          v-else
          class="min-h-0 shrink overflow-y-auto rounded-xl border border-gray-200 p-3 dark:border-[#2e2e2c]"
        >
          <p class="mb-2 text-xs font-semibold text-accent">参考答案与解析</p>
          <div class="md-content break-words" v-html="sanitizedFallback(entry.correctAnswer, '暂无参考答案')" />
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="rating in localRatings"
              :key="rating.value"
              type="button"
              data-ui-variant="default"
              class="ui-control rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-[#2e2e2c]"
              @click="emit('rate', rating.value, '', reviewOutcome)"
            >
              {{ rating.label }}
            </button>
          </div>
        </section>
      </template>

      <button
        data-ui-variant="primary"
        v-if="!localMode && !gradingAttempt"
        type="button"
        data-testid="submit-review-answer"
        class="ui-control flex-shrink-0 self-end rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="submitting || (!gradingLocked && !answerText.trim() && !selectedChoice)"
        @click="submitAnswer"
      >
        {{ submitting ? '正在判卷…' : gradingLocked ? '重试提交' : '提交作答' }}
      </button>

      <div v-if="canDiscuss" class="flex flex-shrink-0 flex-wrap justify-end gap-2">
        <button
          data-ui-variant="default"
          type="button"
          data-testid="continue-review-discussion"
          :disabled="submitting"
          @click="followupOpen = true"
          class="ui-control rounded-lg border border-gray-200 px-5 py-2.5 text-sm dark:border-[#2e2e2c] disabled:opacity-50"
        >
          继续追问
        </button>
        <button
          v-if="canAdvance"
          data-ui-variant="primary"
          type="button"
          data-testid="next-graded-review"
          :disabled="submitting"
          @click="emit('next-review')"
          class="ui-control rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {{ isLastCard ? '结束复习' : '下一题' }}
        </button>
      </div>
      <ReviewFollowupDialog
        v-if="followupOpen && canDiscuss && gradingAttempt"
        :key="gradingAttempt.attempt_id"
        :entry="entry"
        :attempt="gradingAttempt"
        @close="followupOpen = false"
      />

      <!-- Exit review -->
      <button
        data-ui-variant="default"
        type="button"
        class="ui-control flex-shrink-0 self-center px-3 py-1.5 rounded-md border border-gray-100 dark:border-[#2e2e2c] text-xs text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1e1e1c] transition-all duration-200 ease-out active:scale-95"
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
