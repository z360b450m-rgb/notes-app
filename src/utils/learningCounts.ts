import type { NoteEntry, ReviewLog } from '@/types'

// Counts describe completed reviews and explicit answers, independently of SRS ratings.
export function learningCounts(entry: NoteEntry, logs: ReviewLog[]) {
  const recorded = logs.filter((log) => log.entryId === entry.id && log.timestamp <= Date.now())
  return {
    reviewCount: Math.max(entry.reviewCount ?? 0, recorded.length),
    wrongCount: Math.max(
      entry.wrongCount ?? 0,
      recorded.filter((log) => log.isCorrect === false).length,
    ),
  }
}
