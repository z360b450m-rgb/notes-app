import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry, ReviewLog } from '@/types'
import { entryRepository, cacheGradedReview } from '@/services/db'
import { submitReviewAnswer, submitReviewExplanation, readReviewAttempt, ReviewGradingError, canAdvanceReviewAttempt, isReviewAttemptComplete, type ReviewAttempt } from '@/services/reviewGrading'
import { useReviewLogs } from '@/composables/useReviewLogs'
import { useReviewSettings } from '@/composables/useReviewSettings'
import { learningCounts } from '@/utils/learningCounts'

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
  startReview: (options?: ReviewOptions | boolean) => boolean
  revealAnswer: () => void
  rateCard: (rating: number | string, note?: string, outcome?: ReviewOutcome) => Promise<void>
  exitReview: () => void
  dismissSummary: () => void
  loadLogs: () => Promise<void>
  cardLoading: Ref<boolean>
  cardError: Ref<string>
  retryCurrentCard: () => Promise<void>
  setReviewOutcome: (outcome: ReviewOutcome) => void
  savingReview: Ref<boolean>
  gradingAttempt: Ref<ReviewAttempt | null>
  gradingError: Ref<string>
  gradingLocked: ComputedRef<boolean>
  explainReview: (text: string) => Promise<void>
  nextGradedCard: () => void
  retryGrading: () => Promise<void>
}

export interface ReviewOptions {
  entryIds?: string[]
  scope?: 'due' | 'all'
  tags?: string[]
  subjects?: string[]
  random?: boolean
  limit?: number
}

export interface SessionRecord {
  entryId: string
  elapsedMs: number
  quality: number | string
  selectedChoice?: string
  correctChoice?: string
  isCorrect?: boolean
  answerText?: string
  gradeComment?: string
  explanationText?: string
  attemptId?: string
}

export interface ReviewOutcome {
  selectedChoice?: string
  correctChoice?: string
  isCorrect?: boolean
  answerText?: string
}

interface ReviewSessionContext extends ReviewOutcome {
  sessionId: string
  reviewScope: 'due' | 'all'
  sessionSize: number
  sessionCompleted: boolean
  elapsedMs: number
  reviewNote?: string
}

