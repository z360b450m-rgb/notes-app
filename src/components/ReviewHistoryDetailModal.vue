<script setup lang="ts">
import { computed } from 'vue'
import type { ReviewHistorySession } from '@/composables/useStats'
import { sanitizeHtml, formatMcOptions } from '@/utils/sanitize'
import { parseMultipleChoice } from '@/utils/multipleChoice'

const props = defineProps<{
  session: ReviewHistorySession
  scope: 'due' | 'all'
}>()

const emit = defineEmits<{
  close: []
}>()

const objectiveEntries = computed(() =>
  props.session.entries.filter((entry) => entry.isCorrect !== undefined),
)
const correctCount = computed(
  () => objectiveEntries.value.filter((entry) => entry.isCorrect === true).length,
)
const selfCounts = computed(() => ({
  forgot: props.session.entries.filter((entry) => entry.quality === 'forgot').length,
  unfamiliar: props.session.entries.filter((entry) => entry.quality === 'unfamiliar').length,
  mastered: props.session.entries.filter((entry) => entry.quality === 'mastered').length,
}))

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function masteryLabel(quality: number | string): string {
  const labels: Record<string, string> = {
    forgot: '完全未掌握',
    unfamiliar: '不熟练',
    mastered: '已掌握',
  }
  return labels[String(quality)] || '已复习'
}

function masteryClass(quality: number | string): string {
  if (quality === 'forgot') return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  if (quality === 'unfamiliar')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
}

function multipleChoice(entry: ReviewHistorySession['entries'][number]) {
  return parseMultipleChoice(entry.question, entry.correctAnswer)
}

