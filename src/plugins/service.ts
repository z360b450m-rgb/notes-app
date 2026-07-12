import type { NotebookPluginInstallation } from './types'

export const notebookPluginService = {
  async listInstalled(notebookId: string): Promise<NotebookPluginInstallation[]> {
    const listPlugins = window.electronAPI?.listNotebookPlugins
    if (!listPlugins) throw new Error('当前应用版本不支持插件系统，请安装最新版')
    return listPlugins(notebookId)
  },

  async install(notebookId: string, pluginId: string): Promise<void> {
    const installPlugin = window.electronAPI?.installNotebookPlugin
    if (!installPlugin) throw new Error('当前应用版本不支持安装插件，请安装最新版')
    await installPlugin(notebookId, pluginId)
  },

  async uninstall(notebookId: string, pluginId: string, deleteData: boolean): Promise<void> {
    const uninstallPlugin = window.electronAPI?.uninstallNotebookPlugin
    if (!uninstallPlugin) throw new Error('当前应用版本不支持卸载插件，请安装最新版')
    await uninstallPlugin(notebookId, pluginId, deleteData)
  },
}
