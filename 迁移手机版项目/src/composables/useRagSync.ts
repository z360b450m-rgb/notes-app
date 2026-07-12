// 错题本 → RAG 索引实时同步。
// 失败静默：RAG 服务挂了不能影响错题保存。
import type { NoteEntry } from '../types'

const DEFAULT_BASE_URL = 'http://localhost:8000'

interface RagSyncOptions {
  baseUrl?: string
  timeoutMs?: number
}

function baseUrl(opts?: RagSyncOptions): string {
  return opts?.baseUrl ?? DEFAULT_BASE_URL
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) }
}

async function post(path: string, body: unknown, opts?: RagSyncOptions): Promise<void> {
  const timeout = withTimeout(opts?.timeoutMs ?? 4000)
  try {
    const resp = await fetch(baseUrl(opts) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    })
    if (!resp.ok) {
      console.warn(`[RAG sync] ${path} HTTP ${resp.status}`)
    }
  } catch (e) {
    console.warn(`[RAG sync] ${path} 失败:`, e instanceof Error ? e.message : e)
  } finally {
    timeout.cancel()
  }
}

function toPayload(entry: NoteEntry) {
  return {
    id: entry.id,
    question: entry.question || '',
    correctAnswer: entry.correctAnswer || '',
    wrongAnswer: entry.wrongAnswer || '',
    subject: entry.subject || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    title: entry.title || '',
    source: entry.source || '',
    kbId: entry.kbId || 'notes',
  }
}

export function useRagSync(opts?: RagSyncOptions) {
  async function upsertEntry(entry: NoteEntry) {
    await post('/entries/upsert', toPayload(entry), opts)
  }

  async function deleteEntry(id: string) {
    await post('/entries/delete', { id }, opts)
  }

  return { upsertEntry, deleteEntry }
}
