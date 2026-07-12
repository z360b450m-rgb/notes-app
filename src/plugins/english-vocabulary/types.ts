export type VocabularyReviewMode = 'zh-to-en' | 'en-to-zh'
export type VocabularySessionMode = 'learn' | VocabularyReviewMode

export interface ApkgFieldDefinition {
  name: string
  ordinal: number
}

export interface VocabularyFieldMapping {
  word?: number
  phonetic?: number
  meaning?: number
  exampleEn?: number
  exampleZh?: number
  note?: number
  details?: number
  audio?: number
}

export interface VocabularyWord {
  id: string
  noteId: number
  deckId: number
  modelId: number
  fields: string[]
  word: string
  phonetic: string
  meaning: string
  exampleEn: string
  exampleZh: string
  note: string
  details?: string
  audioFiles: string[]
  tags: string[]
}

export interface VocabularyArchive {
  id: string
  name: string
  sourceFilename: string
  importedAt: number
  decks: Array<{ id: number; name: string }>
  models: Array<{ id: number; name: string; fields: ApkgFieldDefinition[] }>
  mappings: Record<string, VocabularyFieldMapping>
  words: VocabularyWord[]
}

export interface VocabularyProgressItem {
  wordId: string
  dueAt: number
  correctCount: number
  wrongCount: number
  consecutiveCorrect?: number
  intervalDays?: number
  lastReviewedAt?: number
  lastMode?: VocabularyReviewMode
  updatedAt: number
}

export interface VocabularySessionProgress {
  mode: VocabularySessionMode
  date?: string
  currentWordId: string
  currentIndex: number
  sessionOrder: string[]
  completedWordIds: string[]
  startedAt: number
  updatedAt: number
}

export interface VocabularyDailyPlan {
  date: string
  wordIds: string[]
  newWordIds: string[]
  dueWordIds: string[]
  createdAt: number
}

export interface VocabularySettings {
  dailyNewWordLimit: number
  correctIntervalsDays: number[]
  wrongRetryMinutes: number
}

export interface VocabularyMistake {
  archiveId: string
  archiveName: string
  mode: VocabularyReviewMode
  answer: string
  word: VocabularyWord
}
