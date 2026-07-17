<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useVocabularySpeech } from './useSpeech'
import { vocabularyService } from './service'
import type { ApkgInspection, VocabularyArchiveSummary, VocabularyProgress } from './service'
import type {
  VocabularyArchive,
  VocabularyFieldMapping,
  VocabularyMistake,
  VocabularyReviewMode,
  VocabularySessionMode,
  VocabularyWord,
} from './types'

const props = defineProps<{
  notebookId: string
  notebookName: string
  archiveMistake: (mistake: VocabularyMistake) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()
const archives = ref<VocabularyArchiveSummary[]>([])
const archive = ref<VocabularyArchive | null>(null)
const progress = ref<VocabularyProgress | null>(null)
const inspection = ref<ApkgInspection | null>(null)
const importPath = ref('')
const importName = ref('')
const mappings = ref<Record<string, VocabularyFieldMapping>>({})
const view = ref<'library' | 'words' | 'learn' | 'review'>('library')
const reviewMode = ref<VocabularyReviewMode>('zh-to-en')
const sessionWords = ref<VocabularyWord[]>([])
const currentIndex = ref(0)
const answer = ref('')
const checked = ref(false)
const submittedAnswerCorrect = ref(false)
const revealed = ref(false)
const busy = ref(false)
const message = ref('')
const sessionComplete = ref(false)
const wordSearch = ref('')
const wordPage = ref(1)
const wordsPerPage = 50
const { speak, stop } = useVocabularySpeech()

const currentWord = computed(() => sessionWords.value[currentIndex.value] ?? null)
const sessionMode = computed<VocabularySessionMode>(() =>
  view.value === 'learn' ? 'learn' : reviewMode.value,
)
const completedCount = computed(() => Object.keys(progress.value?.words ?? {}).length)
const dueCount = computed(() => {
  const now = Date.now()
  return (
    archive.value?.words.filter((word) => (progress.value?.words[word.id]?.dueAt ?? 0) <= now)
      .length ?? 0
  )
})
const todayPlanCount = computed(() => progress.value?.dailyPlan?.wordIds.length ?? 0)
const todayNewCount = computed(() => progress.value?.dailyPlan?.newWordIds.length ?? 0)
const todayDueCount = computed(() => progress.value?.dailyPlan?.dueWordIds.length ?? 0)
const translationRetryCount = computed(() => {
  const baseIds = new Set(progress.value?.dailyPlan?.wordIds ?? [])
  return (
    archive.value?.words.filter((word) => {
      const item = progress.value?.words[word.id]
      return !!item && item.dueAt <= Date.now() && !baseIds.has(word.id)
    }).length ?? 0
  )
})
const curveSettingsOpen = ref(false)
const deleteArchiveOpen = ref(false)
const deletingArchive = ref(false)
const newArchiveOpen = ref(false)
const newArchiveName = ref('')
const addWordOpen = ref(false)
const editingWordId = ref<string | null>(null)
const deleteWordOpen = ref(false)
const deletingWord = ref<VocabularyWord | null>(null)
const wordDraft = ref({
  word: '',
  phonetic: '',
  meaning: '',
  exampleEn: '',
  exampleZh: '',
  note: '',
  details: '',
  tags: '',
})
const curveIntervalsDraft = ref<number[]>([])
const wrongRetryDraft = ref(10)
const todayPreviewOpen = ref(false)
const todayPlanWords = computed(() => {
  if (!archive.value) return []
  const wordsById = new Map(archive.value.words.map((word) => [word.id, word]))
  return (progress.value?.dailyPlan?.wordIds ?? [])
    .map((id) => wordsById.get(id))
    .filter((word): word is VocabularyWord => !!word)
})
const todayModeProgress = computed(() => {
  const planIds = progress.value?.dailyPlan?.wordIds ?? []
  return (['learn', 'zh-to-en', 'en-to-zh'] as VocabularySessionMode[]).map((mode) => {
    const session = progress.value?.sessions[mode]
    const completed = new Set(
      session?.date === localDateKey() ? (session.completedWordIds ?? []) : [],
    )
    return {
      mode,
      completed: planIds.filter((id) => completed.has(id)).length,
      total: planIds.length,
    }
  })
})
const futureReviewBuckets = computed(() => {
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0]
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 86400000
  for (const item of Object.values(progress.value?.words ?? {})) {
    if (item.dueAt <= Date.now()) continue
    const dayOffset = Math.max(0, Math.floor((item.dueAt - todayStart) / dayMs))
    buckets[Math.min(dayOffset, 7)] += 1
  }
  return buckets
})
const filteredVocabularyWords = computed(() => {
  if (!archive.value) return []
  const query = wordSearch.value.trim().toLowerCase()
  if (!query) return archive.value.words
  return archive.value.words.filter((word) =>
    [plainText(word.word), plainText(word.meaning), plainText(word.phonetic), word.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
})
const wordPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredVocabularyWords.value.length / wordsPerPage)),
)
const pagedVocabularyWords = computed(() => {
  const start = (wordPage.value - 1) * wordsPerPage
  return filteredVocabularyWords.value.slice(start, start + wordsPerPage)
})
const fieldTargets = [
  ['word', '英语单词'],
  ['phonetic', '音标'],
  ['meaning', '中文释义'],
  ['exampleEn', '英语例句'],
  ['exampleZh', '例句翻译'],
  ['note', '注释/扩展'],
  ['details', '答案后详解'],
  ['audio', '发音音频'],
] as const

function cleanHtml(value: string) {
  return DOMPurify.sanitize(value || '', { USE_PROFILES: { html: true } })
}

function plainText(value: string) {
  const element = document.createElement('div')
  element.innerHTML = cleanHtml(value)
  return (element.textContent || '').replace(/\[sound:[^\]]+\]/gi, '').trim()
}

async function reloadArchives() {
  archives.value = await vocabularyService.list(props.notebookId)
}

async function beginImport() {
  message.value = ''
  try {
    const result = await vocabularyService.inspect()
    if (result.canceled || !result.filePath || !result.inspection) return
    importPath.value = result.filePath
    importName.value = result.inspection.sourceFilename.replace(/\.apkg$/i, '').trim()
    inspection.value = result.inspection
    mappings.value = structuredClone(result.inspection.mappings)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法读取 APKG 文件'
  }
}

async function createArchive() {
  const name = newArchiveName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    archive.value = await vocabularyService.createArchive(props.notebookId, name)
    progress.value = await vocabularyService.loadProgress(props.notebookId, archive.value.id)
    newArchiveName.value = ''
    newArchiveOpen.value = false
    view.value = 'library'
    await reloadArchives()
    await ensureDailyPlan(true)
    message.value = `已新建词库“${name}”`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '新建词库失败'
  } finally {
    busy.value = false
  }
}

function openAddWord() {
  editingWordId.value = null
  wordDraft.value = {
    word: '',
    phonetic: '',
    meaning: '',
    exampleEn: '',
    exampleZh: '',
    note: '',
    details: '',
    tags: '',
  }
  addWordOpen.value = true
}

