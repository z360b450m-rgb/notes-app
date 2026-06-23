import type { NoteEntry } from '@/types'
import { parsePastedText } from './parsePastedText'

// ===================================================================
// 精准顺序扫描解析器 — 按题号递增匹配
// ===================================================================

interface ParseOptions {
  mode: 'sequential' | 'default'
  startNum?: number
  endNum?: number
}

function defaultParse(text: string) {
  const questions: Array<{ title: string; content: string; order: number }> = []
  const questionRegex = /(?:^|\n)(?=\s*(?:\d+[、.)）]|\(\d+\)|【\d+】|第\d+题))/g
  const blocks = text.split(questionRegex).filter((b) => b.trim().length > 0)
  let order = 1
  for (const block of blocks) {
    const startsWithNumber = /^\s*(?:\d+[、.)）]|\(\d+\)|【\d+】|第\d+题)/
    if (startsWithNumber.test(block)) {
      questions.push({
        title: `第 ${order} 题`,
        content: block.trim(),
        order,
      })
      order++
    }
  }
  return questions
}

export function parsePdfWithRange(text: string, options: ParseOptions) {
  if (options.mode === 'sequential') {
    const questions: Array<{ title: string; content: string; order: number }> = []
    let currentNum = options.startNum || 1
    const maxNum = options.endNum || 120

    while (currentNum <= maxNum) {
      const currentRegex = new RegExp(`(?:^|[\\r\\n])${currentNum}([\\.、\\s])`)
      const nextRegex = new RegExp(`(?:^|[\\r\\n])${currentNum + 1}([\\.、\\s])`)

      const startIndex = text.search(currentRegex)
      const nextIndex = text.search(nextRegex)

      if (startIndex !== -1) {
        const questionText =
          nextIndex !== -1
            ? text.substring(startIndex, nextIndex).trim()
            : text.substring(startIndex).trim()

        questions.push({
          title: `第 ${currentNum} 题`,
          content: questionText,
          order: currentNum,
        })
      }
      currentNum++
    }
    return questions
  }

  return defaultParse(text)
}

// ===================================================================
// 原有 PDF 解析管线（pdfjs-dist → 文本重构 → parsePastedText）
// ===================================================================

let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function ensurePdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib

  const lib = await import('pdfjs-dist')
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = workerUrl.default
  pdfjsLib = lib
  return lib
}

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

function reconstructText(textItems: TextItem[]): string {
  const LINE_TOLERANCE = 5

  // Group items by Y coordinate (row)
  const rows: { y: number; items: TextItem[] }[] = []
  for (const item of textItems) {
    const y = item.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) < LINE_TOLERANCE)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }

  // Sort rows top-to-bottom (higher Y = higher on page in PDF coords)
  rows.sort((a, b) => b.y - a.y)

  const lines: string[] = []
  for (const row of rows) {
    // Sort items left-to-right within each row
    row.items.sort((a, b) => a.transform[4] - b.transform[4])

    let line = ''
    for (const item of row.items) {
      const prevItem = row.items[row.items.indexOf(item) - 1]
      if (prevItem) {
        const prevEnd = prevItem.transform[4] + prevItem.width
        const gap = item.transform[4] - prevEnd
        // Insert space if gap is positive, otherwise concatenate directly
        line += gap > 2 ? ' ' : ''
      }
      line += item.str
    }
    if (line.trim()) {
      lines.push(line.trim())
    }
  }

  return lines.join('\n')
}

export interface PdfParseProgress {
  current: number
  total: number
}

export interface GarbledSpan {
  text: string
  index: number
  context: string
}

// Unicode allowlist ranges for garbled text detection
const ALLOWED_RANGES: [number, number][] = [
  [0x09, 0x0d], // tab, newline, CR
  [0x20, 0x7e], // ASCII printable
  [0xa0, 0xff], // Latin-1 supplement
  [0x100, 0x24f], // Latin Extended-A/B (pinyin)
  [0x2000, 0x206f], // General punctuation
  [0x2018, 0x201d], // Smart quotes
  [0x2070, 0x209f], // Superscripts/subscripts
  [0x2100, 0x214f], // Letterlike symbols (℅, ℃, etc.)
  [0x2150, 0x218f], // Number forms (⅓, Ⅱ, etc.)
  [0x2190, 0x21ff], // Arrows (→, ←, etc.)
  [0x2200, 0x22ff], // Math operators (≥, ≤, ≠, ∞, etc.)
  [0x2300, 0x23ff], // Misc technical (⌂, etc.)
  [0x2460, 0x24ff], // Enclosed alphanumerics (①, Ⓐ, etc.)
  [0x2500, 0x257f], // Box drawing (─, │, etc.)
  [0x25a0, 0x25ff], // Geometric shapes (■, ▲, ●, etc.)
  [0x2600, 0x26ff], // Misc symbols
  [0x2700, 0x27bf], // Dingbats
  [0x3000, 0x303f], // CJK symbols & punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe1f], // Vertical forms
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xffef], // Fullwidth forms
]

function isAllowedChar(code: number): boolean {
  for (const [lo, hi] of ALLOWED_RANGES) {
    if (code >= lo && code <= hi) return true
  }
  return false
}

export function detectGarbledText(text: string): GarbledSpan[] {
  if (!text) return []
  const spans: GarbledSpan[] = []
  let current = ''
  let startIdx = -1

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (!isAllowedChar(code)) {
      if (current === '') startIdx = i
      current += text[i]
    } else {
      if (current.length > 0) {
        spans.push({
          text: current,
          index: startIdx,
          context: text.slice(Math.max(0, startIdx - 10), Math.min(text.length, i + 11)),
        })
        current = ''
        startIdx = -1
      }
    }
  }
  // Trailing garbled
  if (current.length > 0) {
    spans.push({
      text: current,
      index: startIdx,
      context: text.slice(Math.max(0, startIdx - 10), Math.min(text.length, text.length)),
    })
  }
  return spans
}

// 页眉页脚噪声 — 按行匹配后整行去除
const NOISE_PATTERNS = [
  /^\d{4}年.*公(务|務)员.*考试《.*》题.*回忆版.*$/,
  /^· 本试卷由.*生成.*第 \d+ 页.*$/,
  /^‣ 本试卷由.*生成.*第 \d+ 页.*$/,
  /^第 \d+ 页，共 \d+ 页$/,
]

function stripPageNoise(text: string): string {
  const lines = text.split('\n')
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(trimmed)) return false
    }
    return true
  })
  return cleaned.join('\n')
}

export async function parsePdfFile(
  file: File,
  notebookId: string,
  onProgress?: (progress: PdfParseProgress) => void,
): Promise<Partial<NoteEntry>[]> {
  const pdfjs = await ensurePdfJs()

  const arrayBuf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: arrayBuf }).promise
  const total = doc.numPages

  let totalItems = 0
  const pageTexts: string[] = []

  for (let i = 1; i <= total; i++) {
    onProgress?.({ current: i, total })
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageItems: TextItem[] = []
    for (const item of content.items) {
      if ('str' in item) {
        pageItems.push({
          str: item.str,
          transform: item.transform as number[],
          width: item.width,
          height: item.height,
        })
      }
    }
    totalItems += pageItems.length
    const pageText = reconstructText(pageItems)
    pageTexts.push(stripPageNoise(pageText))
  }

  if (totalItems === 0) {
    throw new Error('此 PDF 无可提取的文本（可能是扫描件图片），请使用 OCR 工具先识别文字。')
  }

  const fullText = pageTexts.join('\n')
  return parsePastedText(fullText, notebookId)
}
