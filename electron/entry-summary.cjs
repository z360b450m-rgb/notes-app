function entrySummary(entry) {
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
  )
  return {
    ...metadata,
    question: '',
    wrongAnswer: '',
    correctAnswer: '',
    isSummary: true,
    questionPreview: (entry.questionPreview ?? entry.question ?? '')
      .slice(0, 500)
      .replace(/<[^>]*>?/g, '')
      .slice(0, 100),
  }
}

function groupSummary(group) {
  const metadata = Object.fromEntries(
    Object.entries(group).filter(([field]) => !['material', 'drawings'].includes(field)),
  )
  return { ...metadata, material: '', isSummary: true }
}

function searchEntryIds(data, query) {
  const q = String(query).trim().toLowerCase()
  const groups = new Map(data.questionGroups.map((group) => [group.id, group.material]))
  return data.entries
    .filter((entry) =>
      [
        entry.title,
        entry.question,
        entry.wrongAnswer,
        entry.correctAnswer,
        entry.subject,
        entry.source,
        ...(entry.tags || []),
        groups.get(entry.groupId),
      ].some((value) => (value || '').toLowerCase().includes(q)),
    )
    .map((entry) => entry.id)
}

module.exports = { entrySummary, groupSummary, searchEntryIds }
