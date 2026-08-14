import type { NoteEntry, Notebook, QuestionGroup, ReviewLog } from '@/types'

export interface EntrySnapshot {
  entryId: string
  data: NoteEntry
  savedAt: number
}

export interface EntryRepository {
  getAll(notebookId: string): Promise<NoteEntry[]>
  get(notebookId: string, entryId: string): Promise<NoteEntry | undefined>
  put(notebookId: string, entry: NoteEntry): Promise<void>
  delete(notebookId: string, entryId: string): Promise<void>
  putSnapshot(notebookId: string, entryId: string, data: NoteEntry): Promise<void>
  getSnapshot(notebookId: string, entryId: string): Promise<EntrySnapshot | undefined>
  getAllSnapshots(notebookId: string): Promise<EntrySnapshot[]>
  deleteSnapshot(notebookId: string, entryId: string): Promise<void>
  deleteAllSnapshots(notebookId: string): Promise<void>
}

export interface NotebookRepository {
  getAll(): Promise<Notebook[]>
  put(notebook: Notebook): Promise<void>
  delete(notebookId: string): Promise<void>
}

export interface QuestionGroupRepository {
  getAll(notebookId: string): Promise<QuestionGroup[]>
  get(notebookId: string, groupId: string): Promise<QuestionGroup | undefined>
  put(notebookId: string, group: QuestionGroup): Promise<void>
  delete(notebookId: string, groupId: string): Promise<void>
}

export interface ReviewLogRepository {
  getAll(notebookId: string): Promise<ReviewLog[]>
  add(notebookId: string, log: ReviewLog): Promise<void>
  deleteByEntry(notebookId: string, entryId: string): Promise<void>
}
