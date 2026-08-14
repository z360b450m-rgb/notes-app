import { computed, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry, ReviewLog } from '@/types'
import { useReviewLogs } from '@/composables/useReviewLogs'

function isToday(ts: number): boolean {
  const d = new Date(ts)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function dayLabel(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
}

export const MASTERY_LEVEL_DEFS = [
  { level: -1, label: '未复习', color: '#b0aea5' },
  { level: 0, label: '未掌握', color: '#d97757' },
  { level: 1, label: '一次复习', color: '#e8a87c' },
  { level: 2, label: '二次复习', color: '#6a9bcc' },
  { level: 3, label: '三次复习', color: '#788c5d' },
  { level: 4, label: '已掌握', color: '#5b8c4e' },
]

export function getMasteryLabel(entry: NoteEntry): string {
  const level = getMasteryLevel(entry)
  return MASTERY_LEVEL_DEFS.find((b) => b.level === level)?.label ?? '未复习'
}

export function getMasteryColor(entry: NoteEntry): string {
  const level = getMasteryLevel(entry)
  return MASTERY_LEVEL_DEFS.find((b) => b.level === level)?.color ?? '#9ca3af'
}

export function getMasteryLevel(entry: NoteEntry): number {
  if (entry.masteryLevel !== undefined) {
    if (entry.masteryLevel === 0 && (entry.reviewCount ?? 0) === 0) return -1
    return entry.masteryLevel
  }
  // Legacy fallback for entries without explicit masteryLevel
  const ef = entry.easeFactor
  if (ef === undefined) return -1
  if (ef >= 2.5) return 4
  if (ef >= 2.1) return 2
  if (ef >= 1.71) return 1
  return -1
}

export interface StatsState {
  totalCount: ComputedRef<number>
  dueCount: ComputedRef<number>
  reviewedToday: ComputedRef<number>
  totalReviews: ComputedRef<number>
  subjectBars: ComputedRef<{ name: string; count: number; pct: number }[]>
  weeklyActivity: ComputedRef<{ day: string; count: number; max: number }[]>
  masteryBuckets: ComputedRef<{ label: string; count: number; pct: number; color: string }[]>
  dueReviewHistory: ComputedRef<ReviewHistorySession[]>
  freeReviewHistory: ComputedRef<ReviewHistorySession[]>
}

export interface ReviewHistorySession {
  id: string
  completedAt: number
  reviewedCount: number
  totalCount: number
  totalElapsedMs: number
  entries: {
    entryId: string
    title: string
    subject: string
    tags: string[]
    question: string
    wrongAnswer: string
    correctAnswer: string
    quality: number | string
    isCorrect?: boolean
    selectedChoice?: string
    correctChoice?: string
    elapsedMs: number
    reviewNote?: string
  }[]
}

// ===================================================================
// @AI-GUIDE: 统计数据计算层
// 纯业务逻辑。掌握度分布、学科统计、7 日活动图表数据均在此计算。
// MASTERY_LEVEL_DEFS 为模块级常量, 被 useFilter 等引用。
// StatsState 返回值类型必须向后兼容。
// ===================================================================
export function useStats(entries: Ref<NoteEntry[]>, getNotebookId: () => string): StatsState {
  const { reviewLogs, loadLogs } = useReviewLogs(getNotebookId)
  loadLogs()

  // Only count logs for entries that still exist (filters orphans from deleted entries)
  const activeLogs = computed(() => {
    const idSet = new Set(entries.value.map((e) => e.id))
    return reviewLogs.value.filter((l) => idSet.has(l.entryId))
  })

  const totalCount = computed(() => entries.value.length)

  const dueCount = computed(
    () =>
      entries.value.filter((e) => {
        const next = e.nextReviewDate
        return next === undefined || next === 0 || next <= Date.now()
      }).length,
  )

  const reviewedToday = computed(() => activeLogs.value.filter((l) => isToday(l.timestamp)).length)

  const totalReviews = computed(() => activeLogs.value.length)

  const subjectBars = computed(() => {
    const map: Record<string, number> = {}
    entries.value.forEach((e) => {
      const s = e.subject || '未分类'
      map[s] = (map[s] || 0) + 1
    })
    const max = Math.max(1, ...Object.values(map))
    return Object.entries(map)
      .map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count)
  })

  const weeklyActivity = computed(() => {
    const now = new Date()
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

    const counts: number[] = Array(7).fill(0)

    activeLogs.value.forEach((l) => {
      const d = new Date(l.timestamp)
      const reviewMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

      const diffDays = Math.floor((todayMidnight - reviewMidnight) / 86400000)

      if (diffDays >= 0 && diffDays < 7) {
        counts[6 - diffDays]++
      }
    })

    const max = Math.max(1, ...counts)
    return counts.map((count, i) => ({
      day: dayLabel(i - 6),
      count,
      max,
    }))
  })

  const masteryBuckets = computed(() => {
    const total = entries.value.length || 1
    return MASTERY_LEVEL_DEFS.map((b) => {
      const count = entries.value.filter((e) => getMasteryLevel(e) === b.level).length
      return { ...b, count, pct: Math.round((count / total) * 100) }
    })
  })

  function buildReviewHistory(scope: 'due' | 'all'): ReviewHistorySession[] {
    const entryMap = new Map(entries.value.map((entry) => [entry.id, entry]))
    const sessions = new Map<string, ReviewLog[]>()

    for (const log of activeLogs.value) {
      if (!log.sessionId || log.reviewScope !== scope || !log.sessionSize) continue
      const group = sessions.get(log.sessionId) ?? []
      group.push(log)
      sessions.set(log.sessionId, group)
    }

    return Array.from(sessions.entries())
      .filter(([, logs]) => logs.some((log) => log.sessionCompleted))
      .map(([id, logs]) => {
        const ordered = [...logs].sort((a, b) => a.timestamp - b.timestamp)
        const last = ordered[ordered.length - 1]
        return {
          id,
          completedAt: last.timestamp,
          reviewedCount: ordered.length,
          totalCount: Math.max(...ordered.map((log) => log.sessionSize ?? 0)),
          totalElapsedMs: ordered.reduce((sum, log) => sum + (log.elapsedMs ?? 0), 0),
          entries: ordered.map((log) => {
            const entry = entryMap.get(log.entryId)
            return {
              entryId: log.entryId,
              title:
                entry?.title ||
                entry?.question.replace(/<[^>]*>/g, '').slice(0, 60) ||
                '题目已删除',
              subject: entry?.subject || '未分类',
              tags: entry?.tags ?? [],
              question: entry?.question ?? '',
              wrongAnswer: entry?.wrongAnswer ?? '',
              correctAnswer: entry?.correctAnswer ?? '',
              quality: log.quality,
              isCorrect: log.isCorrect,
              selectedChoice: log.selectedChoice,
              correctChoice: log.correctChoice,
              elapsedMs: log.elapsedMs ?? 0,
              reviewNote: log.reviewNote,
            }
          }),
        }
      })
      .sort((a, b) => b.completedAt - a.completedAt)
  }

  const dueReviewHistory = computed(() => buildReviewHistory('due'))
  const freeReviewHistory = computed(() => buildReviewHistory('all'))

  return {
    totalCount,
    dueCount,
    reviewedToday,
    totalReviews,
    subjectBars,
    weeklyActivity,
    masteryBuckets,
    dueReviewHistory,
    freeReviewHistory,
  }
}
