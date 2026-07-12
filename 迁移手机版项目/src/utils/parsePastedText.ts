import type { NoteEntry } from '@/types'

export function parsePastedText(rawText: string, notebookId: string): Partial<NoteEntry>[] {
  const entries: Partial<NoteEntry>[] = []

  const questionRegex = /(?:^|\n)(?=\s*(?:\d+[、.)）]|\(\d+\)|【\d+】|第\d+题))/g
  const blocks = rawText.split(questionRegex).filter((b) => b.trim().length > 0)

  for (const block of blocks) {
    let questionText: string
    let answerText = ''

    const answerMatch = block.match(/(?:^|\n)\s*(?:【?(?:答案|解析)】?[:：\s])/)

    if (answerMatch && answerMatch.index !== undefined) {
      questionText = block.substring(0, answerMatch.index).trim()
      answerText = block.substring(answerMatch.index).trim()
      answerText = answerText.replace(/^(?:【?(?:答案|解析)】?[:：\s]*)/, '')
    } else {
      questionText = block.trim()
    }

    // 必须以题号开头才算有效题目
    const startsWithNumber = /^\s*(?:\d+[、.)）]|\(\d+\)|【\d+】|第\d+题)/
    if (questionText && startsWithNumber.test(questionText)) {
      entries.push({
        notebookId,
        question: questionText,
        correctAnswer: answerText,
        wrongAnswer: '',
        subject: '未分类',
        source: '批量导入',
        tags: [],
      })
    }
  }

  return entries
}
