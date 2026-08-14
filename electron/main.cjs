// ===================================================================
// @AI-ENVIRONMENT-RULES: Electron 主进程 (Node.js 环境)
//
// 本文件运行在 Node.js 主进程, 拥有完整的系统权限 (文件 I/O、
// 系统对话框、进程管理)。这是安全敏感级别最高的代码层。
//
// ■ 环境约束：
//   1. 不存在 window / document / localStorage 等浏览器 API。
//   2. 所有数据持久化通过 fs 模块操作 JSON 文件实现。
//   3. 与渲染进程的唯一通信通道是 ipcMain.handle / ipcMain.on。
//
// ■ 安全边界 (CRITICAL)：
//   1. 任何新增的 ipcMain.handle 必须同步在 preload.cjs 中通过
//      contextBridge.exposeInMainWorld 暴露给渲染进程。
//   2. 绝不能直接在渲染进程中 require('electron') 或 require
//      Node.js 核心模块 (fs, path, child_process 等)。
//   3. 新增 IPC 通道名称必须有明确的命名空间前缀
//      (storage:/ desktop:/ 等)。
//   4. 文件路径必须校验, 防止路径遍历攻击。
//
// ■ 数据完整性：
//   1. 修改文件存储格式 (JSON 结构) 前必须确认 src/types/index.ts
//      中的接口定义已同步更新。
//   2. 原子写入：先写 .tmp 文件再 rename, 防止写入中断导致数据损坏。
//   3. 级联删除：删除 Notebook 时必须同步删除其关联 entries、
//      snapshots、reviewLogs。
//
// ■ 修改前必读文件：
//   - electron/preload.cjs (API 桥接层)
//   - src/types/index.ts (数据结构定义)
//   - src/services/db.ts (渲染进程数据库访问层)
// ===================================================================
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  desktopCapturer,
  shell,
  protocol,
  net,
} = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const log = require('electron-log')
const AdmZip = require('adm-zip')
const vocabulary = require('./plugins/english-vocabulary/main.cjs')
const pluginRegistry = require('./plugins/registry.cjs')

log.transports.file.level = 'info'
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

process.on('uncaughtException', (error) => {
  log.error('发生未捕获的异常:', error)
})

let mainWindow
let dataDir = null
let pendingVocabularyImportPath = null

const IMAGE_SCHEME = 'cuotiben-image'
const IMAGE_FIELDS = ['question', 'wrongAnswer', 'correctAnswer']
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/bmp', 'bmp'],
])

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

function getDefaultDataDir() {
  return path.join(app.getPath('documents'), '错题本')
}

function getDataDir() {
  if (!dataDir) {
    const configPath = path.join(app.getPath('userData'), 'config.json')
    try {
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (cfg.dataDir && fs.existsSync(cfg.dataDir)) {
          dataDir = cfg.dataDir
          return dataDir
        }
      }
    } catch (err) {
      log.warn('读取 config.json 失败，使用默认数据目录', err)
    }
    dataDir = getDefaultDataDir()
  }
  return dataDir
}

function getImagesDir() {
  return path.join(getDataDir(), 'images')
}

function normalizeRelativeImagePath(value) {
  if (typeof value !== 'string') return null
  let candidate = value.trim().replace(/\\/g, '/')
  if (candidate.startsWith(`${IMAGE_SCHEME}://local/`)) {
    candidate = decodeURIComponent(candidate.slice(`${IMAGE_SCHEME}://local/`.length))
  }
  candidate = candidate.replace(/^\.\//, '')
  if (!candidate.startsWith('images/')) return null

  const resolved = path.resolve(getDataDir(), ...candidate.split('/'))
  const root = path.resolve(getImagesDir())
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return path.relative(getDataDir(), resolved).split(path.sep).join('/')
}

function imageAbsolutePath(relativePath) {
  const safeRelativePath = normalizeRelativeImagePath(relativePath)
  if (!safeRelativePath) throw new Error('Invalid image path')
  return path.resolve(getDataDir(), ...safeRelativePath.split('/'))
}

function saveImageBytes(notebookId, bytes, mimeType) {
  assertSafeId(notebookId)
  const extension = IMAGE_MIME_EXTENSIONS.get(String(mimeType).toLowerCase())
  if (!extension) throw new Error(`Unsupported image type: ${mimeType}`)

  const buffer = Buffer.from(bytes)
  if (buffer.length === 0) throw new Error('Image is empty')
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB limit')

  const notebookImagesDir = path.join(getImagesDir(), notebookId)
  fs.mkdirSync(notebookImagesDir, { recursive: true })
  const filename = `${Date.now().toString(36)}_${crypto.randomUUID()}.${extension}`
  const absolutePath = path.join(notebookImagesDir, filename)
  fs.writeFileSync(absolutePath, buffer, { flag: 'wx' })
  return `images/${notebookId}/${filename}`
}

function normalizeImageUrls(html) {
  if (typeof html !== 'string') return html
  return html.replace(
    /(<img\b[^>]*?\bsrc=["'])(cuotiben-image:\/\/local\/[^"']+)(["'][^>]*>)/gi,
    (_match, prefix, source, suffix) => {
      const relativePath = normalizeRelativeImagePath(source)
      return relativePath ? `${prefix}${relativePath}${suffix}` : _match
    },
  )
}

function externalizeImageSource(source, notebookId) {
  if (typeof source !== 'string') return source
  const relativePath = normalizeRelativeImagePath(source)
  if (relativePath) return relativePath
  const match = source.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp|bmp));base64,(.+)$/i)
  if (!match) return source
  try {
    return saveImageBytes(notebookId, Buffer.from(match[2], 'base64'), match[1])
  } catch (err) {
    log.warn('Failed to externalize an embedded image', err)
    return source
  }
}

