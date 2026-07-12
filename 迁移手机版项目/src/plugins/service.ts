import type { NotebookPluginInstallation } from './types'

export const notebookPluginService = {
  async listInstalled(notebookId: string): Promise<NotebookPluginInstallation[]> {
    const listPlugins = window.electronAPI?.listNotebookPlugins
    if (listPlugins) return listPlugins(notebookId)
    return localStorage.getItem(`cuotiben:plugin:${notebookId}:english-vocabulary`) === '1'
      ? [
          {
            notebookId,
            pluginId: 'english-vocabulary',
            version: '1.0.0',
            enabled: true,
            installedAt: Date.now(),
            settings: {},
          },
        ]
      : []
  },

  async install(notebookId: string, pluginId: string): Promise<void> {
    const installPlugin = window.electronAPI?.installNotebookPlugin
    if (installPlugin) return installPlugin(notebookId, pluginId)
    localStorage.setItem(`cuotiben:plugin:${notebookId}:${pluginId}`, '1')
  },

  async uninstall(notebookId: string, pluginId: string, deleteData: boolean): Promise<void> {
    const uninstallPlugin = window.electronAPI?.uninstallNotebookPlugin
    if (uninstallPlugin) return uninstallPlugin(notebookId, pluginId, deleteData)
    localStorage.removeItem(`cuotiben:plugin:${notebookId}:${pluginId}`)
  },
}
