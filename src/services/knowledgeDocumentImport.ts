import { API_BASE, fetchApi } from './apiConfig'
import { getAccessToken } from './auth'
import type { KnowledgeLibrary } from '@/composables/useKnowledgeLibraries'

export async function libraryRequest(path = '', init: RequestInit = {}, signal?: AbortSignal) {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后使用知识库')
  const response = await fetchApi(`${API_BASE}/knowledge/documents${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof payload?.detail === 'string' ? payload.detail : '知识库请求失败，请稍后重试',
    )
  return payload
}

export async function importKnowledgeFile(
  file: File,
  signal: AbortSignal,
  onReserved?: (id: string) => void,
): Promise<KnowledgeLibrary> {
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  if (extension !== 'md' && extension !== 'pdf') throw new Error('仅支持 .md 或 .pdf 文件')
  if (!file.size) throw new Error('文件内容为空')
  if (file.size > (extension === 'pdf' ? 100 : 5) * 1024 * 1024)
    throw new Error(extension === 'pdf' ? 'PDF 不能超过 100 MB' : 'Markdown 请小于 5 MB')
  const form = new FormData()
  form.set('file', file)
  // Obtain the task ID before upload so cancellation cannot lose a server task.
  const reserved = await libraryRequest(
    '/import/reserve',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name.replace(/\.(md|pdf)$/i, ''), description: '' }),
    },
    signal,
  )
  onReserved?.(reserved.id)
  return libraryRequest(`/${reserved.id}/import`, { method: 'POST', body: form }, signal)
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