// ===================================================================
// @AI-GUIDE: 间隔重复复习算法 (SM-2 变体)
// 纯业务逻辑。SRS 评级/间隔计算/掌握等级判定均在此实现。
// 修改复习算法规则时必须在此处变更, 且确保 ReviewState 返回值类型
// 向后兼容 —— 只能追加字段。
// ===================================================================
export function useReview(
  entries: Ref<NoteEntry[]>,
  getNotebookId: () => string,
  showToast?: (msg: string) => void,
  loadEntryContent?: (id: string) => Promise<NoteEntry>,
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

  const { addLog, loadLogs, reviewLogs, acceptServerLog } = useReviewLogs(getNotebookId)
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
        if (entry.isSummary) {
          try {
            const full = loadEntryContent
              ? await loadEntryContent(entry.id)
              : await entryRepository.get(entry.notebookId, entry.id)
            if (!full || full.isSummary) continue
            Object.assign(entry, full)
            delete entry.isSummary
          } catch {
            showToast?.('部分题目暂时无法加载，请恢复连接后重试设置')
            continue
          }
        }

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
          updatePromises.push(
            entryRepository.put(entry.notebookId, JSON.parse(JSON.stringify(entry))),
          )
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
  const activeSessionId = ref('')
  const activeReviewScope = ref<'due' | 'all'>('due')
  let currentOutcome: ReviewOutcome | undefined
  const savingReview = ref(false)
  const gradingAttempt = ref<ReviewAttempt | null>(null)
  const gradingError = ref('')
  const submission = ref<{ entryId: string; attemptId: string; answer: string; elapsedMs: number } | null>(null)
  const gradingLocked = computed(() => !!submission.value)
  let gradingController: AbortController | null = null

  function clearGrading() {
    gradingController?.abort()
    gradingController = null
    gradingAttempt.value = null
    gradingError.value = ''
    submission.value = null
    savingReview.value = false
  }

  function recordUnjudgedAttempt(result: ReviewAttempt) {
      if (!sessionRecords.value.some((item) => item.attemptId === result.attempt_id)) {
        sessionRecords.value.push({ entryId: result.entry_id,
          elapsedMs: submission.value?.elapsedMs ?? 0, quality: 'agent_unjudged',
          answerText: result.answer_text, explanationText: result.explanation_text,
          gradeComment: result.comment, attemptId: result.attempt_id })
      }
  }

  async function applyGrade(result: ReviewAttempt) {
    gradingAttempt.value = result
    if (isReviewAttemptComplete(result) && !canAdvanceReviewAttempt(result)) {
      recordUnjudgedAttempt(result)
      return
    }
    if (!canAdvanceReviewAttempt(result) || !result.entry_review || !result.review_log) return
    const entry = entries.value.find((item) => item.id === result.entry_id)
    if (!entry) return
    const saved = result.entry_review
    const clone = { ...JSON.parse(JSON.stringify(entry)), reviewCount: saved.review_count,
      wrongCount: saved.wrong_count, lastReviewDate: saved.last_review_date, updatedAt: saved.updated_at }
    const raw = result.review_log
    const log: ReviewLog = { id: raw.id, entryId: raw.entry_id, timestamp: raw.timestamp,
      quality: raw.quality, isCorrect: raw.is_correct, elapsedMs: raw.elapsed_ms,
      answerText: raw.answer_text, reviewNote: raw.review_note, sessionId: activeSessionId.value,
      reviewScope: activeReviewScope.value, sessionSize: reviewQueue.value.length,
      sessionCompleted: reviewIndex.value >= reviewQueue.value.length - 1 }
    Object.assign(entry, clone)
    acceptServerLog(log)
    if (!sessionRecords.value.some((item) => item.attemptId === result.attempt_id))
      sessionRecords.value.push({ entryId: entry.id, elapsedMs: raw.elapsed_ms, quality: raw.quality,
        isCorrect: raw.is_correct, answerText: raw.answer_text, gradeComment: result.comment,
        explanationText: result.explanation_text, attemptId: result.attempt_id })
    try { await cacheGradedReview(clone, log) }
    catch { showToast?.('判卷已保存到后端，本地缓存暂未更新') }
  }

  async function gradeCurrent(explanation?: string) {
    const selected = submission.value
    if (!selected || savingReview.value || currentCard.value?.id !== selected.entryId) return
    if (isReviewAttemptComplete(gradingAttempt.value)) return
    const session = activeSessionId.value
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(75_000)])
    gradingController = controller
    savingReview.value = true
    gradingError.value = ''
    try {
      const result = explanation !== undefined && gradingAttempt.value
        ? await submitReviewExplanation(selected.entryId, gradingAttempt.value, explanation, requestSignal)
        : await submitReviewAnswer(selected.entryId, selected.attemptId, selected.answer, selected.elapsedMs, requestSignal)
      if (!controller.signal.aborted && activeSessionId.value === session && currentCard.value?.id === selected.entryId)
        await applyGrade(result)
    } catch (error) {
      if (!controller.signal.aborted) gradingError.value = error instanceof Error && error.name === 'TimeoutError'
        ? '判卷超时，作答已保留，请重试' : error instanceof Error ? error.message : '判卷失败，请重试'
      if (!controller.signal.aborted && error instanceof ReviewGradingError && error.status === 409) {
        try {
          const latest = await readReviewAttempt(selected.entryId, selected.attemptId, controller.signal)
          if (!controller.signal.aborted && activeSessionId.value === session && currentCard.value?.id === selected.entryId) {
            await applyGrade(latest)
            if (isReviewAttemptComplete(latest)) gradingError.value = ''
          }
        } catch { /* 保留本次输入和原错误，允许之后重试。 */ }
      }
    } finally {
      if (gradingController === controller) {
        gradingController = null
        savingReview.value = false
      }
    }
  }

  async function explainReview(text: string) {
    if (!text.trim() || !gradingAttempt.value || gradingAttempt.value.status === 'final') return
    await gradeCurrent(text.trim())
  }

  async function retryGrading() { await gradeCurrent() }

  function completeSession() {
    stopTimer()
    reviewIndex.value = reviewQueue.value.length
    sessionDone.value = true
  }

  function nextGradedCard() {
    const result = gradingAttempt.value
    const selected = submission.value
    if (savingReview.value || sessionDone.value || !result || !isReviewAttemptComplete(result) ||
        !selected || selected.entryId !== currentCard.value?.id || result.entry_id !== selected.entryId ||
        result.attempt_id !== selected.attemptId) return
    if (!sessionRecords.value.some((record) => record.attemptId === result.attempt_id)) {
      if (canAdvanceReviewAttempt(result)) return
      recordUnjudgedAttempt(result)
    }
    clearGrading()
    if (reviewIndex.value < reviewQueue.value.length-1) {
      reviewIndex.value++
      answered.value = false
      currentOutcome = undefined
      if (!loadEntryContent) startTimer()
    } else {
      completeSession()
    }
  }

  function setReviewOutcome(outcome: ReviewOutcome) {
    currentOutcome = outcome
  }

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
    clearGrading()
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
  const cardLoading = ref(false)
  const cardError = ref('')
  let cardSequence = 0

  const currentCard = computed(() => {
    const id = reviewQueue.value[reviewIndex.value]?.id
    const card = entries.value.find((entry) => entry.id === id)
    return card?.isSummary ? undefined : card
  })

  async function retryCurrentCard() {
    const sequence = ++cardSequence
    cardError.value = ''
    cardLoading.value = false
    if (mode.value !== 'review' || sessionDone.value || !loadEntryContent) return
    const card = reviewQueue.value[reviewIndex.value]
    if (!card) return
    cardLoading.value = true
    stopTimer()
    try {
      await loadEntryContent(card.id)
      if (sequence !== cardSequence || mode.value !== 'review') return
      cardLoading.value = false
      startTimer()
      const next = reviewQueue.value[reviewIndex.value + 1]
      if (next) void loadEntryContent(next.id).catch(() => {})
    } catch (error) {
      if (sequence === cardSequence)
        cardError.value = error instanceof Error ? error.message : '复习题目加载失败，请重试'
    } finally {
      if (sequence === cardSequence) cardLoading.value = false
    }
  }

  watch([() => reviewQueue.value[reviewIndex.value]?.id, mode], () => void retryCurrentCard())

  const dueCount = computed(() => dueEntries.value.length)

  const reviewedToday = computed(
    () => entries.value.filter((e) => e.lastReviewDate && isToday(e.lastReviewDate)).length,
  )

  const isReviewing = computed(
    () => mode.value === 'review' && !sessionDone.value && reviewIndex.value < reviewQueue.value.length,
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

  function startReview(options: ReviewOptions | boolean = {}): boolean {
    // Boolean input remains supported for existing keyboard and UI callers.
    const config: ReviewOptions =
      typeof options === 'boolean' ? { scope: options ? 'all' : 'due' } : options
    const scope = config.scope ?? 'due'
    forceAll.value = scope === 'all'

    const exact = config.entryIds
    if (exact && (!exact.length || new Set(exact).size !== exact.length)) return false
    let pool = exact
      ? exact.map((id) => entries.value.find((entry) => entry.id === id)).filter((entry): entry is NoteEntry => !!entry)
      : scope === 'all' ? entries.value : dueEntries.value
    if (exact && pool.length !== exact.length) return false
    if (config.tags?.length) {
      pool = pool.filter((entry) => config.tags!.some((tag) => entry.tags.includes(tag)))
    }
    if (config.subjects?.length) {
      pool = pool.filter((entry) => config.subjects!.includes(entry.subject))
    }
    if (exact && pool.length !== exact.length) return false

    if (pool.length === 0) {
      return false
    }
    clearGrading()

    const ordered = exact || config.random === false ? [...pool] : shuffle(pool)
    reviewQueue.value = !exact && config.limit && config.limit > 0 ? ordered.slice(0, config.limit) : ordered
    activeSessionId.value = `rvs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    activeReviewScope.value = scope
    mode.value = 'review'
    reviewIndex.value = 0
    answered.value = false
    sessionDone.value = false
    sessionRecords.value = []
    currentOutcome = undefined
    if (!loadEntryContent) startTimer()
    return true
  }

  function revealAnswer() {
    if (cardLoading.value || cardError.value || !currentCard.value) return
    answered.value = true
    stopTimer()
  }

  async function rateCard(rating: number | string, note?: string, outcome?: ReviewOutcome) {
    const card = currentCard.value
    if (
      !card ||
      cardLoading.value ||
      cardError.value ||
      savingReview.value ||
      sessionDone.value ||
      (!answered.value && rating !== 'submitted')
    )
      return
    outcome ??= currentOutcome
    if (outcome) outcome = { ...outcome, answerText: outcome.answerText?.trim() || undefined }
    if (rating === 'submitted' && !outcome?.answerText && !outcome?.selectedChoice) return

    if (rating === 'submitted') {
      if (!submission.value) {
        stopTimer()
        submission.value = { entryId: card.id, attemptId: crypto.randomUUID(),
          answer: [outcome?.selectedChoice ? `选项：${outcome.selectedChoice}` : '', outcome?.answerText || ''].filter(Boolean).join('\n'),
          elapsedMs: Math.min(86400000, Math.max(0, Math.round(elapsedMs.value))) }
      }
      await gradeCurrent()
      return
    }
    if (submission.value) return  // 等待判卷/理由时不能用旧评级路径绕过最终记录。

    const entry = entries.value.find((e) => e.id === card.id)
    if (!entry) return

    // 1. 核心修复：深拷贝当前卡片，所有状态演进和非纯操作都在副本上进行
    const entryClone = JSON.parse(JSON.stringify(entry))
    const counts = learningCounts(entry, reviewLogs.value)
    entryClone.reviewCount = counts.reviewCount
    entryClone.wrongCount = counts.wrongCount + (outcome?.isCorrect === false ? 1 : 0)

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
    entryClone.updatedAt = Date.now()

    savingReview.value = true
    let entrySaved = false
    try {
      // 2. 核心修复：首先尝试将更新后的副本写入数据库
      // 此时如果写入失败，会直接进入 catch 块，不会影响到界面和真实的 Vue 状态
      await entryRepository.put(entryClone.notebookId, JSON.parse(JSON.stringify(entryClone)))
      entrySaved = true
      const sessionContext: ReviewSessionContext = {
        ...outcome,
        sessionId: activeSessionId.value,
        reviewScope: activeReviewScope.value,
        sessionSize: reviewQueue.value.length,
        sessionCompleted: reviewIndex.value >= reviewQueue.value.length - 1,
        elapsedMs: elapsedMs.value,
        reviewNote: note?.trim() || undefined,
      }
      await addLog(entryClone.id, rating, sessionContext)
    } catch (err) {
      if (entrySaved) {
        await entryRepository
          .put(entry.notebookId, JSON.parse(JSON.stringify(entry)))
          .catch((error) => console.error('Failed to restore review entry', error))
      }
      console.error('Failed to save review result', err)
      showToast?.('保存复习记录失败，请重试')
      // 拦截返回，不执行任何内存状态的变更
      return
    } finally {
      savingReview.value = false
    }

    // 3. 核心修复：只有当数据库完全持久化成功后，才同步修改 Vue 的响应式状态
    // Object.assign 会触发 Vue 的响应式更新，使界面安全、正确地刷新
    Object.assign(entry, entryClone)

    sessionRecords.value.push({
      entryId: entry.id,
      elapsedMs: elapsedMs.value,
      quality: rating,
      ...outcome,
    })

    if (reviewIndex.value < reviewQueue.value.length - 1) {
      reviewIndex.value++
      answered.value = false
      currentOutcome = undefined
      if (!loadEntryContent) startTimer()
    } else {
      completeSession()
    }
  }

  function exitReview() {
    clearGrading()
    mode.value = 'edit'
    answered.value = false
    sessionDone.value = false
    currentOutcome = undefined
    stopTimer()
  }

  function dismissSummary() {
    exitReview()
    sessionRecords.value = []
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
    cardLoading,
    cardError,
    retryCurrentCard,
    setReviewOutcome,
    savingReview,
    gradingAttempt,
    gradingError,
    gradingLocked,
    explainReview,
    nextGradedCard,
    retryGrading,
  }
}
