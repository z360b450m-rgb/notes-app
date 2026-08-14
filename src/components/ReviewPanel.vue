<script setup lang="ts">
// @AI-NOTE: 复习面板组件 —— 复习流程由 useReview Hook 驱动。
// 禁止在此实现 SRS 算法、间隔计算、直接操作复习日志存储。
import { ref, watch, nextTick, computed } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import type { ReviewOutcome, SessionRecord } from '@/composables/useReview'
import { getMasteryLabel } from '@/composables/useStats'
import { sanitizeHtml, formatMcOptions } from '@/utils/sanitize'
import { parseMultipleChoice } from '@/utils/multipleChoice'

const props = defineProps<{
  entry: NoteEntry | undefined
  group?: QuestionGroup
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
  entries: NoteEntry[]
}>()

const emit = defineEmits<{
  reveal: []
  rate: [rating: number | string, note: string, outcome?: ReviewOutcome]
  startReview: [force: boolean]
  exitReview: []
  dismissSummary: []
  'mount-canvas': [el: HTMLElement, entryId: string, field: string]
}>()

const showCorrect = ref(false)
const note = ref('')
const rated = ref(false)
const selectedChoice = ref<string | null>(null)
const summaryEntryId = ref<string | null>(null)
const multipleChoice = computed(() =>
  parseMultipleChoice(props.entry?.question || '', props.entry?.correctAnswer || ''),
)
const sanitizedChoiceStem = computed(() =>
  sanitizeHtml(formatMcOptions(multipleChoice.value?.stem || '')),
)

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
const sanitizedMaterial = computed(
  () =>
    sanitizeHtml(props.group?.material || '') ||
    "<span class='text-gray-300 dark:text-[#4a4a48]'>无公共材料</span>",
)

function sanitizedFallback(html: string | undefined, fallback: string): string {
  return sanitizeHtml(html || '') || fallback
}
const questionContentRef = ref<HTMLDivElement | null>(null)
const materialContentRef = ref<HTMLDivElement | null>(null)
const wrongContentRef = ref<HTMLDivElement | null>(null)
const correctContentRef = ref<HTMLDivElement | null>(null)
watch(
  () => props.entry,
  () => {
    showCorrect.value = false
    note.value = ''
    selectedChoice.value = null
    nextTick(() => {
      if (questionContentRef.value && props.entry?.id) {
        emit('mount-canvas', questionContentRef.value, props.entry.id, 'question')
      }
      if (materialContentRef.value && props.entry?.id && props.group) {
        emit('mount-canvas', materialContentRef.value, props.entry.id, 'material')
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

watch(
  () => props.sessionDone,
  (done) => {
    if (done) {
      summaryEntryId.value = null
    }
  },
)

function selectChoice(key: string) {
  if (selectedChoice.value) return
  selectedChoice.value = key
  reveal()
}

function choiceClass(key: string): string {
  const selected = selectedChoice.value
  const correct = multipleChoice.value?.correctOption
  if (!selected) {
    return 'border-gray-200 dark:border-[#3a3a37] bg-white dark:bg-[#1e1e1c] hover:border-accent/50 hover:bg-accent/5'
  }
  if (!correct) {
    return key === selected
      ? 'border-accent bg-accent/5 text-accent dark:border-accent/70 dark:bg-accent/10'
      : 'border-gray-100 dark:border-[#2e2e2c] bg-gray-50/70 dark:bg-[#1a1a18] opacity-60'
  }
  if (key === correct) {
    return 'border-emerald-400 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
  }
  if (key === selected) {
    return 'border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-500/15 text-red-800 dark:text-red-200'
  }
  return 'border-gray-100 dark:border-[#2e2e2c] bg-gray-50/70 dark:bg-[#1a1a18] opacity-60'
}

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
  const correctChoice = multipleChoice.value?.correctOption
  const outcome: ReviewOutcome | undefined =
    selectedChoice.value && correctChoice
      ? {
          selectedChoice: selectedChoice.value,
          correctChoice,
          isCorrect: selectedChoice.value === correctChoice,
        }
      : undefined
  emit('rate', r, n, outcome)
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

        <div class="w-full max-w-lg pb-10">
          <div v-if="summaryEntry" class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <button class="text-xs text-accent hover:underline" @click="closeSummaryEntry">
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
              v-for="(rec, i) in sessionRecords"
              :key="rec.entryId"
              class="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 dark:border-[#2e2e2c] dark:bg-[#141413] dark:hover:bg-accent/10"
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
                  <span v-if="rec.isCorrect === false" class="text-[10px] text-red-500"
                    >选 {{ rec.selectedChoice }}，正确 {{ rec.correctChoice }}</span
                  >
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
                  <div class="mt-4 grid gap-2">
                    <button
                      v-for="option in multipleChoice.options"
                      :key="option.key"
                      type="button"
                      class="w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-all duration-200 disabled:cursor-default"
                      :class="choiceClass(option.key)"
                      :disabled="!!selectedChoice"
                      @click="selectChoice(option.key)"
                    >
                      <span
                        class="w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold flex-shrink-0"
                        >{{ option.key }}</span
                      >
                      <span
                        class="preserve-input-format md-content leading-relaxed"
                        v-html="sanitizeHtml(formatMcOptions(option.content))"
                      />
                    </button>
                  </div>
                  <p
                    v-if="selectedChoice"
                    class="mt-3 text-xs font-medium"
                    :class="
                      selectedChoice === multipleChoice.correctOption
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : 'text-red-600 dark:text-red-300'
                    "
                  >
                    {{
                      !multipleChoice.correctOption
                        ? `已选择 ${selectedChoice}，此题尚未设置正确答案，无法自动判定对错。`
                        : selectedChoice === multipleChoice.correctOption
                          ? '回答正确，请在下方记录掌握程度。'
                          : `回答错误，正确选项是 ${multipleChoice.correctOption}。请查看解析后记录掌握程度。`
                    }}
                  </p>
                </div>
                <div
                  v-else
                  class="preserve-input-format px-3.5 py-3 text-base leading-relaxed md-content"
                  v-html="sanitizedQuestion"
                />
              </div>
            </div>
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
              <span class="text-sm font-medium text-red-500 dark:text-red-400"
                >点击显示错误答案</span
              >
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
