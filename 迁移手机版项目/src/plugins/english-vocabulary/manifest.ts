import VocabularyPanel from './VocabularyPanel.vue'
import type { NotebookPluginManifest } from '../types'

export const ENGLISH_VOCABULARY_PLUGIN_ID = 'english-vocabulary'

export const englishVocabularyPlugin: NotebookPluginManifest = {
  id: ENGLISH_VOCABULARY_PLUGIN_ID,
  name: '语言学习',
  version: '1.0.0',
  description: '导入 Anki 词库，进行背词、拼写和释义训练',
  capabilities: ['file-import', 'local-storage', 'audio-playback'],
  component: VocabularyPanel,
}
