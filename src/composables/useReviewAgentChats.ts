import { computed, inject, onScopeDispose, ref, watch, type InjectionKey } from 'vue'
import { getStoredUser } from '@/services/auth'
import { CHAT_INTERRUPTED, loadChatState, saveChatState } from '@/services/chatSnapshots'
import type { createBackgroundTasks } from './useBackgroundTasks'
import {
  deleteReviewAgentHistory,
  generateReviewAgentTitle,
  queryReviewAgent,
  readClarificationChoices,
  type ClarificationChoice,
} from '@/services/reviewAgent'

interface Message {
  role: 'user' | 'assistant'
  text: string
  knowledgeBases?: { id: string; name: string }[]
  pending?: boolean
  startedAt?: number
  thinkingMs?: number
  failed?: boolean
  summaries?: string[]
  choices?: ClarificationChoice[]
  error?: string
  snapshotAt?: number
  previous?: { text: string; error: string; savedAt: number }
}
interface Chat {
  id: string
  title: string
  updatedAt: number
  messages: Message[]
  titleSource?: 'initial' | 'generated' | 'manual'
}

export const reviewAgentChatsKey: InjectionKey<ReturnType<typeof createReviewAgentChats>> =
  Symbol('reviewAgentChats')

export function useReviewAgentChats() {
  return inject(reviewAgentChatsKey, null) ?? createReviewAgentChats()
}

