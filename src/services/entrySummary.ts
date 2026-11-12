import type { NoteEntry, QuestionGroup } from '@/types'

export function entrySummary(entry: NoteEntry): NoteEntry {
  const metadata = Object.fromEntries(
    Object.entries(entry).filter(
      ([field]) =>
        ![
          'question',
          'wrongAnswer',
          'correctAnswer',
          'drawings',
          'drawing',
          'questionPreview',
        ].includes(field),
    ),
  ) as NoteEntry
  // Keep only a small plain-text preview; embedded image data never belongs in a list.
  const questionPreview = (entry.questionPreview ?? entry.question ?? '')
    .slice(0, 500)
    .replace(/<[^>]*>?/g, '')
    .replace(/!\[.*?\]\([^)]*\)/g, '[图片]')
    .slice(0, 100)
  return {
    ...metadata,
    question: '',
    wrongAnswer: '',
    correctAnswer: '',
    questionPreview,
    isSummary: true,
  }
}

export function groupSummary(group: QuestionGroup): QuestionGroup {
  const metadata = Object.fromEntries(
    Object.entries(group).filter(([field]) => !['material', 'drawings'].includes(field)),
  ) as QuestionGroup
  return { ...metadata, material: '', isSummary: true }
}

export function assertLoaded(value: { isSummary?: boolean }): void {
  if (value.isSummary) throw new Error('题目内容尚未加载，不能保存概要')
}

export class IncompleteSearchError extends Error {
  constructor(readonly matches: string[]) {
    super('当前只能搜索已缓存的题目，请恢复连接后搜索全部内容')
  }
}

export function matchesEntry(entry: NoteEntry, query: string, material = ''): boolean {
  const term = query.trim().toLowerCase()
  return [
    entry.title,
    entry.question,
    entry.wrongAnswer,
    entry.correctAnswer,
    entry.subject,
    entry.source,
    ...(entry.tags || []),
    material,
  ].some((text) => (text || '').toLowerCase().includes(term))
}
