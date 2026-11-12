import { computed, inject, onScopeDispose, ref, watch, type InjectionKey } from 'vue'
import type { NoteEntry } from '@/types'
import { getAccessToken, getStoredUser } from '@/services/auth'
import { queryEntryReviewAssistant } from '@/services/reviewInsights'
import { CHAT_INTERRUPTED, loadChatState, saveChatState } from '@/services/chatSnapshots'
import type { createBackgroundTasks } from './useBackgroundTasks'

export interface EntryLearningTurn {
  id: string
  action: 'learn_knowledge' | 'discuss_question'
  userText: string
  requestText?: string
  answer: string
  summaries: string[]
  status: 'streaming' | 'done' | 'error'
  error: string
  snapshotAt?: number
  previous?: { answer: string; error: string; savedAt: number }
}
interface Conversation {
  sessionId: string
  draft: string
  context: string
  contextChanged: boolean
  turns: EntryLearningTurn[]
}
function validConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false
  const row = value as Conversation
  return (
    typeof row.sessionId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(row.sessionId) &&
    typeof row.draft === 'string' &&
    typeof row.context === 'string' &&
    typeof row.contextChanged === 'boolean' &&
    Array.isArray(row.turns) &&
    row.turns.every(
      (turn) =>
        turn &&
        typeof turn.id === 'string' &&
        ['learn_knowledge', 'discuss_question'].includes(turn.action) &&
        typeof turn.userText === 'string' &&
        (turn.requestText === undefined ||
          (typeof turn.requestText === 'string' && turn.requestText.length <= 2000)) &&
        typeof turn.answer === 'string' &&
        typeof turn.error === 'string' &&
        ['streaming', 'done', 'error'].includes(turn.status) &&
        Array.isArray(turn.summaries) &&
        turn.summaries.every((text) => typeof text === 'string'),
    )
  )
}
const entryKey = (entry: NoteEntry) => JSON.stringify([entry.notebookId, entry.id])
function contextText(entry: NoteEntry) {
  return JSON.stringify([
    entry.question,
    entry.correctAnswer,
    entry.wrongAnswer,
    entry.tags,
    entry.groupId,
    entry.subject,
  ])
}
function fingerprint(text: string) {
  let a = 2166136261,
    b = 5381
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619)
    b = Math.imul(b, 33) ^ text.charCodeAt(i)
  }
  return `v2:${text.length}:${a >>> 0}:${b >>> 0}`
}

export const entryLearningConversationsKey: InjectionKey<
  ReturnType<typeof createEntryLearningConversations>
> = Symbol('entryLearningConversations')

