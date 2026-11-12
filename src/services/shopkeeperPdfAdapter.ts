import { getAccessToken } from './auth'
import type { PdfImportRequest, PdfImportResult } from './pdfImport'
import type { PdfDraft } from './pdfQuestionDraft'

const BASE = 'http://localhost:8000/api/question-imports'

async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后导入 PDF')
  const response = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'PDF 导入请求失败，请重试')
  if (!body || typeof body !== 'object') throw new Error('PDF 导入服务返回格式无效')
  return body
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1200)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function getPdfDraft(jobId: string, signal: AbortSignal): Promise<PdfDraft> {
  const result = await request(`/${encodeURIComponent(jobId)}/draft`, signal)
  if (
    result.id !== jobId ||
    result.draft?.schema_version !== 'pdf-question-draft-v1' ||
    !Array.isArray(result.draft.questions) ||
    !Array.isArray(result.draft.assets)
  )
    throw new Error('PDF 草稿返回格式无效')
  return result as PdfDraft
}

export async function cancelPdfImport(jobId: string): Promise<void> {
  const status = await request(
    `/${encodeURIComponent(jobId)}/cancel`,
    AbortSignal.timeout(15_000),
    { method: 'POST' },
  )
  if (status.status !== 'cancelled') throw new Error('停止解析暂未确认，请重试取消。')
}

export async function importQuestionsFromPdf(input: PdfImportRequest): Promise<PdfImportResult> {
  const form = new FormData()
  form.set('file', input.file)
  form.set('notebook_id', input.notebookId)
  // 先取得任务编号，再处理取消，避免上传响应丢失后后台留下无法取消的任务。
  const initial = await request('', AbortSignal.timeout(120_000), { method: 'POST', body: form })
  if (typeof initial.id !== 'string' || !initial.id.trim()) throw new Error('解析任务编号无效')
  input.onTask?.(initial.id)
  try {
    input.signal.throwIfAborted()
    const deadline = Date.now() + 20 * 60 * 1000
    let status = initial
    while (Date.now() < deadline) {
      input.onProgress(status.message || 'MinerU 正在解析 PDF…')
      if (['failed', 'cancelled', 'cancelling'].includes(status.status))
        throw new Error(status.message || 'PDF 解析已停止')
      if (status.status === 'ready_for_review') {
        const draft = await getPdfDraft(initial.id, input.signal)
        if (draft.notebook_id !== input.notebookId) throw new Error('解析草稿的目标错题本不一致')
        input.onDraft?.(draft)
        return {
          status: 'submitted',
          taskId: initial.id,
          message: '解析完成，请校对并确认录入；题目尚未保存。',
        }
      }
      await pause(input.signal)
      status = await request(`/${encodeURIComponent(initial.id)}`, input.signal)
    }
    throw new Error(`解析仍未完成，任务编号：${initial.id}。请稍后查看或重试。`)
  } catch (error) {
    if (input.signal.aborted) {
      await cancelPdfImport(initial.id)
    }
    throw error
  }
}

export async function savePdfDraft(draft: PdfDraft, signal: AbortSignal): Promise<PdfDraft> {
  const questions = draft.draft.questions.map(
    ({
      key,
      title,
      stem,
      kind,
      options,
      group_key,
      correct_answer,
      explanation,
      student_answer,
    }) => ({
      key,
      title,
      stem,
      kind,
      options,
      group_key,
      correct_answer,
      explanation,
      student_answer,
    }),
  )
  const groups = draft.draft.groups.map(({ key, title, material_text }) => ({
    key,
    title,
    material_text,
  }))
  return (await request(`/${encodeURIComponent(draft.id)}/draft`, signal, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: draft.revision, questions, groups }),
  })) as PdfDraft
}

export async function confirmPdfDraft(
  draft: PdfDraft,
  keys: string[],
  signal: AbortSignal,
): Promise<PdfImportResult> {
  const result = await request(`/${encodeURIComponent(draft.id)}/confirm`, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected_revision: draft.revision,
      question_keys: keys,
      reviewed: true,
    }),
  })
  if (
    result.status !== 'completed' ||
    !Number.isInteger(result.importedCount) ||
    result.importedCount !== keys.length
  )
    throw new Error('录入结果与确认的题目数量不一致')
  return { status: 'completed', importedCount: result.importedCount }
}

export async function getPdfImportStatus(jobId: string, signal: AbortSignal) {
  return request(`/${encodeURIComponent(jobId)}`, signal)
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
