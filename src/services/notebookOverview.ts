import type { NoteEntry, ReviewLog } from '@/types'

export interface NotebookCounts {
  notebookId: string
  entryCount: number
  dueCount: number
  reviewedToday: number
}

export interface NotebookOverview {
  items: NotebookCounts[]
  subjects: { name: string; count: number }[]
  reviewDays: { timestamp: number; count: number }[]
  stale?: boolean
}

export interface LocalNotebookOverview {
  overview: NotebookOverview
  entries: Pick<NoteEntry, 'id' | 'notebookId' | 'subject' | 'nextReviewDate' | 'updatedAt'>[]
  reviews: Pick<ReviewLog, 'id' | 'entryId' | 'timestamp'>[]
}

/** Local fallback: scan metadata and logs once, without loading question bodies. */
export function aggregateNotebookOverview(
  notebookIds: string[],
  entries: Pick<NoteEntry, 'id' | 'notebookId' | 'nextReviewDate' | 'subject'>[],
  logs: Pick<ReviewLog, 'entryId' | 'timestamp'>[],
  now = Date.now(),
): NotebookOverview {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const reviewDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - 6 + index)
    return { timestamp: date.getTime(), count: 0 }
  })
  const items = new Map(
    notebookIds.map((notebookId) => [
      notebookId,
      {
        notebookId,
        entryCount: 0,
        dueCount: 0,
        reviewedToday: 0,
      },
    ]),
  )
  const owners = new Map<string, string>()
  const subjects = new Map<string, number>()
  for (const entry of entries) {
    const item = items.get(entry.notebookId)
    if (!item) continue
    owners.set(entry.id, entry.notebookId)
    item.entryCount++
    if (entry.nextReviewDate && entry.nextReviewDate > 0 && entry.nextReviewDate <= now)
      item.dueCount++
    const subject = entry.subject || '未分类'
    subjects.set(subject, (subjects.get(subject) || 0) + 1)
  }
  for (const log of logs) {
    const notebookId = owners.get(log.entryId)
    if (!notebookId || log.timestamp > now) continue
    if (log.timestamp >= today.getTime()) items.get(notebookId)!.reviewedToday++
    const day = reviewDays.findIndex(
      (day, index) =>
        log.timestamp >= day.timestamp &&
        (index === 6 || log.timestamp < reviewDays[index + 1].timestamp),
    )
    if (day >= 0) reviewDays[day].count++
  }
  return {
    items: [...items.values()],
    subjects: [...subjects]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    reviewDays,
  }
}
