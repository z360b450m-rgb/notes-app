interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
}

type VocabularyArchive = import('@/plugins/english-vocabulary/types').VocabularyArchive
type VocabularyFieldMapping = import('@/plugins/english-vocabulary/types').VocabularyFieldMapping
type ApkgInspection = import('@/plugins/english-vocabulary/service').ApkgInspection
type VocabularyArchiveSummary =
  import('@/plugins/english-vocabulary/service').VocabularyArchiveSummary
type VocabularyProgress = import('@/plugins/english-vocabulary/service').VocabularyProgress
type NotebookPluginInstallation = import('@/plugins/types').NotebookPluginInstallation

interface Window {
  electronAPI?: {
    platform: string
    getAll: (notebookId: string) => Promise<any[]>
    get: (notebookId: string, id: string) => Promise<any | null>
    put: (entry: any) => Promise<void>
    delete: (notebookId: string, id: string) => Promise<void>
    putSnapshot: (notebookId: string, snapshot: any) => Promise<void>
    getSnapshot: (notebookId: string, entryId: string) => Promise<any | null>
    getAllSnapshots: (notebookId: string) => Promise<any[]>
    deleteSnapshot: (notebookId: string, entryId: string) => Promise<void>
    deleteAllSnapshots: (notebookId: string) => Promise<void>
    getDataDir: () => Promise<string>
    setDataDir: () => Promise<string>
    exportAll: () => Promise<string>
    importAll: (notebookId: string, entries: any[]) => Promise<void>
    exportArchive: () => Promise<{ success: boolean; message: string; count?: number }>
    importArchive: (
      keepReviewState: boolean,
    ) => Promise<{ success: boolean; message: string; count?: number }>
    getAllReviewLogs: (notebookId: string) => Promise<any[]>
    addReviewLog: (notebookId: string, log: any) => Promise<void>
    deleteReviewLogsByEntry: (notebookId: string, entryId: string) => Promise<void>
    getAllNotebooks: () => Promise<any[]>
    putNotebook: (notebook: any) => Promise<void>
    deleteNotebook: (id: string) => Promise<void>
    getDesktopSources: () => Promise<DesktopSource[]>
    isNotebookPluginInstalled?: (notebookId: string, pluginId: string) => Promise<boolean>
    listNotebookPlugins?: (notebookId: string) => Promise<NotebookPluginInstallation[]>
    installNotebookPlugin?: (notebookId: string, pluginId: string) => Promise<void>
    uninstallNotebookPlugin?: (
      notebookId: string,
      pluginId: string,
      deleteData: boolean,
    ) => Promise<void>
    openAnkiDeckLibrary?: () => Promise<void>
    inspectApkg?: () => Promise<{
      canceled?: boolean
      filePath?: string
      inspection?: ApkgInspection
    }>
    archiveApkg?: (
      notebookId: string,
      filePath: string,
      archiveName: string,
      mappings: Record<string, VocabularyFieldMapping>,
    ) => Promise<VocabularyArchive>
    listVocabularyArchives?: (notebookId: string) => Promise<VocabularyArchiveSummary[]>
    loadVocabularyArchive?: (
      notebookId: string,
      archiveId: string,
    ) => Promise<VocabularyArchive | null>
    createVocabularyArchive?: (notebookId: string, name: string) => Promise<VocabularyArchive>
    saveVocabularyArchive?: (
      notebookId: string,
      archiveId: string,
      archive: VocabularyArchive,
    ) => Promise<void>
    deleteVocabularyArchive?: (notebookId: string, archiveId: string) => Promise<void>
    loadVocabularyProgress?: (notebookId: string, archiveId: string) => Promise<VocabularyProgress>
    saveVocabularyProgress?: (
      notebookId: string,
      archiveId: string,
      progress: VocabularyProgress,
    ) => Promise<void>
    readVocabularyAudio?: (
      notebookId: string,
      archiveId: string,
      filename: string,
    ) => Promise<{ mime: string; data: string } | null>
  }
}
