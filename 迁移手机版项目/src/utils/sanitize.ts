import DOMPurify from 'dompurify'

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}

// Insert line breaks before A/B/C/D multiple-choice option markers.
// Two forms are handled:
//   1) Letter + punctuation:  A.  B、  C)  D）
//   2) Letter + whitespace + CJK character:  A 匮乏  B 滞后
// All paren/wide-paren/CJK characters use escapes so the regex literal is unambiguous.
const RE_MC_OPTIONS = /(?<=^|\S)\s*([A-D])([.、\x29）]\s*|\s+(?=[一-鿿]))/gm

export function formatMcOptions(html: string): string {
  return html.replace(RE_MC_OPTIONS, '<br>$1$2')
}
