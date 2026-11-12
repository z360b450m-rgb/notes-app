import { getAccessToken } from './auth'

export interface ClarificationChoice {
  id: string
  label: string
  text: string
}

export function readClarificationChoices(value: unknown): ClarificationChoice[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (row): row is ClarificationChoice =>
        row &&
        typeof row.id === 'string' &&
        typeof row.label === 'string' &&
        row.label.trim() &&
        row.label.length <= 80 &&
        typeof row.text === 'string' &&
        row.text.trim() &&
        row.text.length <= 2000,
    )
    .slice(0, 4)
    .map(({ id, label, text }) => ({ id, label, text }))
}

export interface ReviewAgentCallbacks {
  onAnswer?: (text: string) => void
  onSummary?: (text: string) => void
  onChoices?: (choices: ClarificationChoice[]) => void
}

export async function generateReviewAgentTitle(
  sessionId: string,
  signal: AbortSignal,
): Promise<string> {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录')
  const response = await fetch(
    `http://localhost:8000/api/review-agent/history/${encodeURIComponent(sessionId)}/title`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal },
  )
  const payload = await response.json().catch(() => null)
  if (
    !response.ok ||
    typeof payload?.title !== 'string' ||
    !payload.title.trim() ||
    payload.title.length > 32 ||
    /[\r\n]/.test(payload.title)
  )
    throw new Error('暂时无法生成标题')
  return payload.title.trim()
}

export async function deleteReviewAgentHistory(sessionId: string): Promise<void> {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后删除聊天记录')
  const response = await fetch(
    `http://localhost:8000/api/review-agent/history/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      typeof payload?.detail === 'string'
        ? payload.detail
        : '聊天记录删除失败，记录已保留，请稍后重试',
    )
  }
  if (!Number.isInteger(payload?.deleted_count) || payload.deleted_count < 0) {
    throw new Error('未能确认智能体历史已删除，记录已保留，请重试')
  }
}

export async function readReviewAgentStream(
  response: Response,
  callbacks: ReviewAgentCallbacks = {},
): Promise<string> {
  if (!response.body) throw new Error('助手未返回流式内容，请重试')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let finished = false

  function handleEvent(block: string) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    const payload = JSON.parse(data.join('\n'))
    if (event === 'error') throw new Error(payload.error || '助手连接中断，请重试')
    if (event === 'summary' && typeof payload.text === 'string') {
      callbacks.onSummary?.(payload.text)
    } else if (event === 'delta' && typeof payload.delta === 'string') {
      answer += payload.delta
      callbacks.onAnswer?.(answer)
    } else if (event === 'final' || event === 'final_answer') {
      if (typeof payload.answer === 'string' && payload.answer.trim()) answer = payload.answer
      if (!answer.trim()) throw new Error('助手没有返回有效回复，请重试')
      callbacks.onAnswer?.(answer)
      callbacks.onChoices?.(readClarificationChoices(payload.clarification_choices))
      finished = true
    }
  }

  try {
    while (!finished) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary = buffer.match(/\r?\n\r?\n/)
      while (boundary && !finished) {
        const index = boundary.index!
        handleEvent(buffer.slice(0, index))
        buffer = buffer.slice(index + boundary[0].length)
        boundary = buffer.match(/\r?\n\r?\n/)
      }
      if (done) {
        if (!finished && buffer.trim()) handleEvent(buffer)
        if (!finished) throw new Error('回复未完成，连接已中断，请重试')
        break
      }
    }
    return answer
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function queryReviewAgent(
  query: string,
  sessionId: string,
  signal: AbortSignal,
  callbacks: ReviewAgentCallbacks = {},
  kbIds: string[] = [],
): Promise<string> {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后使用复习助手')
  const response = await fetch('http://localhost:8000/api/review-agent/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query,
      session_id: sessionId,
      is_stream: true,
      kb_ids: kbIds,
    }),
    signal,
  })
  return readReviewAgentResponse(response, callbacks)
}

export async function readReviewAgentResponse(
  response: Response,
  callbacks: ReviewAgentCallbacks = {},
  invalidRequestMessage = '问题格式无效，请重新输入（最多 2000 字）',
): Promise<string> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    throw new Error(
      typeof detail === 'string'
        ? detail
        : response.status === 422
          ? invalidRequestMessage
          : '助手请求失败，请稍后重试',
    )
  }
  if (response.headers.get('content-type')?.includes('text/event-stream'))
    return readReviewAgentStream(response, callbacks)
  // 兼容尚未重启的旧后端
  const payload = await response.json().catch(() => null)
  if (typeof payload?.answer !== 'string' || !payload.answer.trim())
    throw new Error('助手没有返回有效回复，请重试')
  callbacks.onAnswer?.(payload.answer)
  callbacks.onChoices?.(readClarificationChoices(payload.clarification_choices))
  return payload.answer
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
