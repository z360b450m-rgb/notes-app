import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry } from '@/types'
import { db } from '@/services/db'
import { useReviewLogs } from '@/composables/useReviewLogs'
import { useReviewSettings } from '@/composables/useReviewSettings'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function isToday(ts: number): boolean {
  const d = new Date(ts)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function intervalForLevel(
  passes: number,
  entry: NoteEntry,
  firstReviewDays: number,
  masteredDays: number,
  growthFactor: number,
  maxInterval: number,
): number {
  if (passes === 0) return firstReviewDays
  if (passes === 1) return masteredDays
  if (passes === 2) return Math.round(masteredDays * growthFactor)
  return Math.min(Math.round((entry.interval ?? masteredDays) * growthFactor), maxInterval)
}

function applyCustom(
  entry: NoteEntry,
  rating: string,
  firstReviewDays: number,
  unmasteredDays: number,
  masteredDays: number,
  growthFactor: number,
  maxInterval: number,
) {
  const passes = entry.consecutivePasses ?? 0
  entry.reviewCount = (entry.reviewCount ?? 0) + 1

  if (rating === 'forgot') {
    entry.consecutivePasses = 0
    entry.interval = unmasteredDays
    entry.masteryLevel = 0
    entry.easeFactor = 1.3
  } else if (rating === 'unfamiliar') {
    if (passes === 0) {
      entry.consecutivePasses = 0
      entry.masteryLevel = 0
      entry.interval = unmasteredDays
    } else {
      entry.interval = intervalForLevel(
        passes,
        entry,
        firstReviewDays,
        masteredDays,
        growthFactor,
        maxInterval,
      )
    }
    entry.easeFactor = 1.8
  } else {
    entry.consecutivePasses = passes + 1
    const cp = entry.consecutivePasses
    entry.masteryLevel = Math.min(cp, 4)
    entry.interval = intervalForLevel(
      cp,
      entry,
      firstReviewDays,
      masteredDays,
      growthFactor,
      maxInterval,
    )
    entry.easeFactor = 2.5
  }

  entry.lastReviewDate = Date.now()
  entry.nextReviewDate = Date.now() + entry.interval * 86400000
}

export interface ReviewState {
  mode: Ref<'edit' | 'review'>
  reviewQueue: Ref<NoteEntry[]>
  reviewIndex: Ref<number>
  currentCard: ComputedRef<NoteEntry | undefined>
  answered: Ref<boolean>
  elapsedMs: Ref<number>
  reviewedToday: ComputedRef<number>
  dueCount: ComputedRef<number>
  isReviewing: ComputedRef<boolean>
  progress: ComputedRef<string>
  progressPercent: ComputedRef<number>
  sessionDone: Ref<boolean>
  sessionRecords: Ref<SessionRecord[]>
  totalSessionMs: ComputedRef<number>
  startReview: (force?: boolean) => boolean
  revealAnswer: () => void
  rateCard: (rating: number | string, note?: string) => Promise<void>
  exitReview: () => void
  dismissSummary: () => void
  loadLogs: () => Promise<void>
}

export interface SessionRecord {
  entryId: string
  elapsedMs: number
  quality: number | string
}

// ===================================================================
// @AI-GUIDE: 间隔重复复习算法 (SM-2 变体)
// 纯业务逻辑。SRS 评级/间隔计算/掌握等级判定均在此实现。
// 修改复习算法规则时必须在此处变更, 且确保 ReviewState 返回值类型
// 向后兼容 —— 只能追加字段。
// ===================================================================
export function useReview(
  entries: Ref<NoteEntry[]>,
  showToast?: (msg: string) => void,
  getNotebookId?: () => string,
): ReviewState {
  const mode = ref<'edit' | 'review'>('edit')
  const reviewIndex = ref(0)
  const answered = ref(false)
  const forceAll = ref(false)
  const cardStartTime = ref(0)
  const elapsedMs = ref(0)
  const now = ref(Date.now())
  let timerInterval: ReturnType<typeof setInterval> | null = null
  let clockInterval: ReturnType<typeof setInterval> | null = null

  const { addLog, loadLogs } = useReviewLogs(getNotebookId || (() => ''))
  loadLogs()

  const { settings } = useReviewSettings()

  // When settings change, recalculate nextReviewDate for all entries AND persist to DB
  watch(
    settings,
    async () => {
      const s = settings.value
      const updatePromises: Promise<void>[] = []

      for (const entry of entries.value) {
        if (!entry.lastReviewDate) continue

        const passes = entry.consecutivePasses ?? 0
        const interval =
          passes === 0
            ? s.unmasteredDays
            : intervalForLevel(
                passes,
                entry,
                s.firstReviewDays,
                s.masteredDays,
                s.growthFactor,
                s.maxInterval,
              )

        // 只有当时间间隔真的发生变化时，才更新并写入数据库
        if (entry.interval !== interval) {
          entry.interval = interval
          entry.nextReviewDate = entry.lastReviewDate + interval * 86400000

          // 使用 JSON.parse(JSON.stringify) 去除 Vue 的 Proxy 响应式包装，防止 IndexedDB 报 CloneError
          updatePromises.push(db.put(JSON.parse(JSON.stringify(entry))))
        }
      }

      // 批量将修改过的卡片持久化到数据库
      if (updatePromises.length > 0) {
        try {
          await Promise.all(updatePromises)
        } catch (error) {
          console.error('Failed to sync updated review intervals to database:', error)
          showToast?.('同步设置到数据库失败，部分卡片可能未更新')
        }
      }
    },
    { deep: true },
  )

  const sessionDone = ref(false)
  const sessionRecords = ref<SessionRecord[]>([])

  const totalSessionMs = computed(() =>
    sessionRecords.value.reduce((sum, r) => sum + r.elapsedMs, 0),
  )

  function startTimer() {
    cardStartTime.value = Date.now()
    elapsedMs.value = 0
    if (timerInterval) clearInterval(timerInterval)
    timerInterval = setInterval(() => {
      elapsedMs.value = Date.now() - cardStartTime.value
    }, 100)
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
    elapsedMs.value = Date.now() - cardStartTime.value
  }

  // Keep due-count reactive to wall-clock time (e.g., midnight rollover)
  clockInterval = setInterval(() => {
    now.value = Date.now()
  }, 30_000)

  onUnmounted(() => {
    if (timerInterval) clearInterval(timerInterval)
    if (clockInterval) clearInterval(clockInterval)
  })

  const dueEntries = computed(() =>
    entries.value.filter((e) => {
      void now.value // trigger recompute on clock tick (midnight rollover)
      const next = e.nextReviewDate
      return next === undefined || next === 0 || next <= Date.now()
    }),
  )

  const reviewQueue = ref<NoteEntry[]>([])

  const currentCard = computed(() => reviewQueue.value[reviewIndex.value])

  const dueCount = computed(() => dueEntries.value.length)

  const reviewedToday = computed(
    () => entries.value.filter((e) => e.lastReviewDate && isToday(e.lastReviewDate)).length,
  )

  const isReviewing = computed(
    () => mode.value === 'review' && reviewIndex.value < reviewQueue.value.length,
  )

  const progress = computed(() => {
    if (reviewQueue.value.length === 0) return ''
    const remaining = Math.max(0, reviewQueue.value.length - reviewIndex.value)
    return `剩余 ${remaining} 题`
  })

  const progressPercent = computed(() => {
    if (reviewQueue.value.length === 0) return 0
    return (reviewIndex.value / reviewQueue.value.length) * 100
  })

  function startReview(force = false): boolean {
    forceAll.value = force

    const pool = force ? entries.value : dueEntries.value

    if (pool.length === 0) {
      return false
    }

    reviewQueue.value = shuffle(pool)
    mode.value = 'review'
    reviewIndex.value = 0
    answered.value = false
    sessionDone.value = false
    sessionRecords.value = []
    startTimer()
    return true
  }

  function revealAnswer() {
    answered.value = true
    stopTimer()
  }

  async function rateCard(rating: number | string, note?: string) {
    const card = currentCard.value
    if (!card) return

    const entry = entries.value.find((e) => e.id === card.id)
    if (!entry) return

    // 1. 核心修复：深拷贝当前卡片，所有状态演进和非纯操作都在副本上进行
    const entryClone = JSON.parse(JSON.stringify(entry))

    if (note && note.trim()) {
      const separator = '\n\n————————————————\n\n'
      entryClone.wrongAnswer = (entryClone.wrongAnswer || '') + separator + note.trim()
    }

    applyCustom(
      entryClone,
      rating as string,
      settings.value.firstReviewDays,
      settings.value.unmasteredDays,
      settings.value.masteredDays,
      settings.value.growthFactor,
      settings.value.maxInterval,
    )

    try {
      // 2. 核心修复：首先尝试将更新后的副本写入数据库
      // 此时如果写入失败，会直接进入 catch 块，不会影响到界面和真实的 Vue 状态
      await db.put(JSON.parse(JSON.stringify(entryClone)))
      await addLog(entryClone.id, rating)
    } catch (err) {
      console.error('Failed to save review result', err)
      showToast?.('保存复习记录失败，请重试')
      // 拦截返回，不执行任何内存状态的变更
      return
    }

    // 3. 核心修复：只有当数据库完全持久化成功后，才同步修改 Vue 的响应式状态
    // Object.assign 会触发 Vue 的响应式更新，使界面安全、正确地刷新
    Object.assign(entry, entryClone)

    sessionRecords.value.push({
      entryId: entry.id,
      elapsedMs: elapsedMs.value,
      quality: rating,
    })

    if (reviewIndex.value < reviewQueue.value.length - 1) {
      reviewIndex.value++
      answered.value = false
      startTimer()
    } else {
      sessionDone.value = true
      stopTimer()
    }
  }

  function exitReview() {
    mode.value = 'edit'
    answered.value = false
    sessionDone.value = false
    stopTimer()
  }

  function dismissSummary() {
    sessionDone.value = false
    sessionRecords.value = []
    mode.value = 'edit'
  }

  return {
    mode,
    reviewQueue,
    reviewIndex,
    currentCard,
    answered,
    elapsedMs,
    reviewedToday,
    dueCount,
    isReviewing,
    progress,
    progressPercent,
    sessionDone,
    sessionRecords,
    totalSessionMs,
    startReview,
    revealAnswer,
    rateCard,
    exitReview,
    dismissSummary,
    loadLogs,
  }
}
