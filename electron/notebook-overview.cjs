// Aggregate inside the main process; only numbers cross IPC to the home screen.
function notebookOverview(notebookIds, readSummary, now = Date.now(), includeLocalState = false) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const reviewDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today)
    day.setDate(day.getDate() - 6 + index)
    return { timestamp: day.getTime(), count: 0 }
  })
  const subjects = new Map()
  const entries = []
  const reviews = []
  const items = notebookIds.map((notebookId) => {
    const summary = readSummary(notebookId)
    if (includeLocalState) {
      entries.push(
        ...summary.entries.map(({ id, notebookId, subject, nextReviewDate, updatedAt }) => ({
          id,
          notebookId,
          subject,
          nextReviewDate,
          updatedAt,
        })),
      )
      reviews.push(...summary.recentReviews)
    }
    let dueCount = 0
    let reviewedToday = 0
    for (const entry of summary.entries) {
      if (entry.nextReviewDate > 0 && entry.nextReviewDate <= now) dueCount++
      const name = entry.subject || '未分类'
      subjects.set(name, (subjects.get(name) || 0) + 1)
    }
    for (const [timestamp, count] of summary.reviewEvents) {
      if (timestamp > now) continue
      if (timestamp >= today.getTime()) reviewedToday += count
      const day = reviewDays.findIndex(
        (day, index) =>
          timestamp >= day.timestamp &&
          (index === 6 || timestamp < reviewDays[index + 1].timestamp),
      )
      if (day >= 0) reviewDays[day].count += count
    }
    return { notebookId, entryCount: summary.entries.length, dueCount, reviewedToday }
  })
  const overview = {
    items,
    reviewDays,
    subjects: [...subjects]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }
  return includeLocalState ? { overview, entries, reviews } : overview
}

module.exports = { notebookOverview }
