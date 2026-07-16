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
const { app, BrowserWindow, Menu, ipcMain, dialog, desktopCapturer, shell } = require('electron')
const path = require('path')
const fs = require('fs')
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
    if (!fs.existsSync(filePath)) return { entries: [], snapshots: [], reviewLogs: [] }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!data.entries) data.entries = []
    if (!data.snapshots) data.snapshots = []
    if (!data.reviewLogs) data.reviewLogs = []
    return data
  } catch (err) {
    log.error(`读取错题本 ${notebookId} 失败`, err)
    return { entries: [], snapshots: [], reviewLogs: [] }
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
  } catch (err) {
    log.error(`写入错题本 ${notebookId} 失败`, err)
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
  const nbData = readNotebookData(entry.notebookId)
  const idx = nbData.entries.findIndex((e) => e.id === entry.id)
  if (idx >= 0) {
    nbData.entries[idx] = entry
  } else {
    nbData.entries.push(entry)
  }
  writeNotebookData(entry.notebookId, nbData)
})

ipcMain.handle('storage:delete', (_e, notebookId, id) => {
  const nbData = readNotebookData(notebookId)
  nbData.entries = nbData.entries.filter((e) => e.id !== id)
  writeNotebookData(notebookId, nbData)
})

ipcMain.handle('storage:putSnapshot', (_e, notebookId, snapshot) => {
  const nbData = readNotebookData(notebookId)
  const idx = nbData.snapshots.findIndex((s) => s.entryId === snapshot.entryId)
  if (idx >= 0) {
    nbData.snapshots[idx] = snapshot
  } else {
    nbData.snapshots.push(snapshot)
  }
  writeNotebookData(notebookId, nbData)
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
  writeNotebookData(notebookId, nbData)
})

ipcMain.handle('storage:deleteAllSnapshots', (_e, notebookId) => {
  const nbData = readNotebookData(notebookId)
  nbData.snapshots = []
  writeNotebookData(notebookId, nbData)
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
      nbData.entries.push(entry)
      existingIds.add(entry.id)
    }
  }
  writeNotebookData(notebookId, nbData)
})

// ── Archive export (.ctb) ────────────────────────────────────────────

const IMG_RE = /<img[^>]+src="data:image\/(png|jpeg|jpg|gif|webp);base64,([^"]+)"/gi

function extractImages(html) {
  const images = []
  let index = 0

  const replaced = html.replace(IMG_RE, (_match, ext, b64) => {
    const mimeExt = ext === 'jpeg' ? 'jpg' : ext
    const filename = `img_${index}_${Date.now().toString(36)}.${mimeExt}`
    images.push({ filename, data: Buffer.from(b64, 'base64') })
    index++
    return _match.replace(/src="data:image\/[^"]+"/i, `src="images/${filename}"`)
  })

  return { html: replaced, images }
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

function restoreImages(html, imagesDir) {
  return html.replace(/<img[^>]+src="images\/([^"]+)"[^>]*>/gi, (match, filename) => {
    const safeFilename = path.basename(filename)
    const imgPath = path.join(imagesDir, safeFilename)
    if (!fs.existsSync(imgPath)) return match
    const buf = fs.readFileSync(imgPath)
    const ext = path.extname(safeFilename).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    const b64 = buf.toString('base64')
    return match.replace(/src="images\/[^"]+"/i, `src="data:image/${mime};base64,${b64}"`)
  })
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
  for (const nb of notebooks) {
    const nbData = readNotebookData(nb.id)
    allEntries.push(...nbData.entries)
    allReviewLogs.push(...(nbData.reviewLogs || []))
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
      }),
    )

    for (const entry of exportData.entries) {
      for (const field of ['question', 'wrongAnswer', 'correctAnswer']) {
        const html = entry[field] || ''
        const { html: replaced, images } = extractImages(html)
        entry[field] = replaced
        for (const img of images) {
          fs.writeFileSync(path.join(imagesDir, img.filename), img.data)
        }
      }
    }

    const dataJsonPath = path.join(tmpDir, 'data.json')
    fs.writeFileSync(dataJsonPath, JSON.stringify(exportData, null, 2), 'utf-8')

    const zip = new AdmZip()
    zip.addLocalFile(dataJsonPath)
    zip.addLocalFolder(imagesDir, 'images')
    zip.writeZip(result.filePath)

    const entryCount = exportData.entries.length
    const imageCount = fs.readdirSync(imagesDir).length
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

    // Restore base64 images from images/ folder
    const imagesDir = path.join(tmpDir, 'images')
    if (fs.existsSync(imagesDir)) {
      for (const entry of importData.entries) {
        for (const field of ['question', 'wrongAnswer', 'correctAnswer']) {
          if (
            entry[field] &&
            typeof entry[field] === 'string' &&
            entry[field].includes('images/')
          ) {
            entry[field] = restoreImages(entry[field], imagesDir)
          }
        }
      }
    }

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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