function externalizeHtmlImages(html, notebookId) {
  if (typeof html !== 'string') return html
  const normalized = normalizeImageUrls(html)
  return normalized.replace(
    /(<img\b[^>]*?\bsrc=["'])data:(image\/(?:png|jpeg|jpg|gif|webp|bmp));base64,([^"']+)(["'][^>]*>)/gi,
    (_match, prefix, mimeType, encoded, suffix) => {
      try {
        const relativePath = saveImageBytes(notebookId, Buffer.from(encoded, 'base64'), mimeType)
        return `${prefix}${relativePath}${suffix}`
      } catch (err) {
        log.warn('Failed to externalize an embedded image', err)
        return _match
      }
    },
  )
}

function externalizeEntryImages(entry) {
  if (!entry?.notebookId) return entry
  const normalized = structuredClone(entry)
  for (const field of IMAGE_FIELDS) {
    normalized[field] = externalizeHtmlImages(normalized[field] || '', normalized.notebookId)
  }
  if (normalized.drawings && typeof normalized.drawings === 'object') {
    normalized.drawings = Object.fromEntries(
      Object.entries(normalized.drawings).map(([field, source]) => [
        field,
        externalizeImageSource(source, normalized.notebookId),
      ]),
    )
  }
  if (typeof normalized.drawing === 'string') {
    normalized.drawing = externalizeImageSource(normalized.drawing, normalized.notebookId)
  }
  return normalized
}

function externalizeQuestionGroupImages(group) {
  if (!group?.notebookId) return group
  const normalized = structuredClone(group)
  normalized.material = externalizeHtmlImages(normalized.material || '', normalized.notebookId)
  if (normalized.drawings && typeof normalized.drawings === 'object') {
    normalized.drawings = Object.fromEntries(
      Object.entries(normalized.drawings).map(([field, source]) => [
        field,
        externalizeImageSource(source, normalized.notebookId),
      ]),
    )
  }
  return normalized
}

function collectReferencedImages(nbData) {
  const referenced = new Set()
  const records = [
    ...(nbData.entries || []),
    ...(nbData.snapshots || []).map((snapshot) => snapshot.data).filter(Boolean),
  ]
  for (const record of records) {
    for (const field of IMAGE_FIELDS) {
      const html = record[field]
      if (typeof html !== 'string') continue
      const sourcePattern = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi
      let match
      while ((match = sourcePattern.exec(html))) {
        const relativePath = normalizeRelativeImagePath(match[1])
        if (relativePath) referenced.add(relativePath)
      }
    }
    const drawingSources = [
      ...Object.values(record.drawings || {}),
      ...(typeof record.drawing === 'string' ? [record.drawing] : []),
    ]
    for (const source of drawingSources) {
      const relativePath = normalizeRelativeImagePath(source)
      if (relativePath) referenced.add(relativePath)
    }
  }
  for (const group of nbData.questionGroups || []) {
    const sourcePattern = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi
    let match
    while ((match = sourcePattern.exec(group.material || ''))) {
      const relativePath = normalizeRelativeImagePath(match[1])
      if (relativePath) referenced.add(relativePath)
    }
    for (const source of Object.values(group.drawings || {})) {
      const relativePath = normalizeRelativeImagePath(source)
      if (relativePath) referenced.add(relativePath)
    }
  }
  return referenced
}

function cleanupNotebookImages(notebookId, nbData) {
  assertSafeId(notebookId)
  const notebookImagesDir = path.join(getImagesDir(), notebookId)
  if (!fs.existsSync(notebookImagesDir)) return
  const referenced = collectReferencedImages(nbData)
  const orphanGracePeriodMs = 5 * 60 * 1000
  for (const filename of fs.readdirSync(notebookImagesDir)) {
    const relativePath = `images/${notebookId}/${filename}`
    const absolutePath = path.join(notebookImagesDir, filename)
    const stat = fs.statSync(absolutePath)
    if (
      !referenced.has(relativePath) &&
      stat.isFile() &&
      Date.now() - stat.mtimeMs >= orphanGracePeriodMs
    ) {
      fs.unlinkSync(absolutePath)
    }
  }
}

function readConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (err) {
    log.warn('读取应用配置失败', err)
  }
  return {}
}

function saveConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const cfg = readConfig()
  cfg.dataDir = dataDir
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
}

function isIndexedDBMigrated() {
  return readConfig().indexedDBMigrated === true
}

function markIndexedDBMigrated() {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  const cfg = readConfig()
  cfg.indexedDBMigrated = true
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
}

// ── Data layer: per-notebook sharding ─────────────────────────────────

