<script setup lang="ts">
// @AI-NOTE: 统计面板组件 —— 统计数据由 useStats Hook 计算。
// 禁止在此直接计算统计指标或操作存储。
import { computed, ref } from 'vue'
import type { ReviewHistorySession, StatsState } from '@/composables/useStats'
import ReviewHistoryDetailModal from './ReviewHistoryDetailModal.vue'

const props = defineProps<{
  stats: StatsState
}>()

const emit = defineEmits<{
  close: []
}>()

const hueStep = computed(() => {
  const n = props.stats.subjectBars.value.length || 1
  return 360 / n
})

const historyScope = ref<'due' | 'all'>('due')
const selectedSession = ref<ReviewHistorySession | null>(null)
const selectedSessionScope = ref<'due' | 'all'>('due')
const activeHistory = computed(() =>
  historyScope.value === 'due'
    ? props.stats.dueReviewHistory.value
    : props.stats.freeReviewHistory.value,
)

function openSession(session: ReviewHistorySession) {
  selectedSession.value = session
  selectedSessionScope.value = historyScope.value
}

function formatSessionTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div>
    <!-- Backdrop -->
    <div class="fixed inset-0 z-40 bg-black/15" @click="emit('close')" />

    <!-- Panel -->
    <div
      class="fixed right-0 top-0 bottom-0 z-50 w-[340px] bg-white dark:bg-[#141413] shadow-xl border-l border-gray-100 dark:border-[#2e2e2c] overflow-y-auto"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#2e2e2c]"
      >
        <h2
          class="text-[15px] font-bold text-gray-800 dark:text-brand-light flex items-center gap-2"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          统计面板
        </h2>
        <button
          class="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c] text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray transition-all duration-200 ease-out active:scale-95"
          @click="emit('close')"
        >
          <svg
            width="16"
            height="16"
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

      <div class="p-5 space-y-6">
        <!-- Overview cards -->
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-blue-50 dark:bg-blue-950 rounded-xl shadow-sm p-3.5">
            <div class="text-[11px] text-blue-500 font-medium mb-0.5">总错题数</div>
            <div class="text-2xl font-bold text-blue-700 dark:text-blue-300 tabular-nums">
              {{ stats.totalCount.value }}
            </div>
          </div>
          <div class="bg-amber-50 dark:bg-amber-950 rounded-xl shadow-sm p-3.5">
            <div class="text-[11px] text-amber-500 font-medium mb-0.5">待复习</div>
            <div class="text-2xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">
              {{ stats.dueCount.value }}
            </div>
          </div>
          <div class="bg-green-50 dark:bg-green-950 rounded-xl shadow-sm p-3.5">
            <div class="text-[11px] text-green-500 font-medium mb-0.5">今日已复习</div>
            <div class="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
              {{ stats.reviewedToday.value }}
            </div>
          </div>
          <div class="bg-purple-50 dark:bg-purple-950 rounded-xl shadow-sm p-3.5">
            <div class="text-[11px] text-purple-500 font-medium mb-0.5">累计复习</div>
            <div class="text-2xl font-bold text-purple-700 dark:text-purple-300 tabular-nums">
              {{ stats.totalReviews.value }}
            </div>
          </div>
        </div>

        <!-- Subject distribution -->
        <div>
          <h3
            class="text-[12px] font-semibold text-gray-500 dark:text-brand-mid mb-3 uppercase tracking-[0.5px]"
          >
            学科分布
          </h3>
          <div
            v-if="stats.subjectBars.value.length === 0"
            class="text-[12px] text-gray-400 dark:text-brand-mid text-center py-4"
          >
            暂无数据
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(item, i) in stats.subjectBars.value"
              :key="item.name"
              class="flex items-center gap-2"
            >
              <span
                class="text-[12px] text-gray-600 dark:text-brand-light-gray w-[60px] text-right truncate flex-shrink-0"
                :title="item.name"
              >
                {{ item.name }}
              </span>
              <div class="flex-1 h-5 bg-gray-100 dark:bg-[#1e1e1c] rounded-md overflow-hidden">
                <div
                  class="h-full rounded-md transition-all duration-500"
                  :style="{
                    width: item.pct + '%',
                    backgroundColor: `hsl(${i * hueStep}, 55%, 55%)`,
                  }"
                />
              </div>
              <span
                class="text-[11px] text-gray-400 dark:text-brand-mid tabular-nums w-5 text-right flex-shrink-0"
                >{{ item.count }}</span
              >
            </div>
          </div>
        </div>

        <!-- Weekly activity -->
        <div>
          <h3
            class="text-[12px] font-semibold text-gray-500 dark:text-brand-mid mb-3 uppercase tracking-[0.5px]"
          >
            近7天复习
          </h3>
          <div class="flex items-end justify-between gap-1.5 h-24 px-1">
            <div
              v-for="(day, i) in stats.weeklyActivity.value"
              :key="i"
              class="flex-1 flex flex-col items-center gap-1.5"
            >
              <div class="w-full flex items-end justify-center h-16">
                <div
                  class="w-full max-w-[28px] rounded-t-md transition-all duration-500"
                  :class="day.count > 0 ? 'bg-accent' : 'bg-gray-150'"
                  :style="{
                    height: day.max > 0 ? Math.max(4, (day.count / day.max) * 100) + '%' : '4px',
                    backgroundColor: day.count > 0 ? undefined : '#e5e7eb',
                  }"
                />
              </div>
              <span class="text-[10px] text-gray-400 dark:text-brand-mid">{{ day.day }}</span>
            </div>
          </div>
        </div>

        <!-- Accuracy distribution -->
        <div>
          <h3
            class="text-[12px] font-semibold text-gray-500 dark:text-brand-mid mb-3 uppercase tracking-[0.5px]"
          >
            掌握程度
          </h3>
          <div
            v-if="stats.masteryBuckets.value.every((b) => b.count === 0)"
            class="text-[12px] text-gray-400 dark:text-brand-mid text-center py-4"
          >
            暂无复习数据
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="bucket in stats.masteryBuckets.value"
              :key="bucket.label"
              class="flex items-center gap-2"
            >
              <span
                class="text-[12px] text-gray-600 dark:text-brand-light-gray w-[48px] text-right flex-shrink-0"
              >
                {{ bucket.label }}
              </span>
              <div class="flex-1 h-4 bg-gray-100 dark:bg-[#1e1e1c] rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :style="{ width: bucket.pct + '%', backgroundColor: bucket.color }"
                />
              </div>
              <span
                class="text-[11px] text-gray-400 dark:text-brand-mid tabular-nums w-6 text-right flex-shrink-0"
                >{{ bucket.count }}</span
              >
            </div>
          </div>
        </div>

        <!-- Completed review history -->
        <div>
          <h3
            class="text-[12px] font-semibold text-gray-500 dark:text-brand-mid mb-3 uppercase tracking-[0.5px]"
          >
            复习历史
          </h3>
          <div class="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1 dark:bg-[#1e1e1c]">
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium transition-colors"
              :class="
                historyScope === 'due'
                  ? 'bg-white text-accent shadow-sm dark:bg-[#333330]'
                  : 'text-gray-500 dark:text-brand-mid'
              "
              @click="historyScope = 'due'"
            >
              到期复习 ({{ stats.dueReviewHistory.value.length }})
            </button>
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium transition-colors"
              :class="
                historyScope === 'all'
                  ? 'bg-white text-violet-600 shadow-sm dark:bg-[#333330] dark:text-violet-300'
                  : 'text-gray-500 dark:text-brand-mid'
              "
              @click="historyScope = 'all'"
            >
              自由复习 ({{ stats.freeReviewHistory.value.length }})
            </button>
          </div>
          <div
            v-if="activeHistory.length === 0"
            class="rounded-xl border border-dashed border-gray-200 dark:border-[#383835] px-3 py-4 text-center text-[12px] text-gray-400 dark:text-brand-mid"
          >
            暂无已完成的{{ historyScope === 'due' ? '到期复习' : '自由复习' }}
          </div>
          <div v-else class="space-y-2">
            <button
              v-for="session in activeHistory"
              :key="session.id"
              class="w-full rounded-xl border border-gray-100 bg-gray-50/70 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 dark:border-[#2e2e2c] dark:bg-[#1e1e1c] dark:hover:bg-accent/10"
              @click="openSession(session)"
            >
              <div class="px-3 py-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[12px] font-medium text-gray-700 dark:text-brand-light-gray">{{
                    formatSessionTime(session.completedAt)
                  }}</span>
                  <span
                    class="text-[11px] font-medium"
                    :class="
                      historyScope === 'due'
                        ? 'text-accent'
                        : 'text-violet-600 dark:text-violet-300'
                    "
                    >完成 {{ session.reviewedCount }} / {{ session.totalCount }} 题</span
                  >
                </div>
                <div class="mt-1 text-[10px] text-gray-400 dark:text-brand-mid">
                  用时 {{ formatDuration(session.totalElapsedMs) }} · 点击查看全部题目
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
    <ReviewHistoryDetailModal
      v-if="selectedSession"
      :session="selectedSession"
      :scope="selectedSessionScope"
      @close="selectedSession = null"
    />
  </div>
</template>
