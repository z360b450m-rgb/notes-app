import type JSZip from 'jszip'
import type { NoteEntry, Notebook, QuestionGroup, ReviewLog } from '@/types'
import type {
  EntryRepository,
  NotebookRepository,
  QuestionGroupRepository,
  ReviewLogRepository,
} from '@/services/repositories'

interface ArchiveRepositories {
  entries: EntryRepository
  notebooks: NotebookRepository
  groups: QuestionGroupRepository
  logs: ReviewLogRepository
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && typeof value.id === 'string' && !!value.id
}

/** Import both legacy browser arrays and complete desktop archives. */
export async function importBrowserArchive(
  zip: JSZip,
  targetNotebookId: string,
  keepReviewState: boolean,
  repositories: ArchiveRepositories,
): Promise<{ imported: number; skipped: number }> {
  const json = zip.file('data.json')
  if (!json) throw new Error('归档中缺少 data.json')
  const data: unknown = JSON.parse(await json.async('string'))
  const legacy = Array.isArray(data)
  if (!legacy && (!isRecord(data) || !Array.isArray(data.entries))) {
    throw new Error('数据格式不正确')
  }
  if (legacy && !targetNotebookId) throw new Error('请先选择一个错题本再导入旧版归档')
  const archive = (legacy ? { entries: data } : data) as Record<string, unknown>
  for (const key of ['notebooks', 'questionGroups', 'reviewLogs']) {
    if (archive[key] !== undefined && !Array.isArray(archive[key])) {
      throw new Error(`数据格式不正确：${key} 应为数组`)
    }
  }

  // Read only referenced images, using paths relative to the ZIP root. Desktop
  // images can live under images/<notebookId>/ as well as directly in images/.
  const imageCache = new Map<string, string>()
  async function restoreImage(source: string): Promise<string> {
    const normalized = source.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized.startsWith('images/')) return source
    const cached = imageCache.get(normalized)
    if (cached) return cached
    const file = zip.file(normalized)
    if (!file) throw new Error(`归档中缺少图片：${normalized}`)
    const extension = normalized.split('.').pop()?.toLowerCase() || 'png'
    const mime = extension === 'jpg' ? 'jpeg' : extension
    const url = `data:image/${mime};base64,${await file.async('base64')}`
    imageCache.set(normalized, url)
    return url
  }
  async function restoreHtml(html: string): Promise<string> {
    const pattern = /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi
    const sources = [...html.matchAll(pattern)]
    const replacements = new Map<string, string>()
    for (const match of sources) replacements.set(match[2], await restoreImage(match[2]))
    return html.replace(
      pattern,
      (_match, prefix: string, source: string, suffix: string) =>
        `${prefix}${replacements.get(source)}${suffix}`,
    )
  }
  async function restoreDrawings(record: Record<string, unknown>) {
    if (isRecord(record.drawings)) {
      const drawings: Record<string, string> = {}
      for (const [field, source] of Object.entries(record.drawings)) {
        if (typeof source === 'string') drawings[field] = await restoreImage(source)
      }
      record.drawings = drawings
    }
    if (typeof record.drawing === 'string') record.drawing = await restoreImage(record.drawing)
  }

  const now = Date.now()
  const notebooks: Notebook[] = []
  for (const item of (archive.notebooks || []) as unknown[]) {
    if (!hasId(item) || typeof item.name !== 'string') {
      throw new Error('错题本数据格式不正确')
    }
    notebooks.push({
      ...item,
      id: item.id,
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      instructions: typeof item.instructions === 'string' ? item.instructions : '',
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: now,
    })
  }
  const knownNotebooks = new Set([
    ...(await repositories.notebooks.getAll()).map((notebook) => notebook.id),
    ...notebooks.map((notebook) => notebook.id),
  ])
  function notebookIdFor(item: Record<string, unknown>): string {
    const id =
      !legacy && typeof item.notebookId === 'string' && item.notebookId
        ? item.notebookId
        : targetNotebookId
    if (!id || !knownNotebooks.has(id)) throw new Error('归档中的题目缺少有效的错题本信息')
    return id
  }

  // Prepare and validate everything before writing, so malformed archives do
  // not leave partially imported data behind.
  const groups: QuestionGroup[] = []
  for (const item of (archive.questionGroups || []) as unknown[]) {
    if (!hasId(item) || typeof item.material !== 'string') {
      throw new Error('题组数据格式不正确')
    }
    const group = {
      ...item,
      notebookId: notebookIdFor(item),
      title: typeof item.title === 'string' ? item.title : '',
      material: await restoreHtml(item.material),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: now,
    } as QuestionGroup
    await restoreDrawings(group as unknown as Record<string, unknown>)
    groups.push(group)
  }
  const entries: NoteEntry[] = []
  let skipped = 0
  for (const item of archive.entries as unknown[]) {
    if (!hasId(item) || typeof item.question !== 'string') {
      skipped++
      continue
    }
    const entry = {
      ...item,
      notebookId: notebookIdFor(item),
      title: typeof item.title === 'string' ? item.title : '',
      question: await restoreHtml(item.question),
      wrongAnswer: await restoreHtml(typeof item.wrongAnswer === 'string' ? item.wrongAnswer : ''),
      correctAnswer: await restoreHtml(
        typeof item.correctAnswer === 'string' ? item.correctAnswer : '',
      ),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
      subject: typeof item.subject === 'string' ? item.subject : '',
      source: typeof item.source === 'string' ? item.source : '',
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: now,
    } as NoteEntry
    await restoreDrawings(entry as unknown as Record<string, unknown>)
    if (!keepReviewState) {
      Object.assign(entry, {
        masteryLevel: 0,
        consecutivePasses: 0,
        reviewCount: 0,
        wrongCount: 0,
        easeFactor: 2.5,
        interval: 0,
      })
      delete entry.nextReviewDate
      delete entry.lastReviewDate
    }
    entries.push(entry)
  }
  if (entries.length === 0) throw new Error('未识别到有效错题数据')
  const notebookByEntry = new Map(entries.map((entry) => [entry.id, entry.notebookId]))
  const logs: ReviewLog[] = []
  if (keepReviewState) {
    for (const item of (archive.reviewLogs || []) as unknown[]) {
      if (
        !hasId(item) ||
        typeof item.entryId !== 'string' ||
        !notebookByEntry.has(item.entryId) ||
        typeof item.timestamp !== 'number' ||
        !['string', 'number'].includes(typeof item.quality)
      ) {
        skipped++
        continue
      }
      logs.push(item as unknown as ReviewLog)
    }
  }
  for (const notebook of notebooks) await repositories.notebooks.put(notebook)
  for (const group of groups) await repositories.groups.put(group.notebookId, group)
  for (const entry of entries) await repositories.entries.put(entry.notebookId, entry)
  // Both browser and server use stable IDs. Avoid re-adding logs on retry.
  const existingLogs = new Map<string, Set<string>>()
  for (const log of logs) {
    const notebookId = notebookByEntry.get(log.entryId)!
    if (!existingLogs.has(notebookId)) {
      existingLogs.set(
        notebookId,
        new Set((await repositories.logs.getAll(notebookId)).map((x) => x.id)),
      )
    }
    const ids = existingLogs.get(notebookId)!
    if (ids.has(log.id)) continue
    await repositories.logs.add(notebookId, log)
    ids.add(log.id)
  }
  return { imported: entries.length, skipped }
}