function getNotebooksMetaPath() {
  return path.join(getDataDir(), 'notebooks.json')
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/

function assertSafeId(id) {
  if (typeof id !== 'string' || !VALID_ID_RE.test(id)) {
    throw new Error(`Invalid notebook id: ${id}`)
  }
}

function getNotebookDataPath(notebookId) {
  assertSafeId(notebookId)
  return path.join(getDataDir(), `notebook_${notebookId}.json`)
}

function readNotebooksMeta() {
  const filePath = getNotebooksMetaPath()
  try {
    if (!fs.existsSync(filePath)) return []
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    log.error('读取笔记本元数据失败', err)
    return []
  }
}

function writeNotebooksMeta(notebooks) {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const filePath = getNotebooksMetaPath()
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(notebooks, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    log.error('写入笔记本元数据失败', err)
  }
}

function readNotebookData(notebookId) {
  const filePath = getNotebookDataPath(notebookId)
  try {
    if (!fs.existsSync(filePath)) {
      return { entries: [], questionGroups: [], snapshots: [], reviewLogs: [] }
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!data.entries) data.entries = []
    if (!data.snapshots) data.snapshots = []
    if (!data.reviewLogs) data.reviewLogs = []
    if (!data.questionGroups) data.questionGroups = []
    return data
  } catch (err) {
    log.error(`读取错题本 ${notebookId} 失败`, err)
    return { entries: [], questionGroups: [], snapshots: [], reviewLogs: [] }
  }
}

function writeNotebookData(notebookId, data) {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const filePath = getNotebookDataPath(notebookId)
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
    return true
  } catch (err) {
    log.error(`写入错题本 ${notebookId} 失败`, err)
    return false
  }
}

// One-time migration from old single-file format
function migrateFromSingleFile() {
  const oldPath = path.join(getDataDir(), 'cuotiben-data.json')
  if (!fs.existsSync(oldPath)) return false

  try {
    const raw = fs.readFileSync(oldPath, 'utf-8')
    const oldData = JSON.parse(raw)

    // Write notebooks meta
    const notebooks = oldData.notebooks || []
    writeNotebooksMeta(notebooks)

    // Distribute entries, snapshots, reviewLogs to per-notebook files
    for (const nb of notebooks) {
      const nbData = {
        entries: (oldData.entries || []).filter((e) => e.notebookId === nb.id),
        questionGroups: (oldData.questionGroups || []).filter(
          (group) => group.notebookId === nb.id,
        ),
        snapshots: [],
        reviewLogs: [],
      }

      // Snapshots: match by entryId
      const entryIds = new Set(nbData.entries.map((e) => e.id))
      nbData.snapshots = (oldData.snapshots || []).filter((s) => entryIds.has(s.entryId))

      // ReviewLogs: match by entryId
      nbData.reviewLogs = (oldData.reviewLogs || []).filter((l) => entryIds.has(l.entryId))

      writeNotebookData(nb.id, nbData)
    }

    // Handle orphaned entries (no matching notebook)
    const knownIds = new Set(notebooks.map((n) => n.id))
    const orphanEntries = (oldData.entries || []).filter((e) => !knownIds.has(e.notebookId))
    if (orphanEntries.length > 0) {
      log.warn(`迁移: ${orphanEntries.length} 条错题没有归属笔记本，已跳过`)
    }

    // Rename old file as backup
    fs.renameSync(oldPath, oldPath + '.bak')
    log.info('数据迁移完成: 单文件 → 分笔记本存储')
    return true
  } catch (err) {
    log.error('数据迁移失败', err)
    return false
  }
}

function migrateStoredBase64Images() {
  let migratedEntries = 0
  for (const notebook of readNotebooksMeta()) {
    const nbData = readNotebookData(notebook.id)
    let changed = false

    nbData.entries = (nbData.entries || []).map((entry) => {
      const migrated = externalizeEntryImages(entry)
      if (
        IMAGE_FIELDS.some((field) => migrated[field] !== entry[field]) ||
        JSON.stringify(migrated.drawings) !== JSON.stringify(entry.drawings) ||
        migrated.drawing !== entry.drawing
      ) {
        changed = true
        migratedEntries++
      }
      return migrated
    })

    nbData.snapshots = (nbData.snapshots || []).map((snapshot) => {
      if (!snapshot.data) return snapshot
      const migratedData = externalizeEntryImages({ ...snapshot.data, notebookId: notebook.id })
      if (
        IMAGE_FIELDS.some((field) => migratedData[field] !== snapshot.data[field]) ||
        JSON.stringify(migratedData.drawings) !== JSON.stringify(snapshot.data.drawings) ||
        migratedData.drawing !== snapshot.data.drawing
      ) {
        changed = true
      }
      return { ...snapshot, data: migratedData }
    })

    nbData.questionGroups = (nbData.questionGroups || []).map((group) => {
      const migrated = externalizeQuestionGroupImages(group)
      if (
        migrated.material !== group.material ||
        JSON.stringify(migrated.drawings) !== JSON.stringify(group.drawings)
      ) {
        changed = true
      }
      return migrated
    })

    if (!changed || writeNotebookData(notebook.id, nbData)) {
      cleanupNotebookImages(notebook.id, nbData)
    }
  }
  if (migratedEntries > 0) log.info(`Externalized images in ${migratedEntries} stored entries`)
}

// Register IPC handlers
// ── Desktop capture ─────────────────────────────────────────────────

