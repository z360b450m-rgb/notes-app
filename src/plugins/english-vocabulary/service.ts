import type {
  VocabularyArchive,
  VocabularyDailyPlan,
  VocabularyFieldMapping,
  VocabularyProgressItem,
  VocabularySessionMode,
  VocabularySessionProgress,
  VocabularySettings,
} from './types'
import {
  archiveBrowserApkg,
  createBrowserArchive,
  deleteBrowserArchive,
  getBrowserAudioUrl,
  inspectBrowserApkg,
  listBrowserArchives,
  loadBrowserArchive,
  loadBrowserProgress,
  saveBrowserProgress,
  saveBrowserArchive,
} from './browserStore'

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
    return window.electronAPI?.listVocabularyArchives
      ? window.electronAPI.listVocabularyArchives(notebookId)
      : listBrowserArchives(notebookId)
  },

  async inspect(): Promise<{ canceled?: boolean; filePath?: string; inspection?: ApkgInspection }> {
    return window.electronAPI?.inspectApkg ? window.electronAPI.inspectApkg() : inspectBrowserApkg()
  },

  async archive(
    notebookId: string,
    filePath: string,
    archiveName: string,
    mappings: Record<string, VocabularyFieldMapping>,
  ) {
    return window.electronAPI?.archiveApkg
      ? window.electronAPI.archiveApkg(notebookId, filePath, archiveName, toIpcData(mappings))
      : archiveBrowserApkg(notebookId, filePath, archiveName, toIpcData(mappings))
  },

  async load(notebookId: string, archiveId: string): Promise<VocabularyArchive | null> {
    return window.electronAPI?.loadVocabularyArchive
      ? window.electronAPI.loadVocabularyArchive(notebookId, archiveId)
      : loadBrowserArchive(notebookId, archiveId)
  },

  async createArchive(notebookId: string, name: string): Promise<VocabularyArchive> {
    return window.electronAPI?.createVocabularyArchive
      ? window.electronAPI.createVocabularyArchive(notebookId, name)
      : createBrowserArchive(notebookId, name)
  },

  async saveArchive(
    notebookId: string,
    archiveId: string,
    archive: VocabularyArchive,
  ): Promise<void> {
    const data = toIpcData(archive)
    if (window.electronAPI?.saveVocabularyArchive)
      return window.electronAPI.saveVocabularyArchive(notebookId, archiveId, data)
    await saveBrowserArchive(notebookId, data)
  },

  async delete(notebookId: string, archiveId: string): Promise<void> {
    const deleteArchive = window.electronAPI?.deleteVocabularyArchive
    if (deleteArchive) return deleteArchive(notebookId, archiveId)
    await deleteBrowserArchive(notebookId, archiveId)
  },

  async loadProgress(notebookId: string, archiveId: string): Promise<VocabularyProgress> {
    return (
      (await (window.electronAPI?.loadVocabularyProgress
        ? window.electronAPI.loadVocabularyProgress(notebookId, archiveId)
        : loadBrowserProgress(notebookId, archiveId))) ?? {
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
    if (window.electronAPI?.saveVocabularyProgress)
      return window.electronAPI.saveVocabularyProgress(notebookId, archiveId, toIpcData(progress))
    await saveBrowserProgress(notebookId, archiveId, toIpcData(progress))
  },

  async getAudioUrl(
    notebookId: string,
    archiveId: string,
    filename: string,
  ): Promise<string | null> {
    if (!window.electronAPI?.readVocabularyAudio)
      return getBrowserAudioUrl(notebookId, archiveId, filename)
    const audio = await window.electronAPI.readVocabularyAudio(notebookId, archiveId, filename)
    return audio ? `data:${audio.mime};base64,${audio.data}` : null
  },
}