export function createReviewAgentChats(
  tasks: ReturnType<typeof createBackgroundTasks> | null = null,
  onOpen: () => void = () => {},
) {
  const key = `review-agent-chats-v1:${getStoredUser()?.id ?? 'local'}`
  const chats = ref<Chat[]>([])
  const activeId = ref<string | null>(null)
  const storageError = ref('')
  const pendingIds = ref<string[]>([])
  const sending = computed(() => !!activeId.value && pendingIds.value.includes(activeId.value))
  const deleting = ref(false)
  const requests = new Map<string, AbortController>()
  const drafts = ref<Record<string, string>>({})
  const titleRequests = new Map<string, AbortController>()
  try {
    type Saved = { chats: Chat[]; activeId: string | null; drafts?: Record<string, string> }
    const saved = loadChatState<Saved>(key, (value): value is Saved => {
      const saved = value as Saved | null
      return (
        !!saved &&
        Array.isArray(saved.chats) &&
        saved.chats.every(
          (chat: Chat) =>
            typeof chat.id === 'string' &&
            typeof chat.title === 'string' &&
            Number.isFinite(chat.updatedAt) &&
            Array.isArray(chat.messages) &&
            chat.messages.every(
              (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string',
            ),
        )
      )
    })
    if (saved) {
      chats.value = saved.chats
      if (saved.drafts && Object.values(saved.drafts).every((value) => typeof value === 'string'))
        drafts.value = saved.drafts
      for (const chat of chats.value) {
        // 旧记录中与首条消息不同的标题按手动命名保留。
        if (!['initial', 'generated', 'manual'].includes(chat.titleSource ?? '')) {
          const first = chat.messages.find((m) => m.role === 'user')
          chat.titleSource = first && chat.title === first.text.slice(0, 32) ? 'initial' : 'manual'
        }
        for (const message of chat.messages) {
          message.choices = readClarificationChoices(message.choices)
          if (message.pending) {
            message.pending = false
            message.failed = true
            message.error = CHAT_INTERRUPTED
            message.snapshotAt = Date.now()
          }
        }
      }
      activeId.value = chats.value.some((c) => c.id === saved.activeId) ? saved.activeId : null
    }
  } catch {
    storageError.value = '聊天记录暂时无法读取，新对话仍可使用。'
  }
  const active = computed(() => chats.value.find((c) => c.id === activeId.value))
  const messages = computed(() => active.value?.messages ?? [])
  const draft = computed({
    get: () => drafts.value[activeId.value ?? 'new'] ?? '',
    set: (value: string) => {
      drafts.value[activeId.value ?? 'new'] = value
    },
  })
  const history = computed(() => [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt))
  function persist(checkpoint = false, interrupted = false) {
    try {
      const saved = { chats: chats.value, activeId: activeId.value, drafts: drafts.value }
      if (interrupted) {
        const snapshot = JSON.parse(JSON.stringify(saved)) as typeof saved
        for (const chat of snapshot.chats)
          for (const message of chat.messages)
            if (message.pending) {
              message.pending = false
              message.failed = true
              message.error = CHAT_INTERRUPTED
              message.snapshotAt = Date.now()
            }
        saveChatState(key, snapshot, true)
      } else saveChatState(key, saved, checkpoint)
      storageError.value = ''
    } catch {
      storageError.value = '聊天记录未能保存到此浏览器，请勿关闭页面。'
    }
  }
  watch([chats, activeId, drafts], () => persist(), { deep: true, flush: 'sync' })
  async function updateTitle(chat: Chat) {
    const rounds = chat.messages.filter(
      (m, index) =>
        m.role === 'assistant' &&
        !m.pending &&
        !m.failed &&
        m.text.trim() &&
        chat.messages[index - 1]?.role === 'user',
    ).length
    if (rounds < 3 || chat.titleSource !== 'initial' || titleRequests.has(chat.id)) return
    const titleController = new AbortController()
    const timeout = setTimeout(() => titleController.abort(), 25000)
    titleRequests.set(chat.id, titleController)
    try {
      const title = await generateReviewAgentTitle(chat.id, titleController.signal)
      if (
        !titleController.signal.aborted &&
        chats.value.includes(chat) &&
        chat.titleSource === 'initial'
      ) {
        chat.title = title
        chat.titleSource = 'generated'
        persist()
      }
    } catch {
      // 命名失败保留原标题，下一轮成功回复后再试，不影响聊天。
    } finally {
      clearTimeout(timeout)
      if (titleRequests.get(chat.id) === titleController) titleRequests.delete(chat.id)
    }
  }
  async function request(chat: Chat, text: string, message: Message) {
    if (message.failed && (message.text || message.error)) {
      message.previous = {
        text: message.text || message.previous?.text || '',
        error: message.error ?? '',
        savedAt: Date.now(),
      }
      persist(true)
    }
    pendingIds.value.push(chat.id)
    message.pending = true
    message.startedAt = Date.now()
    message.thinkingMs = undefined
    message.failed = false
    message.error = ''
    message.text = ''
    message.summaries = []
    message.choices = []
    const controller = new AbortController()
    requests.set(chat.id, controller)
    persist(true)
    const updateTask = () =>
      tasks?.update({
        id: `chat:${chat.id}`,
        title: chat.title,
        detail: message.pending
          ? '助手正在回复，可以关闭面板，稍后查看。'
          : message.failed
            ? message.error || '回复中断，已保存快照。'
            : '回复已完成，点击查看。',
        state: message.pending ? 'running' : message.failed ? 'warning' : 'completed',
        open: () => {
          activeId.value = chat.id
          onOpen()
        },
      })
    updateTask()
    try {
      message.text = await queryReviewAgent(
        text,
        chat.id,
        controller.signal,
        {
          onAnswer: (answer) => {
            if (answer && message.thinkingMs === undefined) {
              message.thinkingMs = Math.max(0, Date.now() - message.startedAt!)
            }
            message.text = answer
          },
          onSummary: (summary) => {
            if (message.summaries?.at(-1) !== summary) message.summaries?.push(summary)
          },
          onChoices: (choices) => {
            message.choices = choices
          },
        },
        chat.messages
          .filter((m) => m.role === 'user')
          .at(-1)
          ?.knowledgeBases?.map((x) => x.id) ?? [],
      )
    } catch (cause) {
      message.failed = true
      message.error = controller.signal.aborted
        ? message.error || '回复已中断，请重试。'
        : cause instanceof Error
          ? cause.message
          : '助手请求失败，请稍后重试'
      message.snapshotAt = Date.now()
      persist(true)
    } finally {
      message.thinkingMs ??= Math.max(0, Date.now() - message.startedAt!)
      message.pending = false
      chat.updatedAt = Date.now()
      pendingIds.value = pendingIds.value.filter((id) => id !== chat.id)
      requests.delete(chat.id)
      persist(true)
      updateTask()
      if (!message.failed) void updateTitle(chat)
    }
  }
  async function append(text: string, knowledgeBases: { id: string; name: string }[] = []) {
    if (sending.value || deleting.value) return
    draft.value = ''
    let chat = active.value
    if (!chat) {
      const id = crypto.randomUUID()
      chats.value.push({
        id,
        title: text.slice(0, 32),
        titleSource: 'initial',
        updatedAt: Date.now(),
        messages: [],
      })
      activeId.value = id
      chat = active.value!
    }
    chat.messages.push(
      { role: 'user', text, knowledgeBases },
      {
        role: 'assistant',
        text: '',
        pending: true,
      },
    )
    chat.updatedAt = Date.now()
    await request(chat, text, chat.messages[chat.messages.length - 1])
  }
  async function retry() {
    const chat = active.value
    const answer = chat?.messages.at(-1)
    const question = chat?.messages.at(-2)
    if (sending.value || deleting.value || !chat || !answer?.failed || question?.role !== 'user')
      return
    await request(chat, question.text, answer)
  }
  function renameChat(id: string, title: string) {
    const chat = chats.value.find((item) => item.id === id)
    const name = title.trim()
    if (requests.has(id) || deleting.value || !chat || !name || name.length > 80) return false
    chat.title = name
    chat.titleSource = 'manual'
    titleRequests.get(id)?.abort()
    return true
  }
  async function deleteChat(id: string) {
    if (requests.has(id) || deleting.value || !chats.value.some((chat) => chat.id === id))
      return false
    deleting.value = true
    titleRequests.get(id)?.abort()
    try {
      await deleteReviewAgentHistory(id)
      if (activeId.value === id) activeId.value = null
      chats.value = chats.value.filter((chat) => chat.id !== id)
      delete drafts.value[id]
      persist(true)
      return true
    } finally {
      deleting.value = false
    }
  }
  const saveExit = () => persist(true, true)
  const closePage = () => {
    for (const chat of chats.value)
      for (const message of chat.messages)
        if (message.pending) {
          message.error = CHAT_INTERRUPTED
          message.snapshotAt = Date.now()
        }
    saveExit()
    for (const request of requests.values()) request.abort()
  }
  window.addEventListener('beforeunload', saveExit)
  window.addEventListener('pagehide', closePage)
  onScopeDispose(() => {
    closePage()
    window.removeEventListener('beforeunload', saveExit)
    window.removeEventListener('pagehide', closePage)
    for (const request of titleRequests.values()) request.abort()
  })
  return {
    messages,
    draft,
    history,
    activeId,
    storageError,
    sending,
    deleting,
    append,
    retry,
    renameChat,
    deleteChat,
  }
}