ipcMain.handle('desktop:getSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 240 },
    fetchWindowIcons: true,
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
  }))
})

// ── Migration ─────────────────────────────────────────────────────

ipcMain.handle('storage:isIndexedDBMigrated', () => {
  return isIndexedDBMigrated()
})

ipcMain.handle('storage:markIndexedDBMigrated', () => {
  markIndexedDBMigrated()
})

ipcMain.handle('storage:getAll', (_e, notebookId) => {
  return readNotebookData(notebookId).entries
})

ipcMain.handle('storage:get', (_e, notebookId, id) => {
  const nbData = readNotebookData(notebookId)
  return nbData.entries.find((e) => e.id === id) ?? null
})

ipcMain.handle('storage:put', (_e, entry) => {
  if (!entry.notebookId) return
  const storedEntry = externalizeEntryImages(entry)
  const nbData = readNotebookData(storedEntry.notebookId)
  const idx = nbData.entries.findIndex((e) => e.id === storedEntry.id)
  if (idx >= 0) {
    nbData.entries[idx] = storedEntry
  } else {
    nbData.entries.push(storedEntry)
  }
  if (writeNotebookData(storedEntry.notebookId, nbData)) {
    cleanupNotebookImages(storedEntry.notebookId, nbData)
  }
  return storedEntry
})

