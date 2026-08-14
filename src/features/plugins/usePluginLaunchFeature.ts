import { computed, ref, type Ref } from 'vue'
import type { NoteEntry } from '@/types'
import type { VocabularyMistake } from '@/plugins/english-vocabulary/types'
import { entryRepository } from '@/services/db'
import { getNotebookPlugin } from '@/plugins/registry'
import { notebookPluginService } from '@/plugins/service'

interface PluginLaunchFeatureOptions {
  activeNotebookId: Ref<string | null>
  entries: Ref<NoteEntry[]>
  loadEntries: () => Promise<void>
  showToast: (message: string) => void
}

export function usePluginLaunchFeature(options: PluginLaunchFeatureOptions) {
  const installedPlugins = ref<Awaited<ReturnType<typeof notebookPluginService.listInstalled>>>([])
  const pluginManagerOpen = ref(false)
  const activePluginId = ref<string | null>(null)
  const activePlugin = computed(() =>
    activePluginId.value ? getNotebookPlugin(activePluginId.value) : null,
  )
  const installedPluginIds = computed(() => installedPlugins.value.map((item) => item.pluginId))

  async function loadInstalledPlugins(notebookId = options.activeNotebookId.value) {
    installedPlugins.value = notebookId ? await notebookPluginService.listInstalled(notebookId) : []
  }

  function resetPluginLaunch() {
    activePluginId.value = null
    installedPlugins.value = []
    pluginManagerOpen.value = false
  }

  async function installPlugin(pluginId: string) {
    const notebookId = options.activeNotebookId.value
    if (!notebookId) return
    try {
      await notebookPluginService.install(notebookId, pluginId)
      await loadInstalledPlugins(notebookId)
      pluginManagerOpen.value = false
      activePluginId.value = pluginId
      options.showToast(`${getNotebookPlugin(pluginId)?.name ?? '插件'}已安装到当前错题本`)
    } catch (error) {
      options.showToast(error instanceof Error ? error.message : '插件安装失败，请重试')
    }
  }

  async function uninstallPlugin(pluginId: string, deleteData: boolean) {
    const notebookId = options.activeNotebookId.value
    if (!notebookId) return
    try {
      await notebookPluginService.uninstall(notebookId, pluginId, deleteData)
      await loadInstalledPlugins(notebookId)
      if (activePluginId.value === pluginId) activePluginId.value = null
      options.showToast(`${getNotebookPlugin(pluginId)?.name ?? '插件'}已卸载`)
    } catch (error) {
      options.showToast(error instanceof Error ? error.message : '插件卸载失败，请重试')
    }
  }

  function openPlugin(pluginId: string) {
    if (installedPluginIds.value.includes(pluginId)) activePluginId.value = pluginId
  }

  async function archiveVocabularyMistake(mistake: VocabularyMistake) {
    const notebookId = options.activeNotebookId.value
    if (!notebookId) return

    const now = Date.now()
    const existing = options.entries.value.find(
      (entry) =>
        entry.pluginSource?.pluginId === 'english-vocabulary' &&
        entry.pluginSource.archiveId === mistake.archiveId &&
        entry.pluginSource.wordId === mistake.word.id &&
        entry.pluginSource.reviewMode === mistake.mode,
    )
    const modeLabel = mistake.mode === 'zh-to-en' ? '中译英' : '英译中'
    const packageTag = `Anki:${mistake.archiveName}`
    const question =
      mistake.mode === 'zh-to-en'
        ? mistake.word.meaning
        : [mistake.word.word, mistake.word.phonetic].filter(Boolean).join('<br>')
    const correctAnswer = [
      mistake.mode === 'zh-to-en' ? mistake.word.word : mistake.word.meaning,
      mistake.word.exampleEn ? `<strong>英语例句</strong><br>${mistake.word.exampleEn}` : '',
      mistake.word.exampleZh ? `<strong>例句翻译</strong><br>${mistake.word.exampleZh}` : '',
      mistake.word.note ? `<strong>注释</strong><br>${mistake.word.note}` : '',
    ]
      .filter(Boolean)
      .join('<br><br>')

    const entry: NoteEntry = existing ?? {
      id: `vocab_${mistake.archiveId}_${mistake.word.id}_${mistake.mode}`,
      notebookId,
      title: `[${modeLabel}] ${mistake.word.word}`,
      question,
      wrongAnswer: mistake.answer,
      correctAnswer,
      subject: '英语',
      source: mistake.archiveName,
      tags: ['英语单词', modeLabel, packageTag],
      masteryLevel: 0,
      consecutivePasses: 0,
      nextReviewDate: now,
      createdAt: now,
      updatedAt: now,
    }
    entry.title = `[${modeLabel}] ${mistake.word.word}`
    entry.question = question
    entry.wrongAnswer = mistake.answer
    entry.correctAnswer = correctAnswer
    entry.subject = '英语'
    entry.source = mistake.archiveName
    entry.tags = Array.from(new Set([...entry.tags, '英语单词', modeLabel, packageTag]))
    entry.nextReviewDate = now
    entry.updatedAt = now
    entry.pluginSource = {
      pluginId: 'english-vocabulary',
      archiveId: mistake.archiveId,
      wordId: mistake.word.id,
      reviewMode: mistake.mode,
      wrongCount: (existing?.pluginSource?.wrongCount ?? 0) + 1,
      lastWrongAt: now,
    }
    await entryRepository.put(notebookId, JSON.parse(JSON.stringify(entry)))
    await options.loadEntries()
    options.showToast(existing ? '已更新对应英语错题' : '已归档到当前错题本')
  }

  return {
    installedPlugins,
    pluginManagerOpen,
    activePluginId,
    activePlugin,
    installedPluginIds,
    loadInstalledPlugins,
    resetPluginLaunch,
    installPlugin,
    uninstallPlugin,
    openPlugin,
    archiveVocabularyMistake,
  }
}
