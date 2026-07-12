import type { NotebookPluginManifest } from './types'
import { englishVocabularyPlugin } from './english-vocabulary/manifest'

export const notebookPlugins: NotebookPluginManifest[] = [englishVocabularyPlugin]

export function getNotebookPlugin(pluginId: string) {
  return notebookPlugins.find((plugin) => plugin.id === pluginId) ?? null
}