ipcMain.handle('storage:delete', (_e, notebookId, id) => {
  const nbData = readNotebookData(notebookId)
  nbData.entries = nbData.entries.filter((e) => e.id !== id)
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

ipcMain.handle('storage:getAllQuestionGroups', (_e, notebookId) => {
  return readNotebookData(notebookId).questionGroups
})

ipcMain.handle('storage:getQuestionGroup', (_e, notebookId, groupId) => {
  const nbData = readNotebookData(notebookId)
  return nbData.questionGroups.find((group) => group.id === groupId) ?? null
})

ipcMain.handle('storage:putQuestionGroup', (_e, group) => {
  if (!group?.notebookId) return
  const storedGroup = externalizeQuestionGroupImages(group)
  const nbData = readNotebookData(storedGroup.notebookId)
  const index = nbData.questionGroups.findIndex((item) => item.id === storedGroup.id)
  if (index >= 0) nbData.questionGroups[index] = storedGroup
  else nbData.questionGroups.push(storedGroup)
  if (writeNotebookData(storedGroup.notebookId, nbData)) {
    cleanupNotebookImages(storedGroup.notebookId, nbData)
  }
})

ipcMain.handle('storage:deleteQuestionGroup', (_e, notebookId, groupId) => {
  const nbData = readNotebookData(notebookId)
  nbData.questionGroups = nbData.questionGroups.filter((group) => group.id !== groupId)
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

ipcMain.handle('storage:putSnapshot', (_e, notebookId, snapshot) => {
  const nbData = readNotebookData(notebookId)
  const storedSnapshot = {
    ...snapshot,
    data: externalizeEntryImages({ ...snapshot.data, notebookId }),
  }
  const idx = nbData.snapshots.findIndex((s) => s.entryId === storedSnapshot.entryId)
  if (idx >= 0) {
    nbData.snapshots[idx] = storedSnapshot
  } else {
    nbData.snapshots.push(storedSnapshot)
  }
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

ipcMain.handle('storage:getSnapshot', (_e, notebookId, entryId) => {
  const nbData = readNotebookData(notebookId)
  return nbData.snapshots.find((s) => s.entryId === entryId) ?? null
})

ipcMain.handle('storage:getAllSnapshots', (_e, notebookId) => {
  return readNotebookData(notebookId).snapshots
})

ipcMain.handle('storage:deleteSnapshot', (_e, notebookId, entryId) => {
  const nbData = readNotebookData(notebookId)
  nbData.snapshots = nbData.snapshots.filter((s) => s.entryId !== entryId)
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

ipcMain.handle('storage:deleteAllSnapshots', (_e, notebookId) => {
  const nbData = readNotebookData(notebookId)
  nbData.snapshots = []
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

ipcMain.handle('images:save', (_event, notebookId, bytes, mimeType) => {
  return saveImageBytes(notebookId, bytes, mimeType)
})

// ── Review log handlers ──────────────────────────────────────────

ipcMain.handle('storage:getAllReviewLogs', (_e, notebookId) => {
  return readNotebookData(notebookId).reviewLogs || []
})

ipcMain.handle('storage:addReviewLog', (_e, notebookId, log) => {
  const nbData = readNotebookData(notebookId)
  if (!nbData.reviewLogs) nbData.reviewLogs = []
  nbData.reviewLogs.push(log)
  writeNotebookData(notebookId, nbData)
})

ipcMain.handle('storage:deleteReviewLogsByEntry', (_e, notebookId, entryId) => {
  const nbData = readNotebookData(notebookId)
  nbData.reviewLogs = (nbData.reviewLogs || []).filter((l) => l.entryId !== entryId)
  writeNotebookData(notebookId, nbData)
})

// ── Notebook handlers ─────────────────────────────────────────────

ipcMain.handle('storage:getAllNotebooks', () => {
  return readNotebooksMeta()
})

ipcMain.handle('storage:putNotebook', (_e, notebook) => {
  const notebooks = readNotebooksMeta()
  const idx = notebooks.findIndex((n) => n.id === notebook.id)
  if (idx >= 0) {
    notebooks[idx] = notebook
  } else {
    notebooks.push(notebook)
  }
  writeNotebooksMeta(notebooks)
})

ipcMain.handle('storage:deleteNotebook', (_e, id) => {
  const notebooks = readNotebooksMeta()
  writeNotebooksMeta(notebooks.filter((n) => n.id !== id))

  // Remove the per-notebook data file
  const nbPath = getNotebookDataPath(id)
  try {
    if (fs.existsSync(nbPath)) fs.unlinkSync(nbPath)
  } catch (err) {
    log.warn(`删除笔记本文件失败: ${nbPath}`, err)
  }

  try {
    pluginRegistry.deleteNotebookData(getDataDir(), id)
  } catch (err) {
    log.warn(`删除错题本插件数据失败: ${id}`, err)
  }

  const notebookImagesDir = path.join(getImagesDir(), id)
  try {
    if (fs.existsSync(notebookImagesDir)) fs.rmSync(notebookImagesDir, { recursive: true })
  } catch (err) {
    log.warn(`Failed to delete notebook images: ${id}`, err)
  }
})

ipcMain.handle('storage:getDataDir', () => getDataDir())

ipcMain.handle('storage:setDataDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择数据保存目录',
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return getDataDir()
  const newDir = result.filePaths[0]
  const oldDir = getDataDir()

  // Copy all notebook data files to new directory
  try {
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true })

    const oldMetaPath = path.join(oldDir, 'notebooks.json')
    if (fs.existsSync(oldMetaPath)) {
      fs.copyFileSync(oldMetaPath, path.join(newDir, 'notebooks.json'))
    }

    const files = fs.readdirSync(oldDir)
    for (const f of files) {
      if (f.startsWith('notebook_') && f.endsWith('.json')) {
        fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f))
      }
    }

    const oldImagesDir = path.join(oldDir, 'images')
    if (fs.existsSync(oldImagesDir)) {
      fs.cpSync(oldImagesDir, path.join(newDir, 'images'), { recursive: true })
    }
  } catch (err) {
    log.warn('复制数据文件到新目录失败', err)
  }

  dataDir = newDir
  saveConfig()
  return newDir
})

ipcMain.handle('storage:exportAll', () => {
  const notebooks = readNotebooksMeta()
  const allEntries = []
  for (const nb of notebooks) {
    const nbData = readNotebookData(nb.id)
    allEntries.push(...nbData.entries)
  }
  return JSON.stringify(allEntries, null, 2)
})

ipcMain.handle('storage:importAll', (_e, notebookId, entries) => {
  const nbData = readNotebookData(notebookId)
  const existingIds = new Set(nbData.entries.map((e) => e.id))
  for (const entry of entries) {
    if (!existingIds.has(entry.id)) {
      nbData.entries.push(externalizeEntryImages({ ...entry, notebookId }))
      existingIds.add(entry.id)
    }
  }
  if (writeNotebookData(notebookId, nbData)) cleanupNotebookImages(notebookId, nbData)
})

// ── Archive export (.ctb) ────────────────────────────────────────────

function copyReferencedImagesForExport(entry, archiveImagesDir, fields = IMAGE_FIELDS) {
  const copied = new Set()
  const copyImage = (source) => {
    const relativePath = normalizeRelativeImagePath(source)
    if (!relativePath) return source
    if (copied.has(relativePath)) return relativePath
    const sourcePath = imageAbsolutePath(relativePath)
    if (!fs.existsSync(sourcePath)) return relativePath
    const archiveRelativePath = relativePath.slice('images/'.length)
    const destinationPath = path.join(archiveImagesDir, ...archiveRelativePath.split('/'))
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    fs.copyFileSync(sourcePath, destinationPath)
    copied.add(relativePath)
    return relativePath
  }

  for (const field of fields) {
    const html = normalizeImageUrls(entry[field] || '')
    entry[field] = html
    const sourcePattern = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi
    let match
    while ((match = sourcePattern.exec(html))) {
      const relativePath = normalizeRelativeImagePath(match[1])
      if (relativePath) copyImage(relativePath)
    }
  }
  if (entry.drawings && typeof entry.drawings === 'object') {
    entry.drawings = Object.fromEntries(
      Object.entries(entry.drawings).map(([field, source]) => [field, copyImage(source)]),
    )
  }
  if (typeof entry.drawing === 'string') entry.drawing = copyImage(entry.drawing)
}

function mimeTypeFromFilename(filename) {
  const extension = path.extname(filename).slice(1).toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'bmp') return 'image/bmp'
  return null
}

function importArchiveImages(importData, extractedImagesDir) {
  if (!fs.existsSync(extractedImagesDir)) return
  const extractedRoot = path.resolve(extractedImagesDir)
  const importedPaths = new Map()

  const importImage = (source, notebookId) => {
    const relativePath = normalizeRelativeImagePath(source)
    if (!relativePath) return source
    let archiveSource = path.resolve(
      extractedRoot,
      ...relativePath.slice('images/'.length).split('/'),
    )
    if (!archiveSource.startsWith(extractedRoot + path.sep)) return source
    if (!fs.existsSync(archiveSource)) {
      archiveSource = path.resolve(extractedRoot, path.basename(relativePath))
    }
    if (!archiveSource.startsWith(extractedRoot + path.sep) || !fs.existsSync(archiveSource)) {
      return source
    }

    const cacheKey = `${notebookId}:${archiveSource}`
    let storedPath = importedPaths.get(cacheKey)
    if (!storedPath) {
      const mimeType = mimeTypeFromFilename(archiveSource)
      if (!mimeType) return source
      storedPath = saveImageBytes(notebookId, fs.readFileSync(archiveSource), mimeType)
      importedPaths.set(cacheKey, storedPath)
    }
    return storedPath
  }

  for (const entry of importData.entries || []) {
    if (!entry.notebookId) continue
    for (const field of IMAGE_FIELDS) {
      if (typeof entry[field] !== 'string') continue
      entry[field] = normalizeImageUrls(entry[field]).replace(
        /(<img\b[^>]*?\bsrc=["'])(images\/[^"']+)(["'][^>]*>)/gi,
        (match, prefix, relativePath, suffix) => {
          const storedPath = importImage(relativePath, entry.notebookId)
          if (storedPath === relativePath) return match
          return `${prefix}${storedPath}${suffix}`
        },
      )
    }
    if (entry.drawings && typeof entry.drawings === 'object') {
      entry.drawings = Object.fromEntries(
        Object.entries(entry.drawings).map(([field, source]) => [
          field,
          importImage(source, entry.notebookId),
        ]),
      )
    }
    if (typeof entry.drawing === 'string') {
      entry.drawing = importImage(entry.drawing, entry.notebookId)
    }
  }
  for (const group of importData.questionGroups || []) {
    if (!group.notebookId || typeof group.material !== 'string') continue
    group.material = normalizeImageUrls(group.material).replace(
      /(<img\b[^>]*?\bsrc=["'])(images\/[^"']+)(["'][^>]*>)/gi,
      (match, prefix, relativePath, suffix) => {
        const storedPath = importImage(relativePath, group.notebookId)
        return storedPath === relativePath ? match : `${prefix}${storedPath}${suffix}`
      },
    )
    if (group.drawings && typeof group.drawings === 'object') {
      group.drawings = Object.fromEntries(
        Object.entries(group.drawings).map(([field, source]) => [
          field,
          importImage(source, group.notebookId),
        ]),
      )
    }
  }
}

function countFilesRecursively(directory) {
  if (!fs.existsSync(directory)) return 0
  let count = 0
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    count += item.isDirectory() ? countFilesRecursively(path.join(directory, item.name)) : 1
  }
  return count
}

function safeExtractZip(zip, destDir) {
  const entries = zip.getEntries()
  for (const entry of entries) {
    // Skip directories — adm-zip handles them via getData
    if (entry.isDirectory) {
      const dirPath = path.resolve(destDir, entry.entryName)
      if (
        !dirPath.startsWith(path.resolve(destDir) + path.sep) &&
        dirPath !== path.resolve(destDir)
      ) {
        throw new Error(`Path traversal detected: ${entry.entryName}`)
      }
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
      continue
    }
    // Validate the resolved path stays within destDir
    const resolved = path.resolve(destDir, entry.entryName)
    const destResolved = path.resolve(destDir)
    if (!resolved.startsWith(destResolved + path.sep)) {
      throw new Error(`Path traversal detected: ${entry.entryName}`)
    }
    // Ensure parent directory exists
    const parent = path.dirname(resolved)
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
    // Write file
    fs.writeFileSync(resolved, entry.getData())
  }
}

// ── Merge helpers ─────────────────────────────────────────────────────

function mergeArrayWithMap(currentArray, importedArray, processItem) {
  const map = new Map(currentArray.map((item) => [item.id, item]))
  let importedCount = 0

  for (const item of importedArray) {
    const processed = processItem ? processItem(item) : item
    map.set(processed.id, processed)
    importedCount++
  }

  return { mergedArray: Array.from(map.values()), importedCount }
}

function mergeImportedData(importData, keepReviewState) {
  // Merge notebooks into notebooks.json
  const currentNotebooks = readNotebooksMeta()
  const safeImportNb = importData.notebooks || []

  const { mergedArray: finalNotebooks } = mergeArrayWithMap(currentNotebooks, safeImportNb)
  writeNotebooksMeta(finalNotebooks)

  // Build entryId → notebookId lookup for review log routing
  const entryNotebookMap = new Map()

  // Group imported entries by notebookId
  const entriesByNotebook = new Map()
  const safeImportEntries = Array.isArray(importData.entries) ? importData.entries : []
  let importedCount = 0

  for (const item of safeImportEntries) {
    const cloned = structuredClone(item)
    if (!keepReviewState) {
      cloned.masteryLevel = 0
      cloned.consecutivePasses = 0
      delete cloned.nextReviewDate
      delete cloned.lastReviewDate
    }
    const nbId = cloned.notebookId || '__orphan__'
    if (!entriesByNotebook.has(nbId)) entriesByNotebook.set(nbId, [])
    entriesByNotebook.get(nbId).push(cloned)
    entryNotebookMap.set(cloned.id, nbId)
    importedCount++
  }

  // Merge entries into each notebook file
  for (const [nbId, entries] of entriesByNotebook) {
    if (nbId === '__orphan__') continue
    const nbData = readNotebookData(nbId)
    const { mergedArray: mergedEntries } = mergeArrayWithMap(nbData.entries, entries)
    nbData.entries = mergedEntries
    writeNotebookData(nbId, nbData)
  }

  const groupsByNotebook = new Map()
  for (const group of importData.questionGroups || []) {
    if (!group.notebookId) continue
    if (!groupsByNotebook.has(group.notebookId)) groupsByNotebook.set(group.notebookId, [])
    groupsByNotebook.get(group.notebookId).push(group)
  }
  for (const [nbId, groups] of groupsByNotebook) {
    const nbData = readNotebookData(nbId)
    const { mergedArray } = mergeArrayWithMap(nbData.questionGroups || [], groups)
    nbData.questionGroups = mergedArray
    writeNotebookData(nbId, nbData)
  }

  // Merge review logs only when keeping review state
  let importedLogs = 0
  if (keepReviewState) {
    const logsByNotebook = new Map()
    const safeImportLogs = importData.reviewLogs || []
    for (const log of safeImportLogs) {
      const nbId = entryNotebookMap.get(log.entryId)
      if (nbId && nbId !== '__orphan__') {
        if (!logsByNotebook.has(nbId)) logsByNotebook.set(nbId, [])
        logsByNotebook.get(nbId).push(log)
        importedLogs++
      }
    }
    for (const [nbId, logs] of logsByNotebook) {
      const nbData = readNotebookData(nbId)
      const { mergedArray: mergedLogs } = mergeArrayWithMap(nbData.reviewLogs || [], logs)
      nbData.reviewLogs = mergedLogs
      writeNotebookData(nbId, nbData)
    }
  }

  return { importedCount, importedLogs }
}

ipcMain.handle('storage:exportArchive', async () => {
  // Aggregate data from all notebooks
  const notebooks = readNotebooksMeta()
  const allEntries = []
  const allReviewLogs = []
  const allQuestionGroups = []
  for (const nb of notebooks) {
    const nbData = readNotebookData(nb.id)
    allEntries.push(...nbData.entries)
    allReviewLogs.push(...(nbData.reviewLogs || []))
    allQuestionGroups.push(...(nbData.questionGroups || []))
  }

  if (allEntries.length === 0) {
    return { success: false, message: '暂无错题可导出' }
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出错题本归档',
    defaultPath: `cuotiben_${Date.now()}.ctb`,
    filters: [
      { name: '错题本归档', extensions: ['ctb'] },
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, message: '已取消导出' }
  }

  const tmpDir = path.join(getDataDir(), '.tmp_export')
  try {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
    fs.mkdirSync(tmpDir, { recursive: true })

    const imagesDir = path.join(tmpDir, 'images')
    fs.mkdirSync(imagesDir, { recursive: true })

    const exportData = JSON.parse(
      JSON.stringify({
        notebooks,
        entries: allEntries,
        reviewLogs: allReviewLogs,
        questionGroups: allQuestionGroups,
      }),
    )

    for (const entry of exportData.entries) {
      copyReferencedImagesForExport(entry, imagesDir)
    }
    for (const group of exportData.questionGroups) {
      copyReferencedImagesForExport(group, imagesDir, ['material'])
    }

    const dataJsonPath = path.join(tmpDir, 'data.json')
    fs.writeFileSync(dataJsonPath, JSON.stringify(exportData, null, 2), 'utf-8')

    const zip = new AdmZip()
    zip.addLocalFile(dataJsonPath)
    zip.addLocalFolder(imagesDir, 'images')
    zip.writeZip(result.filePath)

    const entryCount = exportData.entries.length
    const imageCount = countFilesRecursively(imagesDir)
    log.info(`导出归档: ${result.filePath} (${entryCount} 条错题, ${imageCount} 张图片)`)

    return { success: true, message: `已导出 ${entryCount} 条错题`, count: entryCount }
  } catch (err) {
    log.error('导出归档失败', err)
    return { success: false, message: '导出失败：无法创建归档文件' }
  } finally {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
    } catch {
      /* cleanup failed, ignore */
    }
  }
})

ipcMain.handle('storage:importArchive', async (_e, keepReviewState) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入错题本归档',
    filters: [{ name: '错题本归档', extensions: ['ctb', 'zip'] }],
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '已取消导入' }
  }

  const filePath = result.filePaths[0]
  const tmpDir = path.join(getDataDir(), '.tmp_import')

  try {
    // Clean and recreate temp dir
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
    fs.mkdirSync(tmpDir, { recursive: true })

    // Extract archive (safe: validates each entry path against zip slip)
    const zip = new AdmZip(filePath)
    safeExtractZip(zip, tmpDir)

    const dataJsonPath = path.join(tmpDir, 'data.json')
    if (!fs.existsSync(dataJsonPath)) {
      return { success: false, message: '导入失败：归档中缺少 data.json' }
    }

    const raw = fs.readFileSync(dataJsonPath, 'utf-8')
    const importData = JSON.parse(raw)

    if (!importData.entries || !Array.isArray(importData.entries)) {
      return { success: false, message: '导入失败：数据格式不正确' }
    }

    // Copy archived image files into the data directory and keep relative links in HTML.
    const imagesDir = path.join(tmpDir, 'images')
    importArchiveImages(importData, imagesDir)
    importData.entries = importData.entries.map((entry) => externalizeEntryImages(entry))
    importData.questionGroups = (importData.questionGroups || []).map((group) =>
      externalizeQuestionGroupImages(group),
    )

    // Merge into per-notebook files
    const { importedCount, importedLogs } = mergeImportedData(importData, keepReviewState)

    log.info(`导入归档: ${filePath} (${importedCount} 条错题, ${importedLogs} 条复习记录)`)

    return {
      success: true,
      message: `成功导入 ${importedCount} 条错题` + (!keepReviewState ? ' (已重置进度)' : ''),
      count: importedCount,
    }
  } catch (err) {
    log.error('导入归档失败', err)
    return { success: false, message: '导入失败：无法解析归档文件' }
  } finally {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })
    } catch {
      /* cleanup failed, ignore */
    }
  }
})

