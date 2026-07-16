import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type {
  ApkgFieldDefinition,
  VocabularyArchive,
  VocabularyFieldMapping,
  VocabularyWord,
} from './types'
import type { ApkgInspection, VocabularyArchiveSummary, VocabularyProgress } from './service'

const DB_NAME = 'CuotibenMobileVocabulary'
const DB_VERSION = 1
const ARCHIVES = 'archives'
const PROGRESS = 'progress'
const MEDIA = 'media'
const pendingFiles = new Map<string, File>()

function createUniqueId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const randomBytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes)
  } else {
    for (let index = 0; index < randomBytes.length; index += 1) {
      randomBytes[index] = Math.floor(Math.random() * 256)
    }
  }
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80
  const hex = Array.from(randomBytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface StoredArchive extends VocabularyArchive {
  notebookId: string
}

function plainData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ARCHIVES)) {
        const store = db.createObjectStore(ARCHIVES, { keyPath: 'storageKey' })
        store.createIndex('notebookId', 'notebookId')
      }
      if (!db.objectStoreNames.contains(PROGRESS))
        db.createObjectStore(PROGRESS, { keyPath: 'storageKey' })
      if (!db.objectStoreNames.contains(MEDIA))
        db.createObjectStore(MEDIA, { keyPath: 'storageKey' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function request<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode)
        const result = operation(transaction.objectStore(storeName))
        result.onsuccess = () => resolve(result.result)
        result.onerror = () => reject(result.error)
      }),
  )
}

function selectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.apkg,application/zip'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

function normalizeFields(raw: unknown): ApkgFieldDefinition[] {
  return Object.values((raw as Record<string, { name?: string; ord?: number }>) || {})
    .map((field, index) => ({
      name: String(field.name || `字段 ${index + 1}`),
      ordinal: field.ord ?? index,
    }))
    .sort((a, b) => a.ordinal - b.ordinal)
}

function autoMap(fields: ApkgFieldDefinition[]): VocabularyFieldMapping {
  const candidates: Record<keyof VocabularyFieldMapping, string[]> = {
    word: ['英语单词', '英文单词', 'word', 'vocabulary', 'front'],
    phonetic: ['音标', 'phonetic', 'pronunciation'],
    meaning: ['中文释义', '中文翻译', '释义', '翻译', 'meaning', 'definition', 'back'],
    exampleEn: ['英语例句', '英文例句', 'exampleen', 'sentenceen'],
    exampleZh: ['中文例句', '例句翻译', 'examplezh', 'sentencezh'],
    note: ['注释', '笔记', '扩展', 'note', 'remark', 'collins'],
    details: ['答案后详解', '完整解释', '详细解释', 'back'],
    audio: ['英语发音', '单词发音', '音频', 'audio', 'sound'],
  }
  const result: VocabularyFieldMapping = {}
  for (const [target, names] of Object.entries(candidates) as [
    keyof VocabularyFieldMapping,
    string[],
  ][]) {
    const normalized = fields.map((field) => ({
      field,
      name: field.name.toLowerCase().replace(/\s+/g, ''),
    }))
    const found =
      names.map((name) => normalized.find((item) => item.name === name)).find(Boolean) ??
      names.map((name) => normalized.find((item) => item.name.includes(name))).find(Boolean)
    if (found) result[target] = found.field.ordinal
  }
  return result
}

function mapped(
  fields: string[],
  mapping: VocabularyFieldMapping,
  key: keyof VocabularyFieldMapping,
) {
  const ordinal = mapping[key]
  return Number.isInteger(ordinal) ? String(fields[ordinal as number] || '') : ''
}

function sounds(value: string) {
  return Array.from(
    value.matchAll(/\[sound:([^\]]+)\]/gi),
    (match) => match[1].split(/[\\/]/).pop() || '',
  ).filter(Boolean)
}

async function parseCollection(file: File) {
  const zip = await JSZip.loadAsync(file)
  const collection =
    zip.file('collection.anki21b') || zip.file('collection.anki21') || zip.file('collection.anki2')
  if (!collection) throw new Error('APKG 中没有可识别的 Anki collection 文件')
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  const db = new SQL.Database(await collection.async('uint8array'))
  return { zip, db }
}

