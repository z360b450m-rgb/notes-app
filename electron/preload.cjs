// ===================================================================
// @AI-ENVIRONMENT-RULES: Electron 预加载脚本 (Preload Bridge)
//
// 本文件运行在 preload 上下文, 是主进程与渲染进程之间唯一的安全桥梁。
// 通过 contextBridge.exposeInMainWorld 将有限的 API 暴露给 Vue 前端。
//
// ■ 环境约束：
//   1. 可以访问 Node.js API (require) 和部分 Electron API (ipcRenderer)。
//   2. 不能访问完整的 DOM (没有 document.body 等), 但可以访问 window。
//   3. 暴露的 API 挂载在 window.electronAPI 上, 通过 ipcRenderer.invoke
//      与主进程通信。
//
// ■ 安全边界 (CRITICAL) —— 这是安全防护的咽喉点：
//   1. 主进程 (main.cjs) 新增的每个 ipcMain.handle, 必须在此处添加
//      对应的 contextBridge 暴露函数, 否则渲染进程无法调用。
//   2. 绝不能直接暴露 ipcRenderer 给渲染进程 —— 只暴露命名的函数。
//   3. 严禁在 Vue 前端代码中直接 require('electron') 或 require
//      Node.js 核心模块 (fs, path, os 等)。所有跨进程通信必须通过
//      此处定义的 electronAPI 接口。
//   4. 此处暴露的每个函数都是攻击面 —— 需确保对应的 ipcMain handler
//      在主进程中做了权限校验。
//
// ■ API 契约：
//   1. 此处定义的函数签名是渲染进程与主进程之间的契约 —— 不可随意
//      删除或重命名已有方法, 只能追加新方法。
//   2. 所有通信使用 ipcRenderer.invoke (异步) 而非 ipcRenderer.send
//      (单向), 确保错误能正确传递到调用方。
//
// ■ 修改前必读文件：
//   - electron/main.cjs (主进程 IPC 处理程序)
//   - src/services/db.ts (渲染进程数据库访问层, 通过 window.electronAPI 调用)
// ===================================================================
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Storage API — notebookId required for per-notebook sharding
  getAll: (notebookId) => ipcRenderer.invoke('storage:getAll', notebookId),
  get: (notebookId, id) => ipcRenderer.invoke('storage:get', notebookId, id),
  put: (entry) => ipcRenderer.invoke('storage:put', entry),
  delete: (notebookId, id) => ipcRenderer.invoke('storage:delete', notebookId, id),

  putSnapshot: (notebookId, snapshot) =>
    ipcRenderer.invoke('storage:putSnapshot', notebookId, snapshot),
  getSnapshot: (notebookId, entryId) =>
    ipcRenderer.invoke('storage:getSnapshot', notebookId, entryId),
  getAllSnapshots: (notebookId) => ipcRenderer.invoke('storage:getAllSnapshots', notebookId),
  deleteSnapshot: (notebookId, entryId) =>
    ipcRenderer.invoke('storage:deleteSnapshot', notebookId, entryId),
  deleteAllSnapshots: (notebookId) => ipcRenderer.invoke('storage:deleteAllSnapshots', notebookId),

  getDataDir: () => ipcRenderer.invoke('storage:getDataDir'),
  setDataDir: () => ipcRenderer.invoke('storage:setDataDir'),

  exportAll: () => ipcRenderer.invoke('storage:exportAll'),
  importAll: (notebookId, entries) => ipcRenderer.invoke('storage:importAll', notebookId, entries),

  exportArchive: () => ipcRenderer.invoke('storage:exportArchive'),
  importArchive: (keepReviewState) => ipcRenderer.invoke('storage:importArchive', keepReviewState),

  // Review log API
  getAllReviewLogs: (notebookId) => ipcRenderer.invoke('storage:getAllReviewLogs', notebookId),
  addReviewLog: (notebookId, log) => ipcRenderer.invoke('storage:addReviewLog', notebookId, log),
  deleteReviewLogsByEntry: (notebookId, entryId) =>
    ipcRenderer.invoke('storage:deleteReviewLogsByEntry', notebookId, entryId),

  // Desktop capture
  getDesktopSources: () => ipcRenderer.invoke('desktop:getSources'),

  // Migration
  isIndexedDBMigrated: () => ipcRenderer.invoke('storage:isIndexedDBMigrated'),
  markIndexedDBMigrated: () => ipcRenderer.invoke('storage:markIndexedDBMigrated'),

  // Notebook API
  getAllNotebooks: () => ipcRenderer.invoke('storage:getAllNotebooks'),
  putNotebook: (notebook) => ipcRenderer.invoke('storage:putNotebook', notebook),
  deleteNotebook: (id) => ipcRenderer.invoke('storage:deleteNotebook', id),

  // Notebook plugin API
  isNotebookPluginInstalled: (notebookId, pluginId) =>
    ipcRenderer.invoke('plugins:isInstalled', notebookId, pluginId),
  listNotebookPlugins: (notebookId) => ipcRenderer.invoke('plugins:listInstalled', notebookId),
  installNotebookPlugin: (notebookId, pluginId) =>
    ipcRenderer.invoke('plugins:install', notebookId, pluginId),
  uninstallNotebookPlugin: (notebookId, pluginId, deleteData) =>
    ipcRenderer.invoke('plugins:uninstall', notebookId, pluginId, deleteData),

  // Vocabulary API
  openAnkiDeckLibrary: () => ipcRenderer.invoke('vocabulary:openAnkiDeckLibrary'),
  inspectApkg: () => ipcRenderer.invoke('vocabulary:inspectApkg'),
  archiveApkg: (notebookId, filePath, archiveName, mappings) =>
    ipcRenderer.invoke('vocabulary:archiveApkg', notebookId, filePath, archiveName, mappings),
  listVocabularyArchives: (notebookId) => ipcRenderer.invoke('vocabulary:listArchives', notebookId),
  loadVocabularyArchive: (notebookId, archiveId) =>
    ipcRenderer.invoke('vocabulary:loadArchive', notebookId, archiveId),
  createVocabularyArchive: (notebookId, name) =>
    ipcRenderer.invoke('vocabulary:createArchive', notebookId, name),
  saveVocabularyArchive: (notebookId, archiveId, archive) =>
    ipcRenderer.invoke('vocabulary:saveArchive', notebookId, archiveId, archive),
  deleteVocabularyArchive: (notebookId, archiveId) =>
    ipcRenderer.invoke('vocabulary:deleteArchive', notebookId, archiveId),
  loadVocabularyProgress: (notebookId, archiveId) =>
    ipcRenderer.invoke('vocabulary:loadProgress', notebookId, archiveId),
  saveVocabularyProgress: (notebookId, archiveId, progress) =>
    ipcRenderer.invoke('vocabulary:saveProgress', notebookId, archiveId, progress),
  readVocabularyAudio: (notebookId, archiveId, filename) =>
    ipcRenderer.invoke('vocabulary:readAudio', notebookId, archiveId, filename),
})