function getVocabularyRoot(notebookId) {
  return vocabulary.getArchivesRoot(getDataDir(), notebookId)
}

ipcMain.handle('plugins:isInstalled', (_event, notebookId, pluginId) => {
  return pluginRegistry
    .listInstalled(getDataDir(), notebookId)
    .some((item) => item.pluginId === pluginId)
})

ipcMain.handle('plugins:listInstalled', (_event, notebookId) => {
  return pluginRegistry.listInstalled(getDataDir(), notebookId)
})

ipcMain.handle('plugins:install', (_event, notebookId, pluginId) => {
  return pluginRegistry.install(getDataDir(), notebookId, pluginId)
})

ipcMain.handle('plugins:uninstall', (_event, notebookId, pluginId, deleteData) => {
  pluginRegistry.uninstall(getDataDir(), notebookId, pluginId, !!deleteData)
})

ipcMain.handle('vocabulary:openAnkiDeckLibrary', () => {
  return shell.openExternal('https://ankiweb.net/shared/decks')
})

ipcMain.handle('vocabulary:inspectApkg', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入 Anki 单词包',
    filters: [{ name: 'Anki 单词包', extensions: ['apkg'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    pendingVocabularyImportPath = null
    return { canceled: true }
  }
  const filePath = path.resolve(result.filePaths[0])
  pendingVocabularyImportPath = filePath
  return { canceled: false, filePath, inspection: await vocabulary.inspectApkg(filePath) }
})

ipcMain.handle(
  'vocabulary:archiveApkg',
  async (_event, notebookId, filePath, archiveName, mappings) => {
    const requestedPath = path.resolve(String(filePath || ''))
    if (!pendingVocabularyImportPath || requestedPath !== pendingVocabularyImportPath) {
      throw new Error('请重新选择要导入的 APKG 文件')
    }
    try {
      return await vocabulary.archiveApkg(
        requestedPath,
        getVocabularyRoot(notebookId),
        archiveName,
        mappings || {},
      )
    } finally {
      pendingVocabularyImportPath = null
    }
  },
)
ipcMain.handle('vocabulary:listArchives', (_event, notebookId) =>
  vocabulary.listArchives(getVocabularyRoot(notebookId)),
)
ipcMain.handle('vocabulary:loadArchive', (_event, notebookId, archiveId) =>
  vocabulary.loadArchive(getVocabularyRoot(notebookId), archiveId),
)
ipcMain.handle('vocabulary:createArchive', (_event, notebookId, name) =>
  vocabulary.createArchive(getVocabularyRoot(notebookId), name),
)
ipcMain.handle('vocabulary:saveArchive', (_event, notebookId, archiveId, archive) =>
  vocabulary.saveArchive(getVocabularyRoot(notebookId), archiveId, archive),
)
ipcMain.handle('vocabulary:deleteArchive', (_event, notebookId, archiveId) =>
  vocabulary.deleteArchive(getVocabularyRoot(notebookId), archiveId),
)
ipcMain.handle('vocabulary:loadProgress', (_event, notebookId, archiveId) =>
  vocabulary.loadProgress(getVocabularyRoot(notebookId), archiveId),
)
ipcMain.handle('vocabulary:saveProgress', (_event, notebookId, archiveId, progress) =>
  vocabulary.saveProgress(getVocabularyRoot(notebookId), archiveId, progress),
)
ipcMain.handle('vocabulary:readAudio', (_event, notebookId, archiveId, filename) =>
  vocabulary.readAudio(getVocabularyRoot(notebookId), archiveId, filename),
)

function createWindow() {
  // Run one-time migration from old single-file format
  try {
    migrateFromSingleFile()
    migrateStoredBase64Images()
  } catch (err) {
    log.error('迁移检查失败', err)
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '错题本',
    show: false,
    icon: path.join(__dirname, '..', 'dist', 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  Menu.setApplicationMenu(null)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  protocol.handle(IMAGE_SCHEME, (request) => {
    try {
      const requestUrl = new URL(request.url)
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '')
      const absolutePath = imageAbsolutePath(relativePath)
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        return new Response('Image not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(absolutePath).toString())
    } catch (err) {
      log.warn('Rejected image request', err)
      return new Response('Invalid image path', { status: 400 })
    }
  })
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