function optionClass(entry: ReviewHistorySession['entries'][number], key: string): string {
  const correct = entry.correctChoice ?? multipleChoice(entry)?.correctOption
  if (key === correct) {
    return 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-200'
  }
  if (key === entry.selectedChoice) {
    return 'border-red-400 bg-red-50 text-red-800 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-200'
  }
  return 'border-gray-100 bg-white dark:border-[#343431] dark:bg-[#1e1e1c]'
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div
      class="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-gray-50 shadow-2xl dark:bg-[#10100f]"
    >
      <div
        class="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-[#2e2e2c] dark:bg-[#141413]"
      >
        <div>
          <p
            class="text-[11px] font-medium"
            :class="scope === 'due' ? 'text-accent' : 'text-violet-600 dark:text-violet-300'"
          >
            {{ scope === 'due' ? '到期复习' : '自由复习' }} · 已完成
          </p>
          <h2 class="mt-0.5 text-base font-bold text-gray-800 dark:text-brand-light">
            本次复习详情
          </h2>
          <p class="mt-0.5 text-[11px] text-gray-400 dark:text-brand-mid">
            {{ formatDate(session.completedAt) }} · {{ session.reviewedCount }} 题 · 总用时
            {{ formatTime(session.totalElapsedMs) }}
          </p>
        </div>
        <button
          class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-brand-mid dark:hover:bg-[#2a2a28]"
          @click="emit('close')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div
        class="grid grid-cols-2 gap-2 border-b border-gray-200 bg-white px-5 py-3 text-center dark:border-[#2e2e2c] dark:bg-[#141413] md:grid-cols-4"
      >
        <div>
          <div class="text-lg font-bold text-gray-800 dark:text-brand-light">
            {{ session.reviewedCount }} / {{ session.totalCount }}
          </div>
          <div class="text-[10px] text-gray-400 dark:text-brand-mid">完成题数</div>
        </div>
        <div>
          <div class="text-lg font-bold text-blue-600 dark:text-blue-300">
            {{ objectiveEntries.length ? `${correctCount} / ${objectiveEntries.length}` : '—' }}
          </div>
          <div class="text-[10px] text-gray-400 dark:text-brand-mid">选择题答对</div>
        </div>
        <div>
          <div class="text-lg font-bold text-red-500">{{ selfCounts.forgot }}</div>
          <div class="text-[10px] text-gray-400 dark:text-brand-mid">完全未掌握</div>
        </div>
        <div>
          <div class="text-lg font-bold text-emerald-600 dark:text-emerald-300">
            {{ selfCounts.mastered }}
          </div>
          <div class="text-[10px] text-gray-400 dark:text-brand-mid">已掌握</div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4 md:p-5">
        <article
          v-for="(entry, index) in session.entries"
          :key="`${session.id}_${entry.entryId}`"
          class="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2e2e2c] dark:bg-[#141413]"
        >
          <div
            class="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5 dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
          >
            <span class="text-sm font-bold text-gray-700 dark:text-brand-light"
              >{{ index + 1 }}.</span
            >
            <span class="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{{
              entry.selectedChoice ? '单选题' : '复习题'
            }}</span>
            <span class="text-[11px] text-gray-400 dark:text-brand-mid">{{ entry.subject }}</span>
            <span
              v-for="tag in entry.tags"
              :key="tag"
              class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-[#2a2a28] dark:text-brand-mid"
              ># {{ tag }}</span
            >
            <span
              class="ml-auto rounded-full px-2 py-1 text-[11px] font-semibold"
              :class="masteryClass(entry.quality)"
              >本次：{{ masteryLabel(entry.quality) }}</span
            >
          </div>

          <div class="p-4">
            <div
              class="preserve-input-format text-sm leading-relaxed text-gray-800 dark:text-brand-light-gray"
              v-html="sanitizeHtml(formatMcOptions(multipleChoice(entry)?.stem || entry.question))"
            />

            <div v-if="multipleChoice(entry)" class="mt-3 grid gap-2">
              <div
                v-for="option in multipleChoice(entry)!.options"
                :key="option.key"
                class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm"
                :class="optionClass(entry, option.key)"
              >
                <span
                  class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
                  >{{ option.key }}</span
                >
                <span
                  class="preserve-input-format leading-relaxed"
                  v-html="sanitizeHtml(formatMcOptions(option.content))"
                />
              </div>
            </div>

            <div
              class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-center dark:bg-[#1e1e1c] md:grid-cols-4"
            >
              <div>
                <div
                  class="text-sm font-bold"
                  :class="
                    entry.isCorrect === false
                      ? 'text-red-500'
                      : entry.isCorrect === true
                        ? 'text-emerald-600'
                        : 'text-gray-700 dark:text-brand-light'
                  "
                >
                  {{ entry.selectedChoice || '—' }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-brand-mid">我的选择</div>
              </div>
              <div>
                <div class="text-sm font-bold text-emerald-600 dark:text-emerald-300">
                  {{ entry.correctChoice || multipleChoice(entry)?.correctOption || '—' }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-brand-mid">正确答案</div>
              </div>
              <div>
                <div
                  class="text-sm font-bold"
                  :class="
                    entry.isCorrect === false
                      ? 'text-red-500'
                      : entry.isCorrect === true
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                  "
                >
                  {{
                    entry.isCorrect === false
                      ? '答错'
                      : entry.isCorrect === true
                        ? '答对'
                        : masteryLabel(entry.quality)
                  }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-brand-mid">本次结果</div>
              </div>
              <div>
                <div class="text-sm font-bold text-blue-600 dark:text-blue-300">
                  {{ formatTime(entry.elapsedMs) }}
                </div>
                <div class="text-[10px] text-gray-400 dark:text-brand-mid">答题用时</div>
              </div>
            </div>

            <div v-if="!multipleChoice(entry)" class="mt-3 grid gap-3 md:grid-cols-2">
              <div
                class="rounded-lg border border-red-100 bg-red-50/60 p-3 dark:border-red-500/20 dark:bg-red-500/10"
              >
                <div class="mb-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                  错误答案 / 原记录
                </div>
                <div
                  class="preserve-input-format text-sm"
                  v-html="sanitizeHtml(formatMcOptions(entry.wrongAnswer || '无内容'))"
                />
              </div>
              <div
                class="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10"
              >
                <div class="mb-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  正确答案 / 解析
                </div>
                <div
                  class="preserve-input-format text-sm"
                  v-html="sanitizeHtml(formatMcOptions(entry.correctAnswer || '无内容'))"
                />
              </div>
            </div>
            <div
              v-if="entry.reviewNote"
              class="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-sm text-gray-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-brand-light-gray"
            >
              <span class="mr-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                >本次批注</span
              >{{ entry.reviewNote }}
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