export async function inspectBrowserApkg() {
  const file = await selectFile()
  if (!file) return { canceled: true }
  const { db } = await parseCollection(file)
  try {
    const row = db.exec('SELECT models, decks FROM col LIMIT 1')[0]?.values?.[0]
    if (!row) throw new Error('APKG 缺少模板或牌组信息')
    const modelData = JSON.parse(String(row[0] || '{}')) as Record<
      string,
      { id: number; name?: string; flds?: Record<string, unknown> }
    >
    const deckData = JSON.parse(String(row[1] || '{}')) as Record<
      string,
      { id: number; name?: string }
    >
    const models = Object.values(modelData).map((model) => ({
      id: Number(model.id),
      name: String(model.name || '未命名模板'),
      fields: normalizeFields(model.flds),
    }))
    const decks = Object.values(deckData).map((deck) => ({
      id: Number(deck.id),
      name: String(deck.name || '未命名牌组'),
    }))
    const mappings = Object.fromEntries(
      models.map((model) => [String(model.id), autoMap(model.fields)]),
    )
    const token = createUniqueId()
    pendingFiles.set(token, file)
    const inspection: ApkgInspection = {
      sourceFilename: file.name,
      collectionName: 'collection',
      models,
      decks,
      mappings,
      noteCount: Number(db.exec('SELECT COUNT(*) FROM notes')[0]?.values?.[0]?.[0] || 0),
    }
    return { canceled: false, filePath: token, inspection }
  } finally {
    db.close()
  }
}

export async function archiveBrowserApkg(
  notebookId: string,
  token: string,
  name: string,
  mappings: Record<string, VocabularyFieldMapping>,
): Promise<VocabularyArchive> {
  const file = pendingFiles.get(token)
  if (!file) throw new Error('请选择要导入的 APKG 文件')
  const { zip, db } = await parseCollection(file)
  try {
    const row = db.exec('SELECT models, decks FROM col LIMIT 1')[0]?.values?.[0]
    if (!row) throw new Error('APKG 缺少模板或牌组信息')
    const modelData = JSON.parse(String(row[0] || '{}')) as Record<
      string,
      { id: number; name?: string; flds?: Record<string, unknown> }
    >
    const deckData = JSON.parse(String(row[1] || '{}')) as Record<
      string,
      { id: number; name?: string }
    >
    const models = Object.values(modelData).map((model) => ({
      id: Number(model.id),
      name: String(model.name || '未命名模板'),
      fields: normalizeFields(model.flds),
    }))
    const decks = Object.values(deckData).map((deck) => ({
      id: Number(deck.id),
      name: String(deck.name || '未命名牌组'),
    }))
    const query = db.exec(
      'SELECT n.id, n.mid, n.flds, n.tags, MIN(c.did) FROM notes n LEFT JOIN cards c ON c.nid = n.id GROUP BY n.id',
    )[0]
    const words: VocabularyWord[] = (query?.values || []).map(
      ([noteId, modelId, rawFields, tags, deckId]) => {
        const fields = String(rawFields || '').split('\u001f')
        const mapping = mappings[String(modelId)] || {}
        const audioFiles = sounds(mapped(fields, mapping, 'audio') || fields.join(' '))
        return {
          id: String(noteId),
          noteId: Number(noteId),
          deckId: Number(deckId || 0),
          modelId: Number(modelId),
          fields,
          word: mapped(fields, mapping, 'word'),
          phonetic: mapped(fields, mapping, 'phonetic'),
          meaning: mapped(fields, mapping, 'meaning'),
          exampleEn: mapped(fields, mapping, 'exampleEn'),
          exampleZh: mapped(fields, mapping, 'exampleZh'),
          note: mapped(fields, mapping, 'note'),
          details: mapped(fields, mapping, 'details'),
          audioFiles,
          tags: String(tags || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean),
        }
      },
    )
    if (words.length === 0) throw new Error('APKG 中没有可导入的词条')
    const id = `${file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')}-${Date.now()}`
    const archive: StoredArchive & { storageKey: string } = {
      storageKey: `${notebookId}:${id}`,
      notebookId,
      id,
      name: name.trim() || file.name.replace(/\.apkg$/i, ''),
      sourceFilename: file.name,
      importedAt: Date.now(),
      decks,
      models,
      mappings,
      words,
    }
    await request(ARCHIVES, 'readwrite', (store) => store.put(archive))
    const mediaMapFile = zip.file('media')
    const mediaMap = mediaMapFile
      ? (JSON.parse(await mediaMapFile.async('text')) as Record<string, string>)
      : {}
    const needed = new Set(words.flatMap((word) => word.audioFiles))
    for (const [index, filename] of Object.entries(mediaMap)) {
      if (!needed.has(filename)) continue
      const entry = zip.file(index)
      if (entry) {
        const blob = await entry.async('blob')
        await request(MEDIA, 'readwrite', (store) =>
          store.put({ storageKey: `${notebookId}:${id}:${filename}`, blob }),
        )
      }
    }
    pendingFiles.delete(token)
    return archive
  } finally {
    db.close()
  }
}

