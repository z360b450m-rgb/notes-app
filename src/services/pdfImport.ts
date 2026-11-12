/** 接入外部 PDF 导入流程的边界；此模块不解析 PDF，也不写入题目。 */
import type { PdfDraft } from './pdfQuestionDraft'

export interface PdfImportRequest {
  file: File
  notebookId: string
  signal: AbortSignal
  onProgress: (message: string) => void
  onDraft?: (draft: PdfDraft) => void
  onTask?: (jobId: string) => void
}

/** submitted 仅表示任务已提交；completed 必须表示确认后的题目已保存。 */
export type PdfImportResult =
  | { status: 'submitted'; taskId: string; message?: string }
  | { status: 'completed'; importedCount: number }

export type PdfImportHandler = (request: PdfImportRequest) => Promise<PdfImportResult>

let handler: PdfImportHandler | undefined

/** 在启动阶段注册实际的服务适配器；返回函数用于解除本次注册。 */
export function registerPdfImportHandler(importer: PdfImportHandler): () => void {
  handler = importer
  return () => {
    if (handler === importer) handler = undefined
  }
}

export async function importPdf(request: PdfImportRequest): Promise<PdfImportResult> {
  if (!request.notebookId.trim()) throw new Error('请先选择目标错题本')
  if (!/\.pdf$/i.test(request.file.name)) throw new Error('请选择 PDF 文件')
  if (!request.file.size) throw new Error('PDF 文件为空')
  if (request.file.size > 100 * 1024 * 1024) throw new Error('PDF 不能超过 100 MB')
  request.signal.throwIfAborted()
  if (!handler) throw new Error('PDF 导入服务暂不可用，请稍后重试')
  const result = await handler(request)
  request.signal.throwIfAborted()
  if (
    !result ||
    (result.status === 'submitted'
      ? typeof result.taskId !== 'string' || !result.taskId.trim()
      : result.status !== 'completed' ||
        !Number.isInteger(result.importedCount) ||
        result.importedCount < 0)
  )
    throw new Error('PDF 导入服务返回了无效结果，请重试')
  return result
}
