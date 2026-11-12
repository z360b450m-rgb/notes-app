import { getAccessToken } from './auth'
import { toDisplayImageUrl } from './imageStorage'

export async function recognizeImageText(
  source: Blob | string,
  notebookId: string,
  signal: AbortSignal,
): Promise<string> {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后识别图片文字')
  let blob: Blob
  if (source instanceof Blob) blob = source
  else {
    const image = await fetch(toDisplayImageUrl(source), { signal })
    if (!image.ok) throw new Error('无法读取图片，请重新选择')
    blob = await image.blob()
  }
  if (blob.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB')
  const data = new FormData()
  data.append('notebook_id', notebookId)
  data.append('file', blob, 'image')
  const response = await fetch('http://localhost:8000/api/image-ocr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
    signal,
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(typeof result.detail === 'string' ? result.detail : '文字识别失败，请重试')
  if (typeof result.text !== 'string' || result.text.length > 200_000)
    throw new Error('文字识别结果无效，请重试')
  return result.text
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
