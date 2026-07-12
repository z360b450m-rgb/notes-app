const englishVocabulary = require('./english-vocabulary/main.cjs')

const plugins = new Map([
  [
    'english-vocabulary',
    {
      id: 'english-vocabulary',
      module: englishVocabulary,
    },
  ],
])

function getPlugin(pluginId) {
  const plugin = plugins.get(String(pluginId || ''))
  if (!plugin) throw new Error('未知插件')
  return plugin
}

function listInstalled(dataRoot, notebookId) {
  return Array.from(plugins.values())
    .map((plugin) => plugin.module.getInstallation(dataRoot, notebookId))
    .filter((installation) => installation?.enabled)
}

function install(dataRoot, notebookId, pluginId) {
  return getPlugin(pluginId).module.install(dataRoot, notebookId)
}

function uninstall(dataRoot, notebookId, pluginId, deleteData) {
  return getPlugin(pluginId).module.uninstall(dataRoot, notebookId, deleteData)
}

function deleteNotebookData(dataRoot, notebookId) {
  for (const plugin of plugins.values()) plugin.module.deleteNotebookData(dataRoot, notebookId)
}

module.exports = {
  getPlugin,
  listInstalled,
  install,
  uninstall,
  deleteNotebookData,
}
