import type {
  VocabularyArchive,
  VocabularyDailyPlan,
  VocabularyFieldMapping,
  VocabularyProgressItem,
  VocabularySessionMode,
  VocabularySessionProgress,
  VocabularySettings,
} from './types'

export interface VocabularyArchiveSummary extends Omit<VocabularyArchive, 'words'> {
  wordCount: number
}

export interface ApkgInspection {
  sourceFilename: string
  collectionName: string
  models: VocabularyArchive['models']
  decks: VocabularyArchive['decks']
  mappings: Record<string, VocabularyFieldMapping>
  noteCount: number
}

export interface VocabularyProgress {
  archiveId: string
  updatedAt: number
  words: Record<string, VocabularyProgressItem>
  sessions: Partial<Record<VocabularySessionMode, VocabularySessionProgress>>
  settings: VocabularySettings
  dailyPlan?: VocabularyDailyPlan
}

function toIpcData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const vocabularyService = {
  async isInstalled(notebookId: string): Promise<boolean> {
    return (
      window.electronAPI?.isNotebookPluginInstalled?.(notebookId, 'english-vocabulary') ?? false
    )
  },

  async install(notebookId: string): Promise<void> {
    await window.electronAPI?.installNotebookPlugin?.(notebookId, 'english-vocabulary')
  },

  async list(notebookId: string): Promise<VocabularyArchiveSummary[]> {
    return window.electronAPI?.listVocabularyArchives?.(notebookId) ?? []
  },

  async inspect(): Promise<{ canceled?: boolean; filePath?: string; inspection?: ApkgInspection }> {
    if (!window.electronAPI?.inspectApkg) throw new Error('请在桌面版中导入 APKG 文件')
    return window.electronAPI.inspectApkg()
  },

  async archive(
    notebookId: string,
    filePath: string,
    archiveName: string,
    mappings: Record<string, VocabularyFieldMapping>,
  ) {
    if (!window.electronAPI?.archiveApkg) throw new Error('请在桌面版中导入 APKG 文件')
    return window.electronAPI.archiveApkg(notebookId, filePath, archiveName, toIpcData(mappings))
  },

  async load(notebookId: string, archiveId: string): Promise<VocabularyArchive | null> {
    return window.electronAPI?.loadVocabularyArchive?.(notebookId, archiveId) ?? null
  },

  async delete(notebookId: string, archiveId: string): Promise<void> {
    const deleteArchive = window.electronAPI?.deleteVocabularyArchive
    if (!deleteArchive) throw new Error('当前应用版本不支持删除词库，请安装最新版')
    await deleteArchive(notebookId, archiveId)
  },

  async loadProgress(notebookId: string, archiveId: string): Promise<VocabularyProgress> {
    return (
      (await window.electronAPI?.loadVocabularyProgress?.(notebookId, archiveId)) ?? {
        archiveId,
        updatedAt: Date.now(),
        words: {},
        sessions: {},
        settings: {
          dailyNewWordLimit: 20,
          correctIntervalsDays: [1, 3, 7, 14, 30],
          wrongRetryMinutes: 10,
        },
      }
    )
  },

  async saveProgress(
    notebookId: string,
    archiveId: string,
    progress: VocabularyProgress,
  ): Promise<void> {
    await window.electronAPI?.saveVocabularyProgress?.(notebookId, archiveId, toIpcData(progress))
  },

  async getAudioUrl(
    notebookId: string,
    archiveId: string,
    filename: string,
  ): Promise<string | null> {
    const audio = await window.electronAPI?.readVocabularyAudio?.(notebookId, archiveId, filename)
    return audio ? `data:${audio.mime};base64,${audio.data}` : null
  },
}