export function createEntryLearningConversations(
  tasks: ReturnType<typeof createBackgroundTasks> | null = null,
  onOpen: (notebookId: string, entryId: string) => void | Promise<void> = () => {},
) {
  const owner = getAccessToken() ? getStoredUser()?.id : undefined
  const storageKey = owner ? `entry-learning-chats-v1:${owner}` : null
  const conversations = ref<Record<string, Conversation>>({})
  const storageError = ref('')
  const running = ref<string[]>([])
  const requests = new Map<string, { controller: AbortController; turn: EntryLearningTurn }>()
  if (storageKey) {
    try {
      const saved = loadChatState<Record<string, Conversation>>(
        storageKey,
        (value): value is Record<string, Conversation> =>
          !!value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.values(value).every(validConversation),
      )
      if (saved) conversations.value = saved
      for (const conversation of Object.values(conversations.value))
        for (const turn of conversation.turns) {
          if (turn.status === 'streaming') {
            turn.status = 'error'
            turn.error = CHAT_INTERRUPTED
            turn.snapshotAt = Date.now()
          }
        }
    } catch {
      storageError.value = '保存的学习对话暂时无法读取，新对话仍可使用。'
    }
  }
  function persist(checkpoint = false, interrupted = false) {
    if (!storageKey) return
    try {
      if (interrupted) {
        const saved = JSON.parse(JSON.stringify(conversations.value)) as Record<
          string,
          Conversation
        >
        for (const conversation of Object.values(saved))
          for (const turn of conversation.turns)
            if (turn.status === 'streaming') {
              turn.status = 'error'
              turn.error = CHAT_INTERRUPTED
              turn.snapshotAt = Date.now()
            }
        saveChatState(storageKey, saved, true)
      } else saveChatState(storageKey, conversations.value, checkpoint)
      storageError.value = ''
    } catch {
      storageError.value = '学习对话未能保存到此浏览器，请勿关闭页面。'
    }
  }
  watch(conversations, () => persist(), { deep: true, flush: 'sync' })
  function stop(key: string, error = '回复已停止，可重试。') {
    const request = requests.get(key)
    if (!request) return
    request.turn.status = 'error'
    request.turn.error = error
    request.turn.snapshotAt = Date.now()
    request.controller.abort()
    persist(true)
  }
  function ensure(entry: NoteEntry) {
    const key = entryKey(entry),
      text = contextText(entry),
      context = fingerprint(text)
    let conversation = conversations.value[key]
    if (!conversation) {
      conversations.value[key] = {
        sessionId: crypto.randomUUID(),
        draft: '',
        context,
        contextChanged: false,
        turns: [],
      }
      conversation = conversations.value[key]!
    } else if (conversation.context === text) {
      conversation.context = context
    } else if (conversation.context !== context) {
      stop(key, '题目内容已变化，已保存回复快照，请保存后重新提问。')
      conversation.context = context
      conversation.sessionId = crypto.randomUUID()
      conversation.contextChanged = conversation.turns.length > 0
    }
    return conversation
  }
  async function run(entry: NoteEntry, conversation: Conversation, turn: EntryLearningTurn) {
    const key = entryKey(entry)
    if (requests.has(key)) return
    if (turn.status === 'error' && (turn.answer || turn.error)) {
      turn.previous = {
        answer: turn.answer || turn.previous?.answer || '',
        error: turn.error,
        savedAt: Date.now(),
      }
      persist(true)
    }
    turn.answer = ''
    turn.summaries = []
    turn.error = ''
    turn.status = 'streaming'
    const controller = new AbortController()
    const request = { controller, turn },
      session = conversation.sessionId
    requests.set(key, request)
    running.value.push(key)
    persist(true)
    const current = () =>
      requests.get(key) === request &&
      !controller.signal.aborted &&
      conversation.sessionId === session &&
      conversation.turns.includes(turn)
    const updateTask = () =>
      tasks?.update({
        id: `entry-chat:${key}`,
        title: `${entry.title || '当前题目'} · AI 对话`,
        detail:
          turn.status === 'streaming'
            ? '正在回复，可以切换题目或关闭面板。'
            : turn.status === 'error'
              ? turn.error
              : '回复已完成，点击查看。',
        state:
          turn.status === 'streaming'
            ? 'running'
            : turn.status === 'error'
              ? 'warning'
              : 'completed',
        open: () => onOpen(entry.notebookId, entry.id),
      })
    updateTask()
    try {
      const result = await queryEntryReviewAssistant(
        entry.id,
        turn.action,
        session,
        controller.signal,
        {
          onAnswer: (text) => {
            if (current()) turn.answer = text
          },
          onSummary: (text) => {
            if (current() && turn.summaries.at(-1) !== text) turn.summaries.push(text)
          },
        },
        [],
        turn.action === 'discuss_question' ? (turn.requestText ?? turn.userText) : undefined,
      )
      if (current()) {
        turn.answer = result
        turn.status = 'done'
      }
    } catch (cause) {
      if (conversation.turns.includes(turn)) {
        turn.status = 'error'
        turn.error = controller.signal.aborted
          ? turn.error || '回复已停止，可重试。'
          : cause instanceof Error
            ? cause.message
            : '助手请求失败，请稍后重试。'
        turn.snapshotAt = Date.now()
        persist(true)
      }
    } finally {
      if (requests.get(key) === request) {
        requests.delete(key)
        running.value = running.value.filter((id) => id !== key)
      }
      persist(true)
      updateTask()
    }
  }
  const saveExit = () => persist(true, true)
  const closePage = () => {
    for (const key of requests.keys()) stop(key, CHAT_INTERRUPTED)
    saveExit()
  }
  window.addEventListener('beforeunload', saveExit)
  window.addEventListener('pagehide', closePage)
  onScopeDispose(() => {
    closePage()
    window.removeEventListener('beforeunload', saveExit)
    window.removeEventListener('pagehide', closePage)
  })
  return { ensure, run, stop, running, storageError, persist }
}

export function useEntryLearningConversation(getEntry: () => NoteEntry) {
  const store = inject(entryLearningConversationsKey, null) ?? createEntryLearningConversations()
  watch(
    () => [entryKey(getEntry()), contextText(getEntry())],
    () => store.ensure(getEntry()),
    { immediate: true, flush: 'sync' },
  )
  const current = computed(() => store.ensure(getEntry()))
  const turns = computed(() => current.value.turns)
  const draft = computed({
    get: () => current.value.draft,
    set: (value: string) => {
      current.value.draft = value
    },
  })
  const sessionId = computed(() => current.value.sessionId)
  const contextChanged = computed(() => current.value.contextChanged)
  const sending = computed(() => store.running.value.includes(entryKey(getEntry())))
  function clearConversation() {
    store.stop(entryKey(getEntry()))
    current.value.turns = []
    current.value.draft = ''
    current.value.sessionId = crypto.randomUUID()
    current.value.contextChanged = false
    store.persist(true)
  }
  onScopeDispose(() => store.persist(true))
  return {
    turns,
    draft,
    sessionId,
    contextChanged,
    storageError: store.storageError,
    clearConversation,
    persist: store.persist,
    sending,
    run: (turn: EntryLearningTurn) => store.run(getEntry(), current.value, turn),
    stop: (error?: string) => store.stop(entryKey(getEntry()), error),
  }
}
