/** A synchronous checkpoint at send, error, retry and page exit. */
export function saveChatState(key: string, value: unknown, checkpoint = false) {
  const encoded = JSON.stringify(value)
  localStorage.setItem(key, encoded)
  if (checkpoint) localStorage.setItem(`${key}:snapshot`, encoded)
}

export function loadChatState<T>(
  key: string,
  validate: (value: unknown) => value is T,
): T | undefined {
  let invalid = false
  for (const candidate of [key, `${key}:snapshot`]) {
    try {
      const raw = localStorage.getItem(candidate)
      if (!raw) continue
      const value: unknown = JSON.parse(raw)
      if (!validate(value)) throw new Error('Invalid chat snapshot')
      return value
    } catch {
      invalid = true
    }
  }
  if (invalid) throw new Error('Chat history could not be recovered')
}

export const CHAT_INTERRUPTED = '页面已关闭或刷新，上次回复未完成，可重试。'
