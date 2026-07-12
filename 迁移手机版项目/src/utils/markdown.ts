import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function renderSafeMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown) as string
  return DOMPurify.sanitize(rawHtml)
}
