import { computed, onScopeDispose, ref, watch } from 'vue'
import type { NoteEntry, ReviewLog } from '@/types'
import { getAccessToken, getStoredUser } from '@/services/auth'
import { SYNC_COMPLETED_EVENT, type SyncCompleted } from '@/services/syncEvents'
import {
  getReviewInsight,
  type ReviewInsight,
  type ReviewInsightAction,
} from '@/services/reviewInsights'
import { learningCounts } from '@/utils/learningCounts'
import {
  prepareReviewBundle,
  confirmReviewBundle,
  type ReviewBundle,
} from '@/services/reviewBundles'
import {
  useEntryLearningConversation,
  type EntryLearningTurn,
} from './useEntryLearningConversation'

export function useEntryReviewInsight(getEntry: () => NoteEntry, getLogs: () => ReviewLog[]) {
  const insight = ref<ReviewInsight | null>(null)
  const loading = ref(false)
  const error = ref('')
  const answer = ref('')
  const summaries = ref<string[]>([])
  const assistantError = ref('')
  const bundleSending = ref(false)
  const lastAction = ref<ReviewInsightAction | null>(null)
  const {
    turns,
    draft,
    contextChanged,
    storageError,
    clearConversation,
    persist,
    sending: chatSending,
    run: runConversationTurn,
    stop: stopConversation,
  } = useEntryLearningConversation(getEntry)
  const sending = computed(() => bundleSending.value || chatSending.value)
  const bundle = ref<ReviewBundle | null>(null)
  const confirming = ref(false)
  const loggedIn = !!getAccessToken()
  let readController: AbortController | undefined
  let assistantController: AbortController | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  function interruptTurn(_message: string) {
    assistantController?.abort()
    assistantController = undefined
    bundleSending.value = false
    confirming.value = false
  }

  function clearChat() {
    interruptTurn('回复已停止，可重试。')
    clearConversation()
    assistantError.value = ''
    answer.value = ''
    summaries.value = []
    lastAction.value = bundle.value ? 'arrange_review' : null
  }

  const localCounts = computed(() => learningCounts(getEntry(), getLogs()))
  const counts = computed(() => ({
    reviewCount: Math.max(localCounts.value.reviewCount, insight.value?.review_count ?? 0),
    wrongCount: Math.max(localCounts.value.wrongCount, insight.value?.wrong_count ?? 0),
  }))
  const currentInsight = computed(() => {
    if (error.value) return null
    const card = insight.value
    return card &&
      card.review_count >= localCounts.value.reviewCount &&
      card.wrong_count >= localCounts.value.wrongCount
      ? card
      : null
  })
  const localJudged = computed(() =>
    getLogs().filter(
      (log) =>
        log.entryId === getEntry().id &&
        log.timestamp <= Date.now() &&
        typeof log.isCorrect === 'boolean',
    ),
  )
  const status = computed(
    () =>
      currentInsight.value?.status.label ??
      (counts.value.reviewCount === 0
        ? '尚未复习'
        : localJudged.value.length
          ? '已有复习记录'
          : '待判定对错'),
  )
  const recommendation = computed(
    () =>
      currentInsight.value?.recommendation ??
      (localJudged.value.length ? '独立重做，核对关键步骤' : '先完成一次独立作答'),
  )
  const evidence = computed(
    () =>
      currentInsight.value?.evidence.explanation ??
      (counts.value.reviewCount === 0
        ? '暂无作答记录，暂不判断个人薄弱程度。'
        : localJudged.value.length
          ? '当前显示本地复习记录，个人风险建议待联网后确认。'
          : '暂无明确对错的作答记录，暂不判断个人薄弱程度。'),
  )
  const canAsk = computed(() => loggedIn && !!insight.value && !error.value && !loading.value)

  async function refresh() {
    clearTimeout(refreshTimer)
    readController?.abort()
    if (!loggedIn) return
    const entryId = getEntry().id
    const controller = new AbortController()
    readController = controller
    loading.value = true
    error.value = ''
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const result = await getReviewInsight(entryId, controller.signal)
      if (!controller.signal.aborted && getEntry().id === entryId) insight.value = result
    } catch (cause) {
      if (readController !== controller || getEntry().id !== entryId) return
      error.value = controller.signal.aborted
        ? '复习建议加载超时，请重试。'
        : cause instanceof Error
          ? cause.message
          : '复习建议暂时无法读取，请重试。'
    } finally {
      clearTimeout(timeout)
      if (readController === controller) loading.value = false
    }
  }

  async function runTurn(turn: EntryLearningTurn) {
    if (!canAsk.value || sending.value || confirming.value) return
    lastAction.value = turn.action
    assistantError.value = ''
    await runConversationTurn(turn)
  }

  async function sendMessage(message: string) {
    const text = message.trim()
    if (!canAsk.value || sending.value || confirming.value || !text || text.length > 2000) return
    turns.value.push({
      id: crypto.randomUUID(),
      action: 'discuss_question',
      userText: text,
      answer: '',
      summaries: [],
      status: 'streaming',
      error: '',
    })
    await runTurn(turns.value.at(-1)!)
  }

  async function ask(action: 'arrange_review' | 'learn_knowledge') {
    if (!canAsk.value || sending.value || confirming.value) return
    if (action === 'learn_knowledge') {
      turns.value.push({
        id: crypto.randomUUID(),
        action,
        userText: '学习此题知识点',
        answer: '',
        summaries: [],
        status: 'streaming',
        error: '',
      })
      await runTurn(turns.value.at(-1)!)
      return
    }
    const entryId = getEntry().id
    const controller = new AbortController()
    assistantController = controller
    lastAction.value = action
    bundleSending.value = true
    assistantError.value = ''
    bundle.value = null
    try {
      const result = await prepareReviewBundle(
        entryId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(140_000)]),
      )
      if (
        assistantController === controller &&
        !controller.signal.aborted &&
        getEntry().id === entryId
      )
        bundle.value = result
    } catch (cause) {
      if (assistantController !== controller || getEntry().id !== entryId) return
      assistantError.value = controller.signal.aborted
        ? '回复已停止，可重试。'
        : cause instanceof Error
          ? cause.message
          : '助手请求失败，请稍后重试。'
    } finally {
      if (assistantController === controller) bundleSending.value = false
    }
  }

  async function retryTurn(turnId: string) {
    const turn = turns.value.at(-1)
    if (turn?.id === turnId && turn.status === 'error') await runTurn(turn)
  }

  async function confirmBundle() {
    const current = bundle.value
    if (!current || sending.value || confirming.value || current.anchor_entry_id !== getEntry().id)
      return null
    const entryId = getEntry().id
    const controller = new AbortController()
    assistantController = controller
    confirming.value = true
    lastAction.value = 'arrange_review'
    assistantError.value = ''
    try {
      const result = await confirmReviewBundle(
        entryId,
        current,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      return !controller.signal.aborted && getEntry().id === entryId ? result : null
    } catch (cause) {
      if (getEntry().id === entryId && assistantController === controller)
        assistantError.value = cause instanceof Error ? cause.message : '确认失败，请重新组题'
      return null
    } finally {
      if (assistantController === controller) confirming.value = false
    }
  }

  watch(
    () => [getEntry().notebookId, getEntry().id],
    () => {
      readController?.abort()
      interruptTurn('切换题目时回复已停止，可重试。')
      clearTimeout(refreshTimer)
      insight.value = null
      answer.value = ''
      summaries.value = []
      assistantError.value = ''
      lastAction.value = null
      bundleSending.value = false
      bundle.value = null
      confirming.value = false
      void refresh()
    },
    { immediate: true },
  )
  watch(
    () => [
      getEntry().question,
      getEntry().correctAnswer,
      getEntry().wrongAnswer,
      getEntry().subject,
      getEntry().tags.join('\0'),
      getEntry().groupId,
    ],
    () => {
      bundle.value = null
      assistantError.value =
        sending.value || confirming.value ? '题目内容已变化，请保存后重新提问或组题。' : ''
      interruptTurn('题目内容已变化，请保存后重新提问。')
      answer.value = ''
      summaries.value = []
      lastAction.value = null
    },
  )
  watch(
    () => [
      getEntry().updatedAt,
      getEntry().reviewCount,
      getEntry().wrongCount,
      getLogs()
        .map((log) => `${log.id}:${log.isCorrect}:${log.timestamp}`)
        .join('|'),
    ],
    () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refresh(), 300)
    },
  )
  onScopeDispose(() => {
    window.removeEventListener(SYNC_COMPLETED_EVENT, onSyncCompleted)
    clearTimeout(refreshTimer)
    readController?.abort()
    interruptTurn('离开题目时回复已停止，可重试。')
    persist()
  })
  function onSyncCompleted(event: Event) {
    const detail = (event as CustomEvent<SyncCompleted>).detail
    const entry = getEntry()
    if (
      !detail ||
      detail.owner !== getStoredUser()?.id ||
      (!detail.entryIds.includes(entry.id) &&
        !(entry.groupId && detail.groupIds.includes(entry.groupId)))
    )
      return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 100)
  }
  window.addEventListener(SYNC_COMPLETED_EVENT, onSyncCompleted)
  return {
    insight: currentInsight,
    counts,
    status,
    recommendation,
    evidence,
    loading,
    error,
    loggedIn,
    canAsk,
    refresh,
    ask,
    turns,
    draft,
    contextChanged,
    storageError,
    clearChat,
    sendMessage,
    retryTurn,
    answer,
    summaries,
    assistantError: computed(
      () =>
        assistantError.value ||
        (lastAction.value === 'arrange_review' ? '' : turns.value.at(-1)?.error) ||
        '',
    ),
    sending,
    lastAction: computed(() =>
      bundleSending.value || confirming.value
        ? 'arrange_review'
        : (lastAction.value ??
          turns.value.at(-1)?.action ??
          (bundle.value ? 'arrange_review' : null)),
    ),
    bundle,
    confirming,
    confirmBundle,
    stop: () => {
      if (chatSending.value) stopConversation()
      else assistantController?.abort()
    },
  }
}