export async function listBrowserArchives(notebookId: string): Promise<VocabularyArchiveSummary[]> {
  const all = (await request(ARCHIVES, 'readonly', (store) => store.getAll())) as (StoredArchive & {
    storageKey: string
  })[]
  return all
    .filter((item) => item.notebookId === notebookId)
    .map(({ words, storageKey: _key, notebookId: _notebook, ...archive }) => ({
      ...archive,
      wordCount: words.length,
    }))
    .sort((a, b) => b.importedAt - a.importedAt)
}

export async function createBrowserArchive(
  notebookId: string,
  name: string,
): Promise<VocabularyArchive> {
  const id = `manual-${createUniqueId()}`
  const archive: VocabularyArchive = {
    id,
    name: name.trim(),
    sourceFilename: '',
    importedAt: Date.now(),
    decks: [{ id: 0, name: '手动词库' }],
    models: [],
    mappings: {},
    words: [],
  }
  await saveBrowserArchive(notebookId, archive)
  return archive
}

export async function saveBrowserArchive(
  notebookId: string,
  archive: VocabularyArchive,
): Promise<void> {
  const stored = plainData({
    ...archive,
    notebookId,
    storageKey: `${notebookId}:${archive.id}`,
  })
  await request(ARCHIVES, 'readwrite', (store) => store.put(stored))
}

export async function loadBrowserArchive(notebookId: string, archiveId: string) {
  const stored = (await request(ARCHIVES, 'readonly', (store) =>
    store.get(`${notebookId}:${archiveId}`),
  )) as StoredArchive | undefined
  if (!stored) return null
  let repaired = false
  for (const model of stored.models) {
    const mapping = stored.mappings[String(model.id)] || {}
    const inferredDetails = autoMap(model.fields).details
    if (inferredDetails != null && mapping.details !== inferredDetails) {
      mapping.details = inferredDetails
      stored.mappings[String(model.id)] = mapping
      repaired = true
    }
  }
  for (const word of stored.words) {
    const details = mapped(word.fields, stored.mappings[String(word.modelId)] || {}, 'details')
    if (details && word.details !== details) {
      word.details = details
      repaired = true
    }
  }
  if (repaired) {
    await request(ARCHIVES, 'readwrite', (store) =>
      store.put(plainData({ ...stored, storageKey: `${notebookId}:${archiveId}` })),
    )
  }
  const archive = { ...stored } as StoredArchive & { storageKey?: string }
  delete archive.notebookId
  delete archive.storageKey
  return archive
}

export async function deleteBrowserArchive(notebookId: string, archiveId: string) {
  await request(ARCHIVES, 'readwrite', (store) => store.delete(`${notebookId}:${archiveId}`))
  await request(PROGRESS, 'readwrite', (store) => store.delete(`${notebookId}:${archiveId}`))
  const mediaPrefix = `${notebookId}:${archiveId}:`
  const mediaKeys = (await request(MEDIA, 'readonly', (store) =>
    store.getAllKeys(),
  )) as IDBValidKey[]
  for (const key of mediaKeys) {
    if (String(key).startsWith(mediaPrefix)) {
      await request(MEDIA, 'readwrite', (store) => store.delete(key))
    }
  }
}

export async function loadBrowserProgress(
  notebookId: string,
  archiveId: string,
): Promise<VocabularyProgress> {
  const stored = (await request(PROGRESS, 'readonly', (store) =>
    store.get(`${notebookId}:${archiveId}`),
  )) as (VocabularyProgress & { storageKey: string }) | undefined
  return (
    stored ??
    ({
      storageKey: `${notebookId}:${archiveId}`,
      archiveId,
      updatedAt: Date.now(),
      words: {},
      sessions: {},
      settings: {
        dailyNewWordLimit: 20,
        correctIntervalsDays: [1, 3, 7, 14, 30],
        wrongRetryMinutes: 10,
      },
    } as VocabularyProgress & { storageKey: string })
  )
}

export async function saveBrowserProgress(
  notebookId: string,
  archiveId: string,
  progress: VocabularyProgress,
) {
  await request(PROGRESS, 'readwrite', (store) =>
    store.put(
      plainData({
        ...progress,
        storageKey: `${notebookId}:${archiveId}`,
        updatedAt: Date.now(),
      }),
    ),
  )
}

export async function getBrowserAudioUrl(notebookId: string, archiveId: string, filename: string) {
  const stored = (await request(MEDIA, 'readonly', (store) =>
    store.get(`${notebookId}:${archiveId}:${filename}`),
  )) as { blob?: Blob | Promise<Blob> } | undefined
  if (!stored?.blob) return null
  return URL.createObjectURL(await stored.blob)
}