function openEditWord(word: VocabularyWord) {
  editingWordId.value = word.id
  wordDraft.value = {
    word: plainText(word.word), phonetic: plainText(word.phonetic), meaning: plainText(word.meaning),
    exampleEn: plainText(word.exampleEn), exampleZh: plainText(word.exampleZh), note: plainText(word.note),
    details: plainText(word.details || ''), tags: word.tags.join(', '),
  }
  addWordOpen.value = true
}

async function addWord() {
  if (!archive.value || !wordDraft.value.word.trim() || !wordDraft.value.meaning.trim()) return
  const now = Date.now()
  const draft = wordDraft.value
  const wordData = {
    noteId: now,
    deckId: 0,
    modelId: 0,
    fields: [],
    word: draft.word.trim(),
    phonetic: draft.phonetic.trim(),
    meaning: draft.meaning.trim(),
    exampleEn: draft.exampleEn.trim(),
    exampleZh: draft.exampleZh.trim(),
    note: draft.note.trim(),
    details: draft.details.trim(),
    audioFiles: [],
    tags: draft.tags
      .split(/[，,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  }
  const existingIndex = editingWordId.value
    ? archive.value.words.findIndex((word) => word.id === editingWordId.value)
    : -1
  const original = existingIndex >= 0 ? archive.value.words[existingIndex] : null
  const word = { id: original?.id ?? `manual-${now}-${Math.random().toString(36).slice(2, 8)}`, ...wordData }
  if (existingIndex >= 0) archive.value.words.splice(existingIndex, 1, word)
  else archive.value.words.push(word)
  try {
    await vocabularyService.saveArchive(props.notebookId, archive.value.id, archive.value)
    if (!editingWordId.value && progress.value) {
      const plan = progress.value.dailyPlan
      if (plan?.date === localDateKey() && !plan.wordIds.includes(word.id)) {
        plan.newWordIds.push(word.id)
        plan.wordIds.push(word.id)
        await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
      } else await ensureDailyPlan(true)
    }
    await reloadArchives()
    addWordOpen.value = false
    message.value = editingWordId.value ? `已更新单词“${draft.word.trim()}”` : `已添加单词“${draft.word.trim()}”`
    editingWordId.value = null
  } catch (error) {
    if (existingIndex >= 0 && original) archive.value.words.splice(existingIndex, 1, original)
    else archive.value.words.pop()
    message.value = error instanceof Error ? error.message : '保存单词失败'
  }
}

async function confirmDeleteWord() {
  if (!archive.value || !deletingWord.value) return
  const word = deletingWord.value
  const index = archive.value.words.findIndex((item) => item.id === word.id)
  if (index < 0) return
  archive.value.words.splice(index, 1)
  try {
    await vocabularyService.saveArchive(props.notebookId, archive.value.id, archive.value)
    if (progress.value) {
      delete progress.value.words[word.id]
      for (const session of Object.values(progress.value.sessions)) {
        if (!session) continue
        session.sessionOrder = session.sessionOrder.filter((id) => id !== word.id)
        session.completedWordIds = session.completedWordIds.filter((id) => id !== word.id)
      }
      const plan = progress.value.dailyPlan
      if (plan) {
        plan.wordIds = plan.wordIds.filter((id) => id !== word.id)
        plan.newWordIds = plan.newWordIds.filter((id) => id !== word.id)
        plan.dueWordIds = plan.dueWordIds.filter((id) => id !== word.id)
      }
      await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
    }
    sessionWords.value = sessionWords.value.filter((item) => item.id !== word.id)
    currentIndex.value = Math.min(currentIndex.value, Math.max(0, sessionWords.value.length - 1))
    deletingWord.value = null
    deleteWordOpen.value = false
    await reloadArchives()
    message.value = `已删除单词“${plainText(word.word)}”`
  } catch (error) {
    archive.value.words.splice(index, 0, word)
    message.value = error instanceof Error ? error.message : '删除单词失败'
  }
}

async function openAnkiDeckLibrary() {
  if (!window.electronAPI?.openAnkiDeckLibrary) {
    window.open('https://ankiweb.net/shared/decks', '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await window.electronAPI.openAnkiDeckLibrary()
  } catch {
    message.value = '无法打开 Anki 词库资源库'
  }
}

async function confirmImport() {
  if (!importPath.value || !importName.value.trim()) return
  busy.value = true
  message.value = '正在归档词库和音频...'
  try {
    archive.value = await vocabularyService.archive(
      props.notebookId,
      importPath.value,
      importName.value.trim(),
      mappings.value,
    )
    progress.value = await vocabularyService.loadProgress(props.notebookId, archive.value.id)
    inspection.value = null
    await reloadArchives()
    message.value = `已归档 ${archive.value.words.length} 个词条`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '归档失败'
  } finally {
    busy.value = false
  }
}

async function openArchive(id: string) {
  stop()
  archive.value = await vocabularyService.load(props.notebookId, id)
  progress.value = await vocabularyService.loadProgress(props.notebookId, id)
  view.value = 'library'
  sessionWords.value = []
  sessionComplete.value = false
  await ensureDailyPlan()
}

async function confirmDeleteArchive() {
  if (!archive.value || deletingArchive.value) return
  deletingArchive.value = true
  const deletedName = archive.value.name
  try {
    stop()
    await vocabularyService.delete(props.notebookId, archive.value.id)
    archive.value = null
    progress.value = null
    sessionWords.value = []
    currentIndex.value = 0
    answer.value = ''
    checked.value = false
    submittedAnswerCorrect.value = false
    sessionComplete.value = false
    view.value = 'library'
    await reloadArchives()
    deleteArchiveOpen.value = false
    if (archives.value[0]) await openArchive(archives.value[0].id)
    message.value = `词库“${deletedName}”已删除`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '删除词库失败，请重试'
  } finally {
    deletingArchive.value = false
  }
}

function localDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function ensureDailyPlan(force = false) {
  if (!archive.value || !progress.value) return
  const date = localDateKey()
  if (!force && progress.value.dailyPlan?.date === date) return
  const now = Date.now()
  const learnedIds = new Set([
    ...Object.keys(progress.value.words),
    ...(progress.value.sessions.learn?.completedWordIds ?? []),
  ])
  const dueWordIds = archive.value.words
    .filter((word) => {
      const item = progress.value?.words[word.id]
      return !!item && item.dueAt <= now
    })
    .map((word) => word.id)
  const dailyLimit = Math.max(1, Math.min(500, progress.value.settings.dailyNewWordLimit))
  const newWordIds = archive.value.words
    .filter((word) => !learnedIds.has(word.id))
    .slice(0, dailyLimit)
    .map((word) => word.id)
  progress.value.dailyPlan = {
    date,
    dueWordIds,
    newWordIds,
    wordIds: Array.from(new Set([...dueWordIds, ...newWordIds])),
    createdAt: Date.now(),
  }
  await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
}

async function saveDailyLimit() {
  if (!archive.value || !progress.value) return
  progress.value.settings.dailyNewWordLimit = Math.max(
    1,
    Math.min(500, Math.round(progress.value.settings.dailyNewWordLimit || 20)),
  )
  await ensureDailyPlan(true)
  message.value = `每日新学数量已设为 ${progress.value.settings.dailyNewWordLimit}`
}

async function saveCurveSettings() {
  if (!archive.value || !progress.value) return
  progress.value.settings.correctIntervalsDays = curveIntervalsDraft.value.map((value) =>
    Math.max(1, Math.min(3650, Math.round(Number(value) || 1))),
  )
  progress.value.settings.wrongRetryMinutes = Math.max(
    1,
    Math.min(10080, Math.round(Number(wrongRetryDraft.value) || 10)),
  )
  await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
  message.value = '复习曲线设置已保存'
  curveSettingsOpen.value = false
}

function openCurveSettings() {
  if (!progress.value) return
  curveIntervalsDraft.value = [...progress.value.settings.correctIntervalsDays]
  wrongRetryDraft.value = progress.value.settings.wrongRetryMinutes
  curveSettingsOpen.value = true
}

function scheduleLearnedWord(wordId: string) {
  if (!progress.value || progress.value.words[wordId]) return
  const firstInterval = progress.value.settings.correctIntervalsDays[0] ?? 1
  const now = Date.now()
  progress.value.words[wordId] = {
    wordId,
    dueAt: now + firstInterval * 86400000,
    correctCount: 0,
    wrongCount: 0,
    consecutiveCorrect: 0,
    intervalDays: firstInterval,
    lastReviewedAt: now,
    updatedAt: now,
  }
}

async function startTodaySession(nextView: 'learn' | 'review', mode?: VocabularyReviewMode) {
  if (!archive.value || !progress.value) return
  await ensureDailyPlan()
  if (mode) reviewMode.value = mode
  const targetMode: VocabularySessionMode = nextView === 'learn' ? 'learn' : reviewMode.value
  const basePlanIds = progress.value.dailyPlan?.wordIds ?? []
  const retryIds =
    nextView === 'review'
      ? archive.value.words
          .filter((word) => {
            const item = progress.value?.words[word.id]
            return !!item && item.dueAt <= Date.now()
          })
          .map((word) => word.id)
      : []
  const planIds = Array.from(new Set([...basePlanIds, ...retryIds]))
  const wordsById = new Map(archive.value.words.map((word) => [word.id, word]))
  sessionWords.value = planIds
    .map((id) => wordsById.get(id))
    .filter((word): word is VocabularyWord => !!word)
  if (!sessionWords.value.length) {
    message.value = '今天没有待学习或待复习的单词'
    return
  }
  const previous = progress.value.sessions[targetMode]
  const samePlan =
    previous?.date === progress.value.dailyPlan?.date &&
    previous?.sessionOrder.length === planIds.length &&
    previous.sessionOrder.every((id, index) => id === planIds[index])
  const completedIds = new Set(previous?.completedWordIds ?? [])
  if (
    nextView === 'review' &&
    samePlan &&
    planIds.length > 0 &&
    planIds.every((id) => completedIds.has(id))
  ) {
    sessionComplete.value = true
    view.value = nextView
    return
  }
  currentIndex.value = samePlan
    ? Math.min(previous.currentIndex, Math.max(0, sessionWords.value.length - 1))
    : 0
  answer.value = ''
  checked.value = false
  submittedAnswerCorrect.value = false
  revealed.value = false
  sessionComplete.value = false
  view.value = nextView
  await saveSessionProgress()
}

async function previewTodayWord(wordId: string) {
  await startTodaySession('learn')
  const targetIndex = sessionWords.value.findIndex((word) => word.id === wordId)
  if (targetIndex < 0) return
  currentIndex.value = targetIndex
  answer.value = ''
  checked.value = false
  submittedAnswerCorrect.value = false
  revealed.value = false
  sessionComplete.value = false
  await saveSessionProgress()
}

async function saveSessionProgress(completedWordId?: string) {
  if (!archive.value || !progress.value || !sessionWords.value.length) return
  const mode = sessionMode.value
  const stored = progress.value.sessions?.[mode]
  const previous = stored?.date === localDateKey() ? stored : undefined
  const completedWordIds = new Set(previous?.completedWordIds ?? [])
  if (completedWordId) completedWordIds.add(completedWordId)
  progress.value.sessions = progress.value.sessions || {}
  progress.value.sessions[mode] = {
    mode,
    date: localDateKey(),
    currentWordId: currentWord.value?.id ?? '',
    currentIndex: currentIndex.value,
    sessionOrder: sessionWords.value.map((word) => word.id),
    completedWordIds: Array.from(completedWordIds),
    startedAt: previous?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
}

async function nextWord() {
  if (!sessionWords.value.length || !currentWord.value) return
  const completedWordId = currentWord.value.id
  if (view.value === 'learn') scheduleLearnedWord(completedWordId)
  stop()
  if (currentIndex.value >= sessionWords.value.length - 1) {
    if (view.value === 'learn') {
      currentIndex.value = 0
      answer.value = ''
      checked.value = false
      submittedAnswerCorrect.value = false
      revealed.value = false
      await saveSessionProgress(completedWordId)
      return
    }
    await saveSessionProgress(completedWordId)
    sessionComplete.value = true
    return
  }
  currentIndex.value += 1
  answer.value = ''
  checked.value = false
  submittedAnswerCorrect.value = false
  revealed.value = false
  await saveSessionProgress(completedWordId)
}

async function previousWord() {
  if (!sessionWords.value.length || currentIndex.value <= 0) return
  stop()
  currentIndex.value -= 1
  answer.value = ''
  checked.value = false
  submittedAnswerCorrect.value = false
  revealed.value = false
  await saveSessionProgress()
}

function normalizedEnglish(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function chineseKeywords(value: string) {
  return plainText(value)
    .replace(/[a-z]+\./gi, '')
    .split(/[；;，,、/\n（）()]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isAnswerCorrect(input: string, word: VocabularyWord, mode: VocabularyReviewMode) {
  if (mode === 'zh-to-en') {
    return normalizedEnglish(input) === normalizedEnglish(plainText(word.word))
  }
  const normalizedInput = input.normalize('NFKC').trim()
  return chineseKeywords(word.meaning).some(
    (keyword) => keyword.normalize('NFKC').trim() === normalizedInput,
  )
}

const answerCorrect = computed(() => checked.value && submittedAnswerCorrect.value)

async function saveResult(correct: boolean) {
  if (!archive.value || !progress.value || !currentWord.value) return
  const previous = progress.value.words[currentWord.value.id]
  const consecutiveCorrect = correct ? (previous?.consecutiveCorrect ?? 0) + 1 : 0
  const intervals = progress.value.settings.correctIntervalsDays
  const intervalDays = correct
    ? (intervals[Math.min(consecutiveCorrect - 1, intervals.length - 1)] ?? 1)
    : 0
  const now = Date.now()
  progress.value.words[currentWord.value.id] = {
    wordId: currentWord.value.id,
    dueAt:
      now + (correct ? intervalDays * 86400000 : progress.value.settings.wrongRetryMinutes * 60000),
    correctCount: (previous?.correctCount || 0) + Number(correct),
    wrongCount: (previous?.wrongCount || 0) + Number(!correct),
    consecutiveCorrect,
    intervalDays,
    lastReviewedAt: now,
    lastMode: reviewMode.value,
    updatedAt: now,
  }
  await vocabularyService.saveProgress(props.notebookId, archive.value.id, progress.value)
}

async function checkAnswer() {
  if (!answer.value.trim() || !currentWord.value) return
  submittedAnswerCorrect.value = isAnswerCorrect(answer.value, currentWord.value, reviewMode.value)
  checked.value = true
  await saveResult(submittedAnswerCorrect.value)
  await saveSessionProgress(currentWord.value?.id)
  if (!submittedAnswerCorrect.value && archive.value) {
    try {
      await props.archiveMistake({
        archiveId: archive.value.id,
        archiveName: archive.value.name,
        mode: reviewMode.value,
        answer: answer.value,
        word: JSON.parse(JSON.stringify(currentWord.value)),
      })
    } catch {
      message.value = '答案已记录，但归档到错题本失败'
    }
  }
  if (submittedAnswerCorrect.value) await playCurrentAudio()
}

async function playCurrentAudio() {
  if (!archive.value || !currentWord.value) return
  try {
    const filename = currentWord.value.audioFiles[0]
    const audioUrl = filename
      ? await vocabularyService.getAudioUrl(props.notebookId, archive.value.id, filename)
      : null
    await speak(plainText(currentWord.value.word), audioUrl)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法播放读音'
  }
}

function closePanel() {
  stop()
  emit('close')
}

function returnToLibrary() {
  view.value = 'library'
  sessionComplete.value = false
}

function openVocabularyWords() {
  wordSearch.value = ''
  wordPage.value = 1
  view.value = 'words'
}

function updateWordSearch(value: string) {
  wordSearch.value = value
  wordPage.value = 1
}

function wordStatus(wordId: string) {
  const item = progress.value?.words[wordId]
  if (!item) return '未学习'
  if (item.dueAt <= Date.now()) return '待复习'
  return `${new Date(item.dueAt).toLocaleDateString()} 复习`
}

function handleSessionShortcut(event: KeyboardEvent) {
  if (
    event.key !== 'Enter' ||
    event.repeat ||
    event.isComposing ||
    !['learn', 'review'].includes(view.value) ||
    (view.value === 'review' && !checked.value) ||
    sessionComplete.value ||
    busy.value ||
    inspection.value ||
    curveSettingsOpen.value ||
    deleteArchiveOpen.value ||
    newArchiveOpen.value ||
    addWordOpen.value
  )
    return
  event.preventDefault()
  void nextWord()
}

onMounted(() => {
  void reloadArchives()
  window.addEventListener('keydown', handleSessionShortcut)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleSessionShortcut)
  stop()
})
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex bg-[#faf9f5] text-[#141413] dark:bg-[#141413] dark:text-[#faf9f5]"
  >
    <aside
      class="flex w-[250px] flex-shrink-0 flex-col border-r border-[#e8e6dc] bg-white p-5 dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
    >
      <button
        class="mb-7 flex items-center gap-2 text-sm text-[#788c5d] hover:text-[#52633e]"
        @click="closePanel"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回错题本
      </button>
      <h1 class="text-xl font-bold">语言学习</h1>
      <p class="mt-1 truncate text-xs text-[#888]">{{ notebookName }} · 专用复习</p>
      <button
        class="mt-6 flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#d97757] px-4 py-2.5 text-sm font-medium text-[#d97757] hover:bg-[#fdf0e8] dark:hover:bg-[#2e2018]"
        title="使用系统浏览器打开 Anki 词库资源库"
        @click="openAnkiDeckLibrary"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M14 3h7v7" />
          <path d="m10 14 11-11" />
          <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
        </svg>
        Anki 词库资源库
      </button>
      <button
        class="mt-2 flex w-full items-center justify-center gap-2 rounded-[8px] bg-[#d97757] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#c86648]"
        @click="beginImport"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        导入 APKG 词库
      </button>
      <button
        class="mt-2 flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#788c5d] px-4 py-2.5 text-sm font-medium text-[#65784d] hover:bg-[#f3f6ef] dark:hover:bg-[#20251c]"
        @click="newArchiveOpen = true"
      >
        <span class="text-lg leading-none">＋</span>
        新建词库
      </button>
      <div class="mt-6 min-h-0 flex-1 space-y-2 overflow-y-auto">
        <button
          v-for="item in archives"
          :key="item.id"
          class="w-full rounded-[8px] border px-3 py-2 text-left text-sm dark:border-[#333]"
          :class="
            archive?.id === item.id
              ? 'border-[#d97757] bg-[#fdf0e8] dark:bg-[#2e2018]'
              : 'border-[#e8e6dc] hover:bg-[#f5f4ef] dark:hover:bg-[#252523]'
          "
          @click="openArchive(item.id)"
        >
          <span class="block truncate font-medium">{{ item.name }}</span>
          <span class="text-xs text-[#888]">{{ item.wordCount }} 个词条</span>
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <p
        v-if="message"
        class="mx-auto mb-4 max-w-4xl rounded-[8px] bg-[#fdf0e8] px-4 py-3 text-sm text-[#a85335] dark:bg-[#2e2018] dark:text-[#f0c4a8]"
      >
        {{ message }}
      </p>

      <section v-if="!archive" class="mx-auto mt-20 max-w-xl text-center">
        <svg
          class="mx-auto text-[#d97757]"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M4 5.5v16M8 7h8M8 11h8" />
        </svg>
        <h2 class="mt-5 text-2xl font-bold">导入你的 Anki 单词包</h2>
        <p class="mt-3 text-sm leading-7 text-[#777] dark:text-[#aaa]">
          每个 APKG 会保存原文件、词条、模板字段、音频和独立学习进度，不会写入错题数据。
        </p>
      </section>

      <section v-else-if="view === 'library'" class="mx-auto max-w-4xl">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-2xl font-bold">{{ archive.name }}</h2>
            <p class="mt-1 text-sm text-[#888]">
              {{ archive.words.length }} 个词条 · 已练习 {{ completedCount }} · 总待复习
              {{ dueCount }}
            </p>
          </div>
          <label class="flex items-center gap-2 text-sm text-[#777] dark:text-[#aaa]">
            每日新学
            <input
              v-if="progress"
              v-model.number="progress.settings.dailyNewWordLimit"
              type="number"
              min="1"
              max="500"
              class="w-20 rounded-[8px] border border-[#ddd] bg-white px-3 py-2 text-right text-[#141413] outline-none focus:border-[#d97757] dark:border-[#444]"
              @change="saveDailyLimit"
            />
            词
          </label>
          <button
            class="flex items-center gap-2 rounded-[8px] border border-[#ddd] px-3 py-2 text-sm text-[#777] hover:border-[#d97757] hover:text-[#d97757] dark:border-[#444] dark:text-[#aaa]"
            @click="openCurveSettings"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M4 18V9M10 18V5M16 18v-7M22 18V3" />
            </svg>
            复习曲线
          </button>
          <button
            class="flex items-center gap-2 rounded-[8px] border border-[#ddd] px-3 py-2 text-sm text-[#777] hover:border-[#d97757] hover:text-[#d97757] dark:border-[#444] dark:text-[#aaa]"
            @click="openVocabularyWords"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            全部单词
          </button>
          <button
            class="flex items-center gap-2 rounded-[8px] bg-[#788c5d] px-3 py-2 text-sm font-medium text-white hover:bg-[#65784d]"
            @click="openAddWord"
          >
            <span class="text-base leading-none">＋</span>
            新增单词
          </button>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#ddd] text-[#999] hover:border-red-400 hover:bg-red-50 hover:text-red-600 dark:border-[#444] dark:hover:bg-red-950/20"
            title="删除当前词库"
            @click="deleteArchiveOpen = true"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m19 6-1 15H6L5 6" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>
        <div class="mt-6 border-y border-[#e8e6dc] py-5 dark:border-[#333]">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-sm font-semibold">今日复习计划总览</h3>
            <div class="flex gap-5 text-sm text-[#777] dark:text-[#aaa]">
              <span
                >共
                <strong class="text-[#141413] dark:text-[#faf9f5]">{{
                  todayPlanCount
                }}</strong></span
              >
              <span
                >新学
                <strong class="text-[#141413] dark:text-[#faf9f5]">{{
                  todayNewCount
                }}</strong></span
              >
              <span
                >到期
                <strong class="text-[#141413] dark:text-[#faf9f5]">{{
                  todayDueCount
                }}</strong></span
              >
            </div>
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <div
              v-for="item in todayModeProgress"
              :key="item.mode"
              class="border-l-2 border-[#e8e6dc] pl-3 dark:border-[#444]"
            >
              <div class="text-xs text-[#888]">
                {{
                  item.mode === 'learn'
                    ? '今日复习'
                    : item.mode === 'zh-to-en'
                      ? '中 → 英'
                      : '英 → 中'
                }}
              </div>
              <div class="mt-1 text-sm font-medium">{{ item.completed }} / {{ item.total }}</div>
            </div>
          </div>
        </div>
        <div class="mt-5 border-b border-[#e8e6dc] pb-5 dark:border-[#333]">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-sm font-semibold">未来待复习总览</h3>
            <span class="text-xs text-[#888]">后续到期词仅加入中 → 英和英 → 中</span>
          </div>
          <div class="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
            <div v-for="(count, index) in futureReviewBuckets" :key="index" class="text-center">
              <div
                class="flex h-10 items-center justify-center border-b-2 border-[#788c5d]/40 text-sm font-semibold"
              >
                {{ count }}
              </div>
              <div class="mt-1 text-[11px] text-[#888]">
                {{ index === 7 ? '7天后+' : index === 0 ? '今天后续' : `${index}天后` }}
              </div>
            </div>
          </div>
        </div>
        <div class="mt-8 grid gap-4 md:grid-cols-3">
          <button
            class="rounded-[8px] border border-[#e8e6dc] bg-white p-6 text-left hover:border-[#d97757] dark:border-[#333] dark:bg-[#1e1e1c]"
            @click="startTodaySession('learn')"
          >
            <strong class="block text-lg">开始今日复习</strong>
            <span class="mt-2 block text-sm text-[#888]"
              >循环学习今日冻结计划，不加入答错回炉词</span
            >
          </button>
          <button
            class="rounded-[8px] border border-[#e8e6dc] bg-white p-6 text-left hover:border-[#d97757] dark:border-[#333] dark:bg-[#1e1e1c]"
            @click="startTodaySession('review', 'zh-to-en')"
          >
            <strong class="block text-lg">今日中 → 英</strong>
            <span class="mt-2 block text-sm text-[#888]"
              >今日计划 + {{ translationRetryCount }} 个后续回炉词</span
            >
          </button>
          <button
            class="rounded-[8px] border border-[#e8e6dc] bg-white p-6 text-left hover:border-[#d97757] dark:border-[#333] dark:bg-[#1e1e1c]"
            @click="startTodaySession('review', 'en-to-zh')"
          >
            <strong class="block text-lg">今日英 → 中</strong>
            <span class="mt-2 block text-sm text-[#888]"
              >今日计划 + {{ translationRetryCount }} 个后续回炉词</span
            >
          </button>
        </div>
        <div class="mt-4 border-t border-[#e8e6dc] pt-4 dark:border-[#333]">
          <button
            class="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-[#788c5d]"
            type="button"
            :aria-expanded="todayPreviewOpen"
            @click="todayPreviewOpen = !todayPreviewOpen"
          >
            <span>预览今日单词（{{ todayPlanWords.length }}）</span>
            <svg
              class="h-4 w-4 transition-transform"
              :class="{ 'rotate-180': todayPreviewOpen }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div v-if="todayPreviewOpen" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="(word, index) in todayPlanWords"
              :key="word.id"
              class="flex min-w-0 items-center gap-3 rounded-[8px] border border-[#e8e6dc] bg-white px-3 py-2.5 text-left transition hover:border-[#d97757] hover:bg-[#fdfaf6] dark:border-[#333] dark:bg-[#1e1e1c] dark:hover:bg-[#2a2723]"
              type="button"
              @click="previewTodayWord(word.id)"
            >
              <span class="shrink-0 text-xs tabular-nums text-[#999]">{{ index + 1 }}</span>
              <span class="min-w-0">
                <strong class="block truncate text-sm">{{ plainText(word.word) }}</strong>
                <span class="block truncate text-xs text-[#888]">{{ plainText(word.meaning) }}</span>
              </span>
              <svg class="ml-auto h-4 w-4 shrink-0 text-[#b5b5ad]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <p v-if="!todayPlanWords.length" class="text-sm text-[#888]">今天暂时没有安排单词。</p>
          </div>
        </div>
      </section>

      <section v-else-if="view === 'words'" class="mx-auto max-w-5xl">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <button
              class="flex items-center gap-1 text-sm text-[#788c5d]"
              @click="view = 'library'"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              返回词库
            </button>
            <h2 class="text-xl font-bold">全部单词</h2>
            <span class="text-sm text-[#888]"
              >{{ filteredVocabularyWords.length }} / {{ archive.words.length }}</span
            >
          </div>
          <div class="relative w-full max-w-xs">
            <svg
              class="absolute left-3 top-1/2 -translate-y-1/2 text-[#888]"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              :value="wordSearch"
              placeholder="搜索单词、释义、音标或标签"
              class="w-full rounded-[8px] border border-[#ddd] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d97757] dark:border-[#444] dark:bg-[#1e1e1c]"
              @input="updateWordSearch(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div class="mt-5 overflow-hidden border-y border-[#e8e6dc] dark:border-[#333]">
          <div
            class="grid grid-cols-[minmax(130px,1fr)_minmax(180px,2fr)_100px_96px] gap-4 bg-[#f5f4ef] px-4 py-2 text-xs font-semibold text-[#777] dark:bg-[#252523]"
          >
            <span>单词</span><span>释义</span><span>状态</span><span>操作</span>
          </div>
          <div
            v-if="pagedVocabularyWords.length === 0"
            class="py-12 text-center text-sm text-[#888]"
          >
            没有匹配的单词
          </div>
          <div
            v-for="word in pagedVocabularyWords"
            :key="word.id"
            class="grid grid-cols-[minmax(130px,1fr)_minmax(180px,2fr)_100px_96px] gap-4 border-t border-[#e8e6dc] px-4 py-3 text-sm dark:border-[#333]"
          >
            <div class="min-w-0">
              <strong class="block truncate" v-html="cleanHtml(word.word)" /><span
                v-if="word.phonetic"
                class="mt-1 block truncate text-xs text-[#888]"
                v-html="cleanHtml(word.phonetic)"
              />
            </div>
            <div class="preserve-input-format min-w-0 break-words leading-6" v-html="cleanHtml(word.meaning)" />
            <span class="text-xs text-[#888]">{{ wordStatus(word.id) }}</span>
            <div class="flex items-start gap-2 text-xs">
              <button class="text-[#788c5d] hover:underline" @click="openEditWord(word)">编辑</button>
              <button class="text-red-500 hover:underline" @click="deletingWord = word; deleteWordOpen = true">删除</button>
            </div>
          </div>
        </div>
        <div class="mt-4 flex items-center justify-between text-sm text-[#888]">
          <span>第 {{ wordPage }} / {{ wordPageCount }} 页</span>
          <div class="flex gap-2">
            <button
              class="rounded-[8px] border border-[#ddd] px-3 py-1.5 disabled:opacity-40 dark:border-[#444]"
              :disabled="wordPage <= 1"
              @click="wordPage -= 1"
            >
              上一页
            </button>
            <button
              class="rounded-[8px] border border-[#ddd] px-3 py-1.5 disabled:opacity-40 dark:border-[#444]"
              :disabled="wordPage >= wordPageCount"
              @click="wordPage += 1"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="sessionComplete" class="mx-auto mt-20 max-w-lg text-center">
        <svg
          class="mx-auto text-[#788c5d]"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <h2 class="mt-5 text-2xl font-bold">今日训练已完成</h2>
        <p class="mt-2 text-sm text-[#888]">本轮共完成 {{ sessionWords.length }} 个单词</p>
        <button
          class="mt-6 rounded-[8px] bg-[#d97757] px-6 py-2.5 text-white"
          @click="returnToLibrary"
        >
          返回词库
        </button>
      </section>

      <section v-else-if="currentWord" class="relative mx-auto max-w-3xl px-12 sm:px-0">
        <button
          class="absolute left-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#d97757]/30 bg-white/95 text-[#d97757] shadow-lg transition hover:scale-105 hover:bg-[#fdf0e8] disabled:cursor-not-allowed disabled:opacity-30 dark:bg-[#1e1e1c] dark:hover:bg-[#2e2018] sm:-left-16"
          :disabled="currentIndex <= 0"
          title="上一个"
          aria-label="上一个单词"
          @click="previousWord"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button
          class="absolute right-0 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#d97757]/30 bg-white/95 text-[#d97757] shadow-lg transition hover:scale-105 hover:bg-[#fdf0e8] disabled:cursor-not-allowed disabled:opacity-30 dark:bg-[#1e1e1c] dark:hover:bg-[#2e2018] sm:-right-16"
          :disabled="view === 'review' && !checked"
          title="下一个"
          aria-label="下一个单词"
          @click="nextWord"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <div class="mb-5 flex items-center justify-between text-sm">
          <button class="flex items-center gap-1 text-[#788c5d]" @click="view = 'library'">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            返回词库
          </button>
          <span class="text-[#888]">{{ currentIndex + 1 }} / {{ sessionWords.length }}</span>
          <span class="text-xs text-[#888]">今日计划</span>
        </div>
        <div
          class="overflow-hidden rounded-[8px] border border-[#e8e6dc] bg-white shadow-sm dark:border-[#333] dark:bg-[#1e1e1c]"
        >
          <div class="border-b border-[#e8e6dc] px-6 py-8 dark:border-[#333] sm:px-8">
            <div
              v-if="view === 'learn' || reviewMode === 'en-to-zh'"
              class="flex items-center gap-4"
            >
              <h2
                class="preserve-input-format min-w-0 flex-1 break-words text-4xl font-bold"
                v-html="cleanHtml(currentWord.word)"
              />
              <button
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#fdf0e8] text-[#d97757] dark:bg-[#2e2018]"
                title="播放读音"
                @click="playCurrentAudio"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M11 5 6 9H2v6h4l5 4z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18 5a9 9 0 0 1 0 14" />
                </svg>
              </button>
            </div>
            <div
              v-else
              class="preserve-input-format break-words text-2xl font-semibold"
              v-html="cleanHtml(currentWord.meaning)"
            />
            <div
              v-if="view === 'learn' && currentWord.phonetic"
              class="mt-2 text-sm text-[#888]"
              v-html="cleanHtml(currentWord.phonetic)"
            />
          </div>

          <div class="px-6 py-7 sm:px-8">
            <template v-if="view === 'learn'">
              <button
                v-if="!revealed"
                class="w-full rounded-[8px] border border-[#d97757] py-3 text-[#d97757]"
                @click="revealed = true"
              >
                显示翻译和注释
              </button>
              <div v-else class="break-words">
                <div class="space-y-5">
                  <div>
                    <h3 class="mb-2 text-xs font-bold text-[#888]">中文释义</h3>
                    <div class="preserve-input-format leading-7" v-html="cleanHtml(currentWord.meaning)" />
                  </div>
                  <div v-if="currentWord.details">
                    <h3 class="mb-2 text-xs font-bold text-[#888]">答案后详解</h3>
                    <div class="answer-details preserve-input-format text-sm leading-7" v-html="cleanHtml(currentWord.details)" />
                  </div>
                  <div v-if="currentWord.exampleEn">
                    <h3 class="mb-2 text-xs font-bold text-[#888]">英语例句</h3>
                    <div class="preserve-input-format leading-7" v-html="cleanHtml(currentWord.exampleEn)" />
                  </div>
                  <div v-if="currentWord.exampleZh">
                    <h3 class="mb-2 text-xs font-bold text-[#888]">例句翻译</h3>
                    <div class="preserve-input-format leading-7" v-html="cleanHtml(currentWord.exampleZh)" />
                  </div>
                  <div v-if="currentWord.note">
                    <h3 class="mb-2 text-xs font-bold text-[#888]">注释</h3>
                    <div class="preserve-input-format leading-7" v-html="cleanHtml(currentWord.note)" />
                  </div>
                </div>
              </div>
            </template>
            <template v-else>
              <label class="mb-2 block text-sm font-medium">{{
                reviewMode === 'zh-to-en' ? '输入英语单词' : '输入中文意思'
              }}</label>
              <input
                v-model="answer"
                class="w-full rounded-[8px] border border-[#ddd] bg-transparent px-4 py-3 outline-none focus:border-[#d97757] dark:border-[#444]"
                :readonly="checked"
                @keydown.enter.stop.prevent="checked ? nextWord() : checkAnswer()"
              />
              <div
                v-if="checked"
                class="mt-4 space-y-4 rounded-[8px] p-4"
                :class="
                  answerCorrect
                    ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                "
              >
                <strong>{{ answerCorrect ? '回答正确' : '需要再记一次' }}</strong>
                <div>
                  <span class="text-xs opacity-70">你的答案</span>
                  <div class="mt-1 break-words">{{ answer }}</div>
                </div>
                <div>
                  <span class="text-xs opacity-70">正确答案</span>
                  <div
                    class="preserve-input-format mt-1 break-words font-medium"
                    v-html="
                      cleanHtml(reviewMode === 'zh-to-en' ? currentWord.word : currentWord.meaning)
                    "
                  />
                </div>
                <div class="border-t border-current/10 pt-4 text-[#141413] dark:text-[#faf9f5]">
                  <div class="flex items-center gap-3">
                    <strong class="preserve-input-format break-words text-xl" v-html="cleanHtml(currentWord.word)" />
                    <span
                      v-if="currentWord.phonetic"
                      class="text-sm text-[#888]"
                      v-html="cleanHtml(currentWord.phonetic)"
                    />
                    <button
                      class="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[#d97757] dark:bg-black/20"
                      title="播放读音"
                      @click="playCurrentAudio"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M11 5 6 9H2v6h4l5 4z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                      </svg>
                    </button>
                  </div>
                  <div class="mt-4 space-y-4">
                    <div class="preserve-input-format break-words" v-html="cleanHtml(currentWord.meaning)" />
                    <div v-if="currentWord.details">
                      <h3 class="mb-1 text-xs font-bold text-[#888]">答案后详解</h3>
                      <div class="answer-details preserve-input-format break-words text-sm leading-7" v-html="cleanHtml(currentWord.details)" />
                    </div>
                    <div v-if="currentWord.exampleEn">
                      <h3 class="mb-1 text-xs font-bold text-[#888]">英语例句</h3>
                      <div
                        class="preserve-input-format break-words leading-7"
                        v-html="cleanHtml(currentWord.exampleEn)"
                      />
                    </div>
                    <div v-if="currentWord.exampleZh">
                      <h3 class="mb-1 text-xs font-bold text-[#888]">例句翻译</h3>
                      <div
                        class="preserve-input-format break-words leading-7"
                        v-html="cleanHtml(currentWord.exampleZh)"
                      />
                    </div>
                    <div v-if="currentWord.note">
                      <h3 class="mb-1 text-xs font-bold text-[#888]">注释</h3>
                      <div class="preserve-input-format break-words leading-7" v-html="cleanHtml(currentWord.note)" />
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="checked"
                class="mt-4 flex items-center justify-center gap-2 rounded-[8px] border border-[#d97757]/40 bg-[#fdf0e8] px-4 py-2.5 text-sm font-semibold text-[#a85335] dark:bg-[#2e2018] dark:text-[#f0c4a8]"
              >
                按
                <kbd class="rounded border border-current/30 bg-white/70 px-2 py-0.5 font-mono dark:bg-black/20"
                  >Enter ↵</kbd
                >
                进入下一题
              </div>
              <button
                class="mt-5 w-full rounded-[8px] bg-[#d97757] py-3 font-medium text-white disabled:opacity-50"
                :disabled="!checked && !answer.trim()"
                @click="checked ? nextWord() : checkAnswer()"
              >
                {{ checked ? '下一个 · Enter ↵' : '检查答案' }}
              </button>
            </template>
          </div>
        </div>
        <div v-if="view === 'learn'" class="mt-5 flex items-center justify-between gap-3">
          <button class="rounded-[8px] border border-[#ddd] px-5 py-2.5 text-[#777] disabled:opacity-40 dark:border-[#444]" :disabled="currentIndex <= 0" @click="previousWord">
            上一个
          </button>
          <span class="hidden text-sm font-semibold text-[#a85335] sm:block">按 <kbd class="rounded border border-[#d97757]/30 bg-[#fdf0e8] px-2 py-0.5 font-mono dark:bg-[#2e2018]">Enter ↵</kbd> 下一词</span>
          <button class="rounded-[8px] bg-[#d97757] px-6 py-2.5 text-white" @click="nextWord">
            下一个 · Enter ↵
          </button>
        </div>
      </section>
    </main>

    <div
      v-if="inspection"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="!busy && (inspection = null)"
    >
      <div
        class="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[8px] bg-white p-6 text-[#141413] shadow-xl"
      >
        <h2 class="text-xl font-bold">确认字段对应</h2>
        <p class="mt-1 text-sm text-[#777]">
          {{ inspection.sourceFilename }} ·
          {{ inspection.noteCount }} 个词条。不同模板可分别设置，未使用的项目留空。
        </p>
        <label class="mt-5 block text-sm">
          <span class="mb-1 block text-xs text-[#777]">词库名称</span>
          <input
            v-model="importName"
            maxlength="80"
            class="w-full rounded-[8px] border border-[#ddd] px-3 py-2 outline-none focus:border-[#d97757]"
          />
        </label>
        <div
          v-for="model in inspection.models"
          :key="model.id"
          class="mt-6 rounded-[8px] border border-[#e8e6dc] p-4"
        >
          <h3 class="font-semibold">{{ model.name }}</h3>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label v-for="[target, label] in fieldTargets" :key="target" class="text-sm">
              <span class="mb-1 block text-xs text-[#777]">{{ label }}</span>
              <select
                v-model="mappings[String(model.id)][target]"
                class="w-full rounded-[8px] border border-[#ddd] px-3 py-2"
              >
                <option :value="undefined">不使用</option>
                <option v-for="field in model.fields" :key="field.ordinal" :value="field.ordinal">
                  {{ field.name }}
                </option>
              </select>
            </label>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <button
            class="rounded-[8px] border px-5 py-2"
            :disabled="busy"
            @click="inspection = null"
          >
            取消
          </button>
          <button
            class="rounded-[8px] bg-[#d97757] px-5 py-2 text-white disabled:opacity-50"
            :disabled="busy || !importName.trim()"
            @click="confirmImport"
          >
            {{ busy ? '正在归档...' : '确认并归档' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="newArchiveOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="!busy && (newArchiveOpen = false)"
    >
      <form
        class="w-full max-w-md rounded-[8px] bg-white p-6 text-[#141413] shadow-xl dark:bg-[#1e1e1c] dark:text-[#faf9f5]"
        @submit.prevent="createArchive"
      >
        <h2 class="text-lg font-bold">新建词库</h2>
        <p class="mt-1 text-sm text-[#888]">创建空白词库后，可逐个添加单词。</p>
        <input
          v-model="newArchiveName"
          autofocus
          maxlength="80"
          placeholder="例如：雅思核心词汇"
          class="mt-5 w-full rounded-[8px] border border-[#ddd] bg-transparent px-4 py-3 outline-none focus:border-[#d97757] dark:border-[#444]"
        />
        <div class="mt-6 flex justify-end gap-2">
          <button type="button" class="rounded-[8px] px-4 py-2 text-[#777]" @click="newArchiveOpen = false">取消</button>
          <button class="rounded-[8px] bg-[#d97757] px-5 py-2 text-white disabled:opacity-50" :disabled="busy || !newArchiveName.trim()">{{ busy ? '正在创建...' : '创建' }}</button>
        </div>
      </form>
    </div>

    <div
      v-if="addWordOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="addWordOpen = false"
    >
      <form
        class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[8px] bg-white p-6 text-[#141413] shadow-xl dark:bg-[#1e1e1c] dark:text-[#faf9f5]"
        @submit.prevent="addWord"
      >
        <h2 class="text-lg font-bold">{{ editingWordId ? '编辑单词' : '新增单词' }}</h2>
        <div class="mt-5 grid gap-4 sm:grid-cols-2">
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">英语单词 *</span><input v-model="wordDraft.word" autofocus class="w-full rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">音标</span><input v-model="wordDraft.phonetic" class="w-full rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm sm:col-span-2"><span class="mb-1 block text-xs text-[#777]">中文释义 *</span><textarea v-model="wordDraft.meaning" rows="2" class="w-full resize-y rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">英语例句</span><textarea v-model="wordDraft.exampleEn" rows="3" class="w-full resize-y rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">例句翻译</span><textarea v-model="wordDraft.exampleZh" rows="3" class="w-full resize-y rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm sm:col-span-2"><span class="mb-1 block text-xs text-[#777]">答案后详解</span><textarea v-model="wordDraft.details" rows="5" class="w-full resize-y rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">注释</span><textarea v-model="wordDraft.note" rows="2" class="w-full resize-y rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
          <label class="text-sm"><span class="mb-1 block text-xs text-[#777]">标签（逗号或空格分隔）</span><input v-model="wordDraft.tags" class="w-full rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2.5 dark:border-[#444]" /></label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button type="button" class="rounded-[8px] px-4 py-2 text-[#777]" @click="addWordOpen = false; editingWordId = null">取消</button>
          <button class="rounded-[8px] bg-[#788c5d] px-5 py-2 text-white disabled:opacity-50" :disabled="!wordDraft.word.trim() || !wordDraft.meaning.trim()">{{ editingWordId ? '保存修改' : '保存单词' }}</button>
        </div>
      </form>
    </div>

    <div v-if="deleteWordOpen && deletingWord" class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" @click.self="deleteWordOpen = false">
      <div class="w-full max-w-sm rounded-[8px] bg-white p-6 text-[#141413] shadow-xl dark:bg-[#1e1e1c] dark:text-[#faf9f5]">
        <h2 class="text-lg font-bold">删除单词？</h2>
        <p class="mt-3 text-sm text-[#777]">“{{ plainText(deletingWord.word) }}”将从当前词库和学习计划中移除。</p>
        <div class="mt-6 flex justify-end gap-2"><button class="rounded-[8px] px-4 py-2 text-[#777]" @click="deleteWordOpen = false">取消</button><button class="rounded-[8px] bg-red-600 px-5 py-2 text-white" @click="confirmDeleteWord">删除</button></div>
      </div>
    </div>

    <div
      v-if="deleteArchiveOpen && archive"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="!deletingArchive && (deleteArchiveOpen = false)"
    >
      <div
        class="w-full max-w-md rounded-[8px] bg-white p-6 text-[#141413] shadow-xl dark:bg-[#1e1e1c] dark:text-[#faf9f5]"
      >
        <h2 class="text-lg font-bold">删除词库“{{ archive.name }}”？</h2>
        <p class="mt-3 text-sm leading-6 text-[#777] dark:text-[#aaa]">
          将删除当前错题本中该词库的原
          APKG、全部词条、音频和学习进度。已经归档到错题本的错题不会删除。
        </p>
        <p
          class="mt-3 rounded-[8px] bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/20 dark:text-red-300"
        >
          此操作不可恢复。
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="rounded-[8px] px-4 py-2 text-sm text-[#777] disabled:opacity-50"
            :disabled="deletingArchive"
            @click="deleteArchiveOpen = false"
          >
            取消
          </button>
          <button
            class="rounded-[8px] bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            :disabled="deletingArchive"
            @click="confirmDeleteArchive"
          >
            {{ deletingArchive ? '正在删除...' : '删除词库' }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="curveSettingsOpen && progress"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      @click.self="curveSettingsOpen = false"
    >
      <div
        class="w-full max-w-lg rounded-[8px] bg-white p-6 text-[#141413] shadow-xl dark:bg-[#1e1e1c] dark:text-[#faf9f5]"
      >
        <h2 class="text-lg font-bold">复习曲线设置</h2>
        <p class="mt-1 text-sm text-[#888]">连续答对会逐级延长间隔，达到最后一级后保持该间隔。</p>
        <div class="mt-5 space-y-3">
          <label
            v-for="(_, index) in curveIntervalsDraft"
            :key="index"
            class="flex items-center justify-between gap-4 text-sm"
          >
            <span>连续答对第 {{ index + 1 }} 次</span>
            <span class="flex items-center gap-2"
              ><input
                v-model.number="curveIntervalsDraft[index]"
                type="number"
                min="1"
                max="3650"
                class="w-24 rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2 text-right dark:border-[#444]"
              />
              天后</span
            >
          </label>
          <label
            class="flex items-center justify-between gap-4 border-t border-[#e8e6dc] pt-3 text-sm dark:border-[#333]"
          >
            <span>答错后再次出现</span>
            <span class="flex items-center gap-2"
              ><input
                v-model.number="wrongRetryDraft"
                type="number"
                min="1"
                max="10080"
                class="w-24 rounded-[8px] border border-[#ddd] bg-transparent px-3 py-2 text-right dark:border-[#444]"
              />
              分钟</span
            >
          </label>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="rounded-[8px] px-4 py-2 text-sm text-[#777]"
            @click="curveSettingsOpen = false"
          >
            取消
          </button>
          <button
            class="rounded-[8px] bg-[#d97757] px-4 py-2 text-sm text-white"
            @click="saveCurveSettings"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
