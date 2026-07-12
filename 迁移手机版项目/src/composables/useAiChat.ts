import { ref, computed } from 'vue'

const DEFAULT_BASE_URL = 'http://localhost:8000'

export interface AiChatSource {
  text: string
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  confidence?: number
  streaming?: boolean
  nodes?: string[]
}

interface FinalPayload {
  answer: string
  sources: string[]
  confidence_score: number
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function useAiChat(options?: { baseUrl?: string; threadId?: string }) {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL
  const threadId = ref(options?.threadId ?? `notes-${uid()}`)

  const messages = ref<AiChatMessage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasMessages = computed(() => messages.value.length > 0)

  function reset() {
    messages.value = []
    error.value = null
    threadId.value = `notes-${uid()}`
  }

  async function send(
    question: string,
    entry?: Record<string, unknown> | null,
    skillPrompt?: string | null,
    kbId?: string | null,
  ) {
    const q = question.trim()
    if (!q || loading.value) return

    const userMsg: AiChatMessage = { id: uid(), role: 'user', content: q }
    const botSeed: AiChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      streaming: true,
      nodes: [],
    }
    messages.value.push(userMsg, botSeed)
    // 取代理对象引用（push 进数组后才有响应式包装）
    const botMsg = messages.value[messages.value.length - 1]
    loading.value = true
    error.value = null

    const useEntryMode = !!entry && typeof entry.id === 'string'
    const url = useEntryMode ? `${baseUrl}/chat/entry` : `${baseUrl}/chat/stream`
    const body: Record<string, unknown> = useEntryMode
      ? { question: q, entry, thread_id: threadId.value }
      : { question: q, thread_id: threadId.value }
    if (skillPrompt && useEntryMode) {
      body.skill_prompt = skillPrompt
    }
    if (kbId && !useEntryMode) {
      body.kb_id = kbId
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      const findSep = (s: string): { idx: number; len: number } => {
        const a = s.indexOf('\r\n\r\n')
        const b = s.indexOf('\n\n')
        if (a === -1 && b === -1) return { idx: -1, len: 0 }
        if (a === -1) return { idx: b, len: 2 }
        if (b === -1) return { idx: a, len: 4 }
        return a < b ? { idx: a, len: 4 } : { idx: b, len: 2 }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        while (true) {
          const { idx, len } = findSep(buffer)
          if (idx === -1) break
          const rawEvent = buffer.slice(0, idx)
          buffer = buffer.slice(idx + len)
          handleSseEvent(rawEvent, botMsg)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      botMsg.content = botMsg.content || `[出错] ${msg}`
    } finally {
      botMsg.streaming = false
      loading.value = false
    }
  }

  function handleSseEvent(raw: string, target: AiChatMessage) {
    let evtType = 'message'
    const dataLines: string[] = []
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine
      if (line.startsWith('event:')) evtType = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    const data = dataLines.join('\n')
    if (!data) return

    if (evtType === 'node') {
      try {
        const payload = JSON.parse(data) as { node: string }
        if (payload.node && !target.nodes!.includes(payload.node)) {
          target.nodes!.push(payload.node)
        }
      } catch {
        // ignore
      }
    } else if (evtType === 'final') {
      try {
        const payload = JSON.parse(data) as FinalPayload
        target.content = payload.answer ?? ''
        target.sources = payload.sources ?? []
        target.confidence = payload.confidence_score
      } catch {
        target.content = data
      }
    } else if (evtType === 'error') {
      try {
        const payload = JSON.parse(data) as { message: string }
        error.value = payload.message
        target.content = `[出错] ${payload.message}`
      } catch {
        target.content = `[出错] ${data}`
      }
    }
  }

  return {
    messages,
    loading,
    error,
    hasMessages,
    threadId,
    send,
    reset,
  }
}
