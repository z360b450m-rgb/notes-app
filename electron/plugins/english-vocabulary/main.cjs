const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const initSqlJs = require('sql.js')

let sqlJsPromise = null

function getSqlJs() {
  if (!sqlJsPromise) sqlJsPromise = initSqlJs()
  return sqlJsPromise
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)
}

function safeArchiveId(name) {
  const stem = String(name || 'vocabulary')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${stem || 'vocabulary'}-${Date.now()}`
}

function safeChild(root, child) {
  const rootPath = path.resolve(root)
  const childPath = path.resolve(rootPath, path.basename(String(child || '')))
  if (path.dirname(childPath) !== rootPath) throw new Error('无效的词库路径')
  return childPath
}

function getNotebookPluginRoot(dataRoot, notebookId) {
  const safeNotebookId = path.basename(String(notebookId || ''))
  if (!safeNotebookId) throw new Error('缺少错题本标识')
  return path.join(dataRoot, 'plugins', 'english-vocabulary', 'notebooks', safeNotebookId)
}

function getArchivesRoot(dataRoot, notebookId) {
  return path.join(getNotebookPluginRoot(dataRoot, notebookId), 'archives')
}

function installationPath(dataRoot, notebookId) {
  return path.join(getNotebookPluginRoot(dataRoot, notebookId), 'installation.json')
}

function isInstalled(dataRoot, notebookId) {
  return fs.existsSync(installationPath(dataRoot, notebookId))
}

function getInstallation(dataRoot, notebookId) {
  const filePath = installationPath(dataRoot, notebookId)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function install(dataRoot, notebookId) {
  const installedAt = Date.now()
  const installation = {
    notebookId: path.basename(String(notebookId || '')),
    pluginId: 'english-vocabulary',
    version: '1.0.0',
    enabled: true,
    installedAt,
    settings: {},
  }
  const legacyRoot = path.join(dataRoot, 'vocabulary')
  const archivesRoot = getArchivesRoot(dataRoot, notebookId)
  const targetHasArchives =
    fs.existsSync(archivesRoot) &&
    fs.readdirSync(archivesRoot, { withFileTypes: true }).some((entry) => entry.isDirectory())
  if (fs.existsSync(legacyRoot) && !targetHasArchives) {
    fs.mkdirSync(archivesRoot, { recursive: true })
    fs.cpSync(legacyRoot, archivesRoot, { recursive: true, errorOnExist: false })
    installation.migratedLegacyDataAt = Date.now()
  }
  atomicWriteJson(installationPath(dataRoot, notebookId), installation)
  return installation
}

function deleteNotebookData(dataRoot, notebookId) {
  const pluginRoot = getNotebookPluginRoot(dataRoot, notebookId)
  if (fs.existsSync(pluginRoot)) fs.rmSync(pluginRoot, { recursive: true })
}

function uninstall(dataRoot, notebookId, deleteData) {
  if (deleteData) {
    deleteNotebookData(dataRoot, notebookId)
    return
  }
  const filePath = installationPath(dataRoot, notebookId)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function parseSoundReferences(value) {
  const files = []
  const regex = /\[sound:([^\]]+)\]/gi
  let match
  while ((match = regex.exec(String(value || '')))) files.push(path.basename(match[1]))
  return files
}

function autoMapFields(fieldDefinitions) {
  const candidates = {
    word: ['英语单词', '英文单词', 'word', 'vocabulary', 'front'],
    phonetic: ['音标', 'phonetic', 'pronunciation'],
    meaning: ['中文释义', '中文翻译', '释义', '翻译', 'meaning', 'definition', 'back'],
    exampleEn: ['英语例句', '英文例句', 'example en', 'sentence en'],
    exampleZh: ['中文例句', '例句翻译', 'example zh', 'sentence zh'],
    note: ['注释', '笔记', '扩展', 'note', 'remark', 'collins'],
    details: ['答案后详解', '完整解释', '详细解释', 'back'],
    audio: ['英语发音', '单词发音', '音频', 'audio', 'sound'],
  }
  const mapping = {}
  for (const [target, names] of Object.entries(candidates)) {
    const normalizedNames = names.map((name) => name.toLowerCase().replace(/\s+/g, ''))
    const fields = fieldDefinitions.map((field) => ({
      field,
      normalized: String(field.name || '')
        .toLowerCase()
        .replace(/\s+/g, ''),
    }))
    const found =
      normalizedNames.map((name) => fields.find((item) => item.normalized === name)).find(Boolean)
        ?.field ||
      normalizedNames
        .map((name) => fields.find((item) => item.normalized.includes(name)))
        .find(Boolean)?.field
    if (found) mapping[target] = found.ordinal
  }
  return mapping
}

function repairLegacyFallbackMappings(archive) {
  let changed = false
  for (const model of archive.models || []) {
    const modelId = String(model.id)
    const current = archive.mappings?.[modelId] || {}
    const inferred = autoMapFields(model.fields || [])
    const fieldName = (ordinal) =>
      String((model.fields || []).find((field) => field.ordinal === ordinal)?.name || '')
        .trim()
        .toLowerCase()
    for (const target of ['word', 'meaning']) {
      const currentName = fieldName(current[target])
      const inferredName = fieldName(inferred[target])
      if (
        inferred[target] != null &&
        inferred[target] !== current[target] &&
        ['front', 'back'].includes(currentName) &&
        !['front', 'back'].includes(inferredName)
      ) {
        current[target] = inferred[target]
        changed = true
      }
    }
    if (inferred.details != null && current.details !== inferred.details) {
      current.details = inferred.details
      changed = true
    }
    archive.mappings = archive.mappings || {}
    archive.mappings[modelId] = current
  }
  if (!changed) return false
  for (const word of archive.words || []) {
    const mapping = archive.mappings[String(word.modelId)] || {}
    word.word = mapped(word.fields || [], mapping, 'word')
    word.meaning = mapped(word.fields || [], mapping, 'meaning')
    word.details = mapped(word.fields || [], mapping, 'details')
  }
  return true
}

function mapped(fields, mapping, key) {
  const ordinal = mapping?.[key]
  return Number.isInteger(ordinal) ? String(fields[ordinal] || '') : ''
}

function resolveCollectionEntry(zip) {
  return ['collection.anki21b', 'collection.anki21', 'collection.anki2']
    .map((name) => zip.getEntry(name))
    .find(Boolean)
}

function normalizeModels(rawModels) {
  return Object.values(rawModels || {}).map((model) => ({
    id: Number(model.id),
    name: String(model.name || '未命名模板'),
    fields: (model.flds || [])
      .map((field, index) => ({
        name: String(field.name || `字段 ${index + 1}`),
        ordinal: field.ord ?? index,
      }))
      .sort((a, b) => a.ordinal - b.ordinal),
  }))
}

function normalizeDecks(rawDecks) {
  return Object.values(rawDecks || {}).map((deck) => ({
    id: Number(deck.id),
    name: String(deck.name || '未命名牌组'),
  }))
}

function readCollectionMetadata(db) {
  const row = db.exec('SELECT models, decks FROM col LIMIT 1')[0]?.values?.[0]
  if (!row) throw new Error('APKG collection 缺少模板或牌组信息')
  const [modelsJson, decksJson] = row
  return {
    models: normalizeModels(JSON.parse(String(modelsJson || '{}'))),
    decks: normalizeDecks(JSON.parse(String(decksJson || '{}'))),
  }
}

async function inspectApkg(filePath) {
  const zip = new AdmZip(filePath)
  const collectionEntry = resolveCollectionEntry(zip)
  if (!collectionEntry) throw new Error('APKG 中没有找到可识别的 Anki collection 文件')

  const SQL = await getSqlJs()
  const db = new SQL.Database(collectionEntry.getData())
  try {
    const { models, decks } = readCollectionMetadata(db)
    const mappings = Object.fromEntries(
      models.map((model) => [String(model.id), autoMapFields(model.fields)]),
    )
    const noteCount = Number(db.exec('SELECT COUNT(*) FROM notes')[0]?.values?.[0]?.[0] || 0)
    return {
      sourceFilename: path.basename(filePath),
      collectionName: collectionEntry.entryName,
      models,
      decks,
      mappings,
      noteCount,
    }
  } finally {
    db.close()
  }
}

async function archiveApkg(filePath, vocabularyRoot, requestedName, requestedMappings = {}) {
  const zip = new AdmZip(filePath)
  const collectionEntry = resolveCollectionEntry(zip)
  if (!collectionEntry) throw new Error('APKG 中没有找到可识别的 Anki collection 文件')

  const SQL = await getSqlJs()
  const db = new SQL.Database(collectionEntry.getData())
  let archiveDir = null
  try {
    const { models, decks } = readCollectionMetadata(db)
    const autoMappings = Object.fromEntries(
      models.map((model) => [String(model.id), autoMapFields(model.fields)]),
    )
    const mappings = { ...autoMappings, ...requestedMappings }
    const archiveId = safeArchiveId(path.basename(filePath))
    archiveDir = safeChild(vocabularyRoot, archiveId)
    const mediaDir = path.join(archiveDir, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })

    const mediaEntry = zip.getEntry('media')
    const mediaMap = mediaEntry ? JSON.parse(mediaEntry.getData().toString('utf-8')) : {}
    const mediaByFilename = new Map(
      Object.entries(mediaMap).map(([index, filename]) => [String(filename), index]),
    )
    const query = db.exec(
      'SELECT n.id, n.mid, n.flds, n.tags, MIN(c.did) FROM notes n LEFT JOIN cards c ON c.nid = n.id GROUP BY n.id',
    )[0]
    const words = (query?.values || []).map(([noteId, modelId, rawFields, tags, deckId]) => {
      const fields = String(rawFields || '').split('\u001f')
      const mapping = mappings[String(modelId)] || {}
      const audioSource = mapped(fields, mapping, 'audio') || fields.join(' ')
      const audioFiles = parseSoundReferences(audioSource).filter((filename) =>
        mediaByFilename.has(filename),
      )
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
    })

    if (words.length === 0) throw new Error('APKG 中没有可导入的词条')

    const neededMedia = new Set(words.flatMap((word) => word.audioFiles))
    for (const filename of neededMedia) {
      const entryIndex = mediaByFilename.get(filename)
      const entry = entryIndex == null ? null : zip.getEntry(String(entryIndex))
      if (entry) fs.writeFileSync(path.join(mediaDir, path.basename(filename)), entry.getData())
    }

    const archive = {
      id: archiveId,
      name:
        String(requestedName || '')
          .trim()
          .slice(0, 80) || path.basename(filePath, path.extname(filePath)),
      sourceFilename: path.basename(filePath),
      importedAt: Date.now(),
      decks,
      models,
      mappings,
      words,
    }
    fs.copyFileSync(filePath, path.join(archiveDir, 'source.apkg'))
    atomicWriteJson(path.join(archiveDir, 'archive.json'), archive)
    atomicWriteJson(path.join(archiveDir, 'progress.json'), {
      archiveId,
      updatedAt: Date.now(),
      words: {},
      sessions: {},
      settings: {
        dailyNewWordLimit: 20,
        correctIntervalsDays: [1, 3, 7, 14, 30],
        wrongRetryMinutes: 10,
      },
    })
    return archive
  } catch (error) {
    if (archiveDir && fs.existsSync(archiveDir)) fs.rmSync(archiveDir, { recursive: true })
    throw error
  } finally {
    db.close()
  }
}

function listArchives(vocabularyRoot) {
  if (!fs.existsSync(vocabularyRoot)) return []
  return fs
    .readdirSync(vocabularyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const filePath = path.join(safeChild(vocabularyRoot, entry.name), 'archive.json')
      if (!fs.existsSync(filePath)) return null
      try {
        const archive = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        const { words, ...summary } = archive
        return { ...summary, wordCount: Array.isArray(words) ? words.length : 0 }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.importedAt - a.importedAt)
}

function loadArchive(vocabularyRoot, archiveId) {
  const filePath = path.join(safeChild(vocabularyRoot, archiveId), 'archive.json')
  if (!fs.existsSync(filePath)) return null
  const archive = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  if (repairLegacyFallbackMappings(archive)) atomicWriteJson(filePath, archive)
  return archive
}

function createArchive(vocabularyRoot, requestedName) {
  const name = String(requestedName || '')
    .trim()
    .slice(0, 80)
  if (!name) throw new Error('请输入词库名称')
  const archiveId = safeArchiveId(`manual-${name}`)
  const archiveDir = safeChild(vocabularyRoot, archiveId)
  fs.mkdirSync(archiveDir, { recursive: true })
  const archive = {
    id: archiveId,
    name,
    sourceFilename: '',
    importedAt: Date.now(),
    decks: [{ id: 0, name: '手动词库' }],
    models: [],
    mappings: {},
    words: [],
  }
  atomicWriteJson(path.join(archiveDir, 'archive.json'), archive)
  atomicWriteJson(path.join(archiveDir, 'progress.json'), {
    archiveId,
    updatedAt: Date.now(),
    words: {},
    sessions: {},
    settings: {
      dailyNewWordLimit: 20,
      correctIntervalsDays: [1, 3, 7, 14, 30],
      wrongRetryMinutes: 10,
    },
  })
  return archive
}

function saveArchive(vocabularyRoot, archiveId, archive) {
  const safeId = path.basename(String(archiveId || ''))
  if (!safeId || safeId !== String(archiveId || '') || archive?.id !== safeId) {
    throw new Error('无效的词库标识')
  }
  const archiveDir = safeChild(vocabularyRoot, safeId)
  if (!fs.existsSync(path.join(archiveDir, 'archive.json'))) throw new Error('词库不存在')
  atomicWriteJson(path.join(archiveDir, 'archive.json'), archive)
}

function deleteArchive(vocabularyRoot, archiveId) {
  const safeId = path.basename(String(archiveId || ''))
  if (!safeId || safeId !== String(archiveId || '')) throw new Error('无效的词库标识')
  const archiveDir = safeChild(vocabularyRoot, safeId)
  if (!fs.existsSync(path.join(archiveDir, 'archive.json'))) throw new Error('词库不存在')
  fs.rmSync(archiveDir, { recursive: true })
}

function loadProgress(vocabularyRoot, archiveId) {
  const safeId = path.basename(String(archiveId || ''))
  const filePath = path.join(safeChild(vocabularyRoot, safeId), 'progress.json')
  if (!fs.existsSync(filePath)) {
    return {
      archiveId: safeId,
      updatedAt: Date.now(),
      words: {},
      sessions: {},
      settings: {
        dailyNewWordLimit: 20,
        correctIntervalsDays: [1, 3, 7, 14, 30],
        wrongRetryMinutes: 10,
      },
    }
  }
  const progress = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  return {
    ...progress,
    words: progress.words || {},
    sessions: progress.sessions || {},
    settings: {
      dailyNewWordLimit: Math.max(1, Number(progress.settings?.dailyNewWordLimit) || 20),
      correctIntervalsDays:
        Array.isArray(progress.settings?.correctIntervalsDays) &&
        progress.settings.correctIntervalsDays.length > 0
          ? progress.settings.correctIntervalsDays.map((value) =>
              Math.max(1, Math.round(Number(value) || 1)),
            )
          : [1, 3, 7, 14, 30],
      wrongRetryMinutes: Math.max(
        1,
        Math.round(Number(progress.settings?.wrongRetryMinutes) || 10),
      ),
    },
  }
}

function saveProgress(vocabularyRoot, archiveId, progress) {
  const safeId = path.basename(String(archiveId || ''))
  const archiveDir = safeChild(vocabularyRoot, safeId)
  if (!fs.existsSync(path.join(archiveDir, 'archive.json'))) throw new Error('词库不存在')
  atomicWriteJson(path.join(archiveDir, 'progress.json'), {
    ...progress,
    archiveId: safeId,
    updatedAt: Date.now(),
  })
}

function readAudio(vocabularyRoot, archiveId, filename) {
  const archiveDir = safeChild(vocabularyRoot, archiveId)
  const safeFilename = path.basename(String(filename || ''))
  const filePath = path.join(archiveDir, 'media', safeFilename)
  if (!safeFilename || !fs.existsSync(filePath)) return null
  const ext = path.extname(safeFilename).toLowerCase()
  const mime =
    ext === '.ogg'
      ? 'audio/ogg'
      : ext === '.wav'
        ? 'audio/wav'
        : ext === '.m4a'
          ? 'audio/mp4'
          : 'audio/mpeg'
  return { mime, data: fs.readFileSync(filePath).toString('base64') }
}

module.exports = {
  getArchivesRoot,
  isInstalled,
  getInstallation,
  install,
  uninstall,
  deleteNotebookData,
  inspectApkg,
  archiveApkg,
  listArchives,
  loadArchive,
  createArchive,
  saveArchive,
  deleteArchive,
  loadProgress,
  saveProgress,
  readAudio,
}
