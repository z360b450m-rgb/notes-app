<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
// @AI-NOTE: 错题本菜单组件 —— 数据操作通过 useNotebooks Hook。
// 禁止直接操作存储、编写业务逻辑、管理跨组件状态。
import { ref, computed, watch } from 'vue'
import { useNotebooks } from '@/composables/useNotebooks'
import { entryRepository } from '@/services/db'
import { useNotebookMenuData } from '@/composables/useNotebookMenuData'
import { useDarkMode } from '@/composables/useDarkMode'
import { useModalAnimations } from '@/composables/useModalAnimations'
import ReviewAgentEntry from './ReviewAgentEntry.vue'
import ActionMenu from './ActionMenu.vue'
import { useDesignExamples } from '@/composables/useDesignExamples'
import type { AgentEntryTarget } from '@/utils/agentEntryLinks'

const props = withDefaults(
  defineProps<{ initialNav?: 'home' | 'review'; navigationVersion?: number }>(),
  {
    initialNav: 'home',
  },
)

const { busy: examplesBusy, error: examplesError, create: createExamples } = useDesignExamples()
const isDevelopment = import.meta.env.DEV
async function openDesignExamples() {
  const id = await createExamples()
  if (id) onEnterNotebook(id)
}

const emit = defineEmits<{
  enter: [id: string]
  created: [id: string]
  'open-settings': []
  'open-entry': [notebookId: string, entryId: string]
}>()

const { isDark } = useDarkMode()
const { enterModal, leaveModal } = useModalAnimations()
const { notebooks, createNotebook, updateNotebook, deleteNotebook, reorderNotebooks } =
  useNotebooks()
// The menu only receives counts; question data is loaded when a notebook opens.
const {
  countsByNotebook,
  subjects: planSubjects,
  reviewDays,
  loading: statsLoading,
  error: statsError,
  reload: reloadStats,
  hasEntries,
  hasReviews,
  entriesReady,
  reviewsReady,
} = useNotebookMenuData(notebooks)
const entryLinkError = ref('')

async function openAgentEntry(target: AgentEntryTarget) {
  entryLinkError.value = ''
  // 只在当前账号的错题本中查找；旧回答仅有题目ID时也能找到所属本。
  const candidates = notebooks.value.filter(
    (notebook) => !target.notebookId || notebook.id === target.notebookId,
  )
  try {
    for (const notebook of candidates) {
      const entry = await entryRepository.get(notebook.id, target.entryId)
      if (entry) {
        emit('open-entry', notebook.id, entry.id)
        return
      }
    }
    entryLinkError.value = '无法打开原题：题目已删除或不在当前账号的错题本中。'
  } catch {
    entryLinkError.value = '暂时无法读取原题，请稍后重试。'
  }
}
const entryCountByNotebook = computed(() => {
  return Object.fromEntries(
    Object.values(countsByNotebook.value).map((item) => [item.notebookId, item.entryCount]),
  )
})

const totalEntries = computed(() => {
  let sum = 0
  for (const c of Object.values(entryCountByNotebook.value)) sum += c
  return sum
})

const reviewedToday = computed(() =>
  Object.values(countsByNotebook.value).reduce((sum, item) => sum + item.reviewedToday, 0),
)
const stillDue = computed(() =>
  Object.values(countsByNotebook.value).reduce((sum, item) => sum + item.dueCount, 0),
)
const stillDueByNotebook = computed(() =>
  Object.fromEntries(
    Object.values(countsByNotebook.value).map((item) => [item.notebookId, item.dueCount]),
  ),
)
const reviewedByNotebook = computed(() =>
  Object.fromEntries(
    Object.values(countsByNotebook.value).map((item) => [item.notebookId, item.reviewedToday]),
  ),
)

// Total to review today = completed + still pending (total doesn't decrease as reviews happen)
const totalDue = computed(() => {
  return reviewedToday.value + stillDue.value
})

// Per-notebook total to review = completed + still pending per notebook
const dueByNotebook = computed(() => {
  const map: Record<string, number> = {}
  for (const nb of notebooks.value) {
    map[nb.id] = (reviewedByNotebook.value[nb.id] || 0) + (stillDueByNotebook.value[nb.id] || 0)
  }
  return map
})

const dotColors = ['#d97757', '#788c5d', '#6a9bcc', '#c56a48', '#5b7a9e', '#636b4a']
function dotColor(i: number) {
  return dotColors[i % dotColors.length]
}

// ── Quotes ──
const quotes = [
  '辛勤的蜜蜂永没有时间悲哀。——布莱克',
  '我这个人走得很慢，但是我从不后退。——亚伯拉罕·林肯',
  '一个人几乎可以在任何他怀有无限热忱的事情上成功。——查尔斯·史考伯',
  '深窥自己的心，而后发觉一切的奇迹在你自己。——培根',
  '失败也是我需要的，它和成功对我一样有价值。——爱迪生',
  '任何问题都有解决的办法，无法可想的事是没有的。——爱迪生',
  '每一种挫折或不利的突变，是带着同样或较大的有利的种子。——爱默生',
  '如果是玫瑰，它总会开花的。——歌德',
  '生活的情况越艰难，我越感到自己更坚强，甚而也更聪明。——高尔基',
  '但愿每次回忆，对生活都不感到负疚。——郭小川',
  '希望是附丽于存在的，有存在，便有希望，有希望，便是光明。——鲁迅',
  '冬天已经到来，春天还会远吗？——雪莱',
  '过去属于死神，未来属于你自己。——雪莱',
  '知识是珍宝，但实践是得到它的钥匙。——托马斯·富勒',
  '节约时间，也就是使一个人的有限的生命，更加有效，而也就等于延长了人的寿命。——鲁迅',
  '行百里者半九十。——《战国策》',
]
const randomQuote = quotes[Math.floor(Math.random() * quotes.length)]

// ── Nav ──
const planDays = computed(() => {
  return reviewDays.value.map((day) => ({
    label: new Date(day.timestamp).toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    }),
    count: day.count,
  }))
})
const planWeekCount = computed(() => planDays.value.reduce((sum, day) => sum + day.count, 0))
const planChartMax = computed(() => Math.max(1, ...planDays.value.map((day) => day.count)))
const planCompletion = computed(() =>
  totalDue.value ? Math.round((reviewedToday.value / totalDue.value) * 100) : 0,
)

const activeNav = ref<'home' | 'review' | 'report' | 'plan'>(props.initialNav)
const agentHistoryTarget = ref<HTMLElement | null>(null)
watch(
  () => props.navigationVersion,
  () => {
    activeNav.value = props.initialNav
  },
)

// ── Search ──
const searchQuery = ref('')
const filteredNotebooks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return notebooks.value
  return notebooks.value.filter((n) => n.name.toLowerCase().includes(q))
})

// ── Create notebook ──
const showCreate = ref(false)
const createName = ref('')
const createDesc = ref('')
const createErr = ref('')
const notebookMutation = ref<'create' | 'edit' | 'delete' | null>(null)
const mutationError = ref('')
async function mutateNotebook(
  action: 'create' | 'edit' | 'delete',
  operation: () => Promise<void>,
) {
  if (notebookMutation.value) return
  notebookMutation.value = action
  mutationError.value = ''
  try {
    await operation()
  } catch (error) {
    mutationError.value = error instanceof Error ? error.message : '操作失败，请重试'
    if (action === 'create') createErr.value = mutationError.value
  } finally {
    notebookMutation.value = null
  }
}

function openCreate() {
  showCreate.value = true
  createName.value = ''
  createDesc.value = ''
  createErr.value = ''
}
function cancelCreate() {
  if (notebookMutation.value) return
  showCreate.value = false
}
async function confirmCreate() {
  if (!createName.value.trim()) return
  await mutateNotebook('create', async () => {
    await createNotebook(createName.value.trim(), createDesc.value.trim(), '')
    showCreate.value = false
  })
}

// ── Edit notebook ──
const editingId = ref<string | null>(null)
const editName = ref('')
const editDesc = ref('')
function startEdit(nb: { id: string; name: string; description: string }) {
  mutationError.value = ''
  editingId.value = nb.id
  editName.value = nb.name
  editDesc.value = nb.description
}
function cancelEdit() {
  if (notebookMutation.value) return
  editingId.value = null
}
async function confirmEdit() {
  if (!editingId.value || !editName.value.trim()) return
  const id = editingId.value
  await mutateNotebook('edit', async () => {
    await updateNotebook(id, {
      name: editName.value.trim(),
      description: editDesc.value.trim(),
    })
    editingId.value = null
  })
}

// ── Delete notebook ──
const deletingId = ref<string | null>(null)
function startDelete(id: string) {
  mutationError.value = ''
  deletingId.value = id
}
function cancelDelete() {
  if (notebookMutation.value) return
  deletingId.value = null
}
async function confirmDelete() {
  if (!deletingId.value) return
  const id = deletingId.value
  await mutateNotebook('delete', async () => {
    await deleteNotebook(id)
    deletingId.value = null
  })
}

// ── Helpers ──
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days} 天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function shortDesc(desc: string): string {
  if (!desc) return ''
  return desc.length > 8 ? desc.slice(0, 8) + '…' : desc
}

function onEnterNotebook(id: string) {
  emit('enter', id)
}

// ── Drag-and-drop within the notebook table ──
const draggedId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
let dragJustEnded = false

function onDragStart(e: DragEvent, id: string) {
  draggedId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}
function onDragOver(e: DragEvent, id: string) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverId.value = id
}
function onDragLeave() {
  dragOverId.value = null
}
function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  const srcId = draggedId.value
  dragOverId.value = null
  draggedId.value = null
  if (!srcId) return
  const ids = notebooks.value.map((n) => n.id)
  const srcIdx = ids.indexOf(srcId)
  const dropIdx = ids.indexOf(targetId)
  if (srcIdx === -1 || dropIdx === -1 || srcIdx === dropIdx) return
  ids.splice(srcIdx, 1)
  ids.splice(dropIdx, 0, srcId)
  reorderNotebooks(ids)
}
function onDragEnd() {
  draggedId.value = null
  dragOverId.value = null
  dragJustEnded = true
  setTimeout(() => {
    dragJustEnded = false
  }, 100)
}
function onNotebookClick(id: string) {
  if (dragJustEnded) return
  emit('enter', id)
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div
    class="notebook-shell flex h-screen bg-[#faf9f5] dark:bg-[#141413] text-brand-dark dark:text-brand-light font-ui leading-relaxed"
    :class="{ 'review-workspace': activeNav === 'review' }"
  >
    <!-- ═══════════ LEFT SIDEBAR ═══════════ -->
    <aside
      class="notebook-navigation min-h-0 w-[220px] flex-shrink-0 bg-white dark:bg-[#1e1e1c] flex flex-col"
    >
      <!-- Logo + Nav -->
      <div class="shrink-0 px-5 pt-8 pb-4">
        <div class="flex flex-col gap-1 mb-8">
          <span
            class="text-[22px] font-bold text-brand-dark dark:text-brand-light font-ui leading-tight"
            >错题本</span
          >
          <span class="block w-8 h-[3px] rounded-full bg-accent" />
        </div>

        <nav class="space-y-1">
          <button
            type="button"
            v-for="item in [
              {
                id: 'home' as const,
                label: '首页',
                icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
              },
              {
                id: 'review' as const,
                label: '开始复习',
                icon: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z',
              },
              { id: 'report' as const, label: '学习报告', icon: 'M18 20V10M12 20V4M6 20v-6' },
              {
                id: 'plan' as const,
                label: '复习计划',
                icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z',
              },
            ]"
            :key="item.id"
            :aria-current="activeNav === item.id ? 'page' : undefined"
            class="ui-choice w-full flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-[14px] font-medium transition-colors duration-150"
            :class="
              activeNav === item.id
                ? 'bg-[#fdf0e8] dark:bg-[#2e2018] text-[#141413] dark:text-[#f0c4a8]'
                : 'text-brand-dark dark:text-brand-mid hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] hover:text-brand-dark dark:text-brand-light-gray'
            "
            @click="activeNav = item.id"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              :stroke="
                activeNav === item.id ? (isDark ? '#f0c4a8' : '#d97757') : isDark ? '#aaa' : '#999'
              "
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="item.icon" />
            </svg>
            {{ item.label }}
          </button>
        </nav>
      </div>

      <div
        v-if="activeNav === 'review'"
        ref="agentHistoryTarget"
        id="review-agent-navigation"
        class="review-agent mx-5 flex min-h-0 flex-1 flex-col border-t border-black/10 pt-4 pb-3 dark:border-white/15"
      />

      <!-- Settings -->
      <div class="mt-auto px-5 py-3 border-t border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50">
        <button
          data-ui-variant="default"
          type="button"
          class="ui-control w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[14px] text-brand-mid dark:text-brand-mid hover:text-brand-dark dark:text-brand-mid hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
          @click="emit('open-settings')"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          设置
        </button>
      </div>
    </aside>

    <!-- ═══════════ RIGHT MAIN CONTENT ═══════════ -->
    <main
      class="notebook-main flex min-h-0 min-w-0 flex-1 flex-col"
      :class="activeNav === 'review' ? 'overflow-hidden' : 'overflow-y-auto'"
    >
      <!-- Top bar -->
      <div
        class="notebook-topbar flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8"
      >
        <h1
          class="text-[22px] font-ui font-semibold leading-tight text-brand-dark dark:text-brand-light"
        >
          {{
            activeNav === 'home'
              ? '首页'
              : activeNav === 'review'
                ? '开始复习'
                : activeNav === 'report'
                  ? '学习报告'
                  : '复习计划'
          }}
        </h1>
        <div v-if="activeNav === 'home'" class="flex min-w-0 flex-wrap items-center gap-3">
          <button
            data-ui-variant="text"
            type="button"
            v-if="isDevelopment"
            class="ui-control rounded-lg px-3 py-2 text-xs text-accent"
            :disabled="examplesBusy"
            @click="openDesignExamples"
          >
            {{ examplesBusy ? '正在创建示例…' : '设计示例' }}
          </button>
          <span v-if="examplesError" role="alert" class="text-xs text-red-500">{{
            examplesError
          }}</span>
          <div class="relative">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              :stroke="isDark ? '#777' : '#bbb'"
              stroke-width="2"
              class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索错题…"
              class="ui-field w-full max-w-[220px] pl-9 pr-3 py-1.5 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[14px] text-brand-dark dark:text-brand-light outline-none focus:border-[#d97757] bg-white dark:bg-[#1e1e1c] placeholder-[#888] dark:placeholder-[#aaa] transition-colors"
            />
          </div>
        </div>
      </div>

      <div
        class="notebook-content min-w-0 flex-1"
        :class="
          activeNav === 'review'
            ? 'flex min-h-0 flex-col px-4 pb-4 sm:px-6 lg:px-8'
            : 'space-y-6 px-4 pb-12 sm:px-6 lg:px-8'
        "
      >
        <div
          v-if="statsLoading || statsError"
          class="flex items-center gap-3 rounded-lg border border-brand-light-gray px-4 py-3 text-sm text-brand-mid"
          data-testid="notebook-stats-status"
          :role="statsError ? 'alert' : 'status'"
        >
          <span>{{ statsLoading ? '正在读取题数和复习统计…' : statsError }}</span>
          <button
            data-ui-variant="default"
            v-if="statsError"
            type="button"
            class="ui-control shrink-0 rounded px-2 py-1 text-accent disabled:opacity-50"
            :disabled="statsLoading"
            @click="reloadStats"
          >
            重新读取统计
          </button>
        </div>

        <!-- HOME VIEW -->
        <template v-if="activeNav === 'home'">
          <!-- Stats cards -->
          <div class="grid grid-cols-3 gap-4">
            <div
              class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-5 relative overflow-hidden"
            >
              <div
                class="absolute -top-2 -right-2 w-12 h-12 flex items-start justify-end opacity-[0.06]"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#d97757">
                  <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </div>
              <div
                class="text-[32px] font-semibold tabular-nums text-brand-dark dark:text-brand-light leading-tight"
              >
                {{ notebooks.length }}
              </div>
              <div class="text-[14px] text-gray-600 dark:text-gray-300 mt-2">错题本</div>
            </div>
            <div
              class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-5 relative overflow-hidden"
            >
              <div
                class="absolute -top-2 -right-2 w-12 h-12 flex items-start justify-end opacity-[0.06]"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#d97757">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
              </div>
              <div
                class="text-[32px] font-semibold tabular-nums text-brand-dark dark:text-brand-light leading-tight"
              >
                {{ entriesReady ? totalEntries : '—' }}
              </div>
              <div class="text-[14px] text-gray-600 dark:text-gray-300 mt-2">总题数</div>
            </div>
            <div
              class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-5 relative overflow-hidden"
            >
              <div
                class="absolute -top-2 -right-2 w-12 h-12 flex items-start justify-end opacity-[0.06]"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#d97757">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <div
                class="text-[32px] font-semibold tabular-nums text-brand-dark dark:text-brand-light leading-tight"
              >
                {{ reviewsReady ? `${reviewedToday}/${totalDue}` : '—' }}
              </div>
              <div class="text-[14px] text-gray-600 dark:text-gray-300 mt-2">
                今日复习（完成/需复习）
              </div>
            </div>
          </div>

          <!-- Quote bar -->
          <div
            class="bg-[#fdf0e8] dark:bg-[#2e2018] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 px-5 py-3.5 flex items-center gap-3"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              :fill="isDark ? '#f0c4a8' : '#d97757'"
              opacity="0.4"
              class="flex-shrink-0"
            >
              <path
                d="M10 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2v-1zM20 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2v-1z"
              />
            </svg>
            <p class="text-[14px] text-gray-600 dark:text-gray-300 font-ui leading-relaxed">
              {{ randomQuote }}
            </p>
          </div>

          <!-- Notebook table -->
          <div
            class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border !border-[#c9c3b7] dark:!border-[#625b50] overflow-hidden"
          >
            <!-- Table header -->
            <div
              class="flex items-center px-5 py-3 text-[13px] font-medium text-gray-600 dark:text-gray-300 border-b border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50"
            >
              <span class="flex-[2]">名称</span>
              <span class="flex-[1.5]">题数 / 复习进度</span>
              <span class="flex-[1.5]">更新时间</span>
              <span class="flex-[1]">标签</span>
              <span class="flex-[1.5] text-right">操作</span>
            </div>

            <!-- Table rows -->
            <div v-if="filteredNotebooks.length > 0">
              <div
                v-for="(nb, idx) in filteredNotebooks"
                :key="nb.id"
                draggable="true"
                class="flex items-center px-5 py-3 border-b border-[#e8e6dc]/30 dark:border-[#2e2e2c]/30 hover:bg-[#faf9f5] dark:hover:bg-[#242422] transition-colors duration-150 cursor-pointer"
                :class="{ 'ring-1 ring-inset ring-accent': dragOverId === nb.id }"
                @click="onNotebookClick(nb.id)"
                @dragstart="onDragStart($event, nb.id)"
                @dragover="onDragOver($event, nb.id)"
                @dragleave="onDragLeave"
                @drop="onDrop($event, nb.id)"
                @dragend="onDragEnd"
              >
                <div class="flex-[2] flex items-center gap-2.5 min-w-0">
                  <span
                    class="w-3 h-3 rounded-[3px] flex-shrink-0"
                    :style="{ backgroundColor: dotColor(idx) }"
                  />
                  <span
                    class="text-[15px] text-brand-dark dark:text-brand-light-gray font-medium truncate group-hover:text-[#d97757] dark:text-[#f0c4a8]"
                    >{{ nb.name }}</span
                  >
                </div>
                <span class="flex-[1.5] text-[15px] text-gray-600 dark:text-gray-300 tabular-nums"
                  >{{ hasEntries(nb.id) ? entryCountByNotebook[nb.id] || 0 : '—' }} 题 ·
                  {{
                    hasReviews(nb.id)
                      ? `${reviewedByNotebook[nb.id] || 0}/${dueByNotebook[nb.id] || 0}`
                      : '—'
                  }}</span
                >
                <span class="flex-[1.5] text-[15px] text-gray-600 dark:text-gray-300">{{
                  fmtTime(nb.updatedAt)
                }}</span>
                <span class="flex-[1]">
                  <span
                    v-if="nb.description"
                    class="inline-block px-2 py-0.5 rounded-[10px] text-[12px] bg-[#fdf0e8] dark:bg-[#2e2018] text-[#d97757] dark:text-[#f0c4a8] font-medium"
                    >{{ shortDesc(nb.description) }}</span
                  >
                </span>
                <div class="flex-[1.5] flex items-center justify-end">
                  <ActionMenu
                    :label="`错题本操作：${nb.name}`"
                    :actions="[
                      { id: 'edit', label: '编辑错题本', icon: 'edit' },
                      {
                        id: 'delete',
                        label: '删除错题本',
                        icon: 'delete',
                        danger: true,
                        separatorBefore: true,
                      },
                    ]"
                    @select="(action) => (action === 'edit' ? startEdit(nb) : startDelete(nb.id))"
                  />
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-if="notebooks.length === 0"
              class="px-5 py-12 text-center text-[14px] text-brand-mid dark:text-[#999]"
            >
              还没有错题本，点击下方按钮创建第一个
            </div>

            <!-- Add new row -->
            <button
              data-ui-variant="default"
              type="button"
              class="ui-control w-full flex items-center justify-center gap-1.5 px-5 py-3 text-[14px] text-brand-mid dark:text-brand-mid hover:text-[#d97757] dark:text-[#f0c4a8] hover:bg-[#fdf0e8]/20 dark:hover:bg-[#2e2018]/20 border-t border-dashed border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 transition-colors duration-150"
              data-testid="create-notebook"
              @click="openCreate"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建错题本
            </button>
          </div>
        </template>

        <!-- REPORT VIEW (placeholder) -->
        <template v-else-if="activeNav === 'report'">
          <div
            class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-8 text-center text-brand-mid dark:text-brand-mid text-[14px]"
          >
            学习报告功能即将上线
          </div>
        </template>

        <!-- Review plan overview, using real notebook and review data. -->
        <template v-else-if="activeNav === 'plan'">
          <div v-if="entriesReady && reviewsReady" class="review-plan space-y-6">
            <p class="text-sm text-brand-mid">学习概览 · 回顾复习进度，安排接下来的练习</p>
            <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="text-sm text-brand-mid">今日完成率</h2>
                <p class="my-3 text-4xl font-semibold">{{ planCompletion }}%</p>
                <div class="h-2 overflow-hidden rounded-full bg-brand-light-gray">
                  <div
                    class="h-full rounded-full bg-accent"
                    :style="{ width: planCompletion + '%' }"
                  />
                </div>
                <p class="mt-3 text-xs text-brand-mid">
                  已完成 {{ reviewedToday }} 次 · 待复习 {{ stillDue }} 道
                </p>
              </section>
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="text-sm text-brand-mid">待复习</h2>
                <p class="my-3 text-4xl font-semibold">
                  {{ stillDue }} <span class="text-sm font-normal">道</span>
                </p>
                <button
                  type="button"
                  class="ui-choice rounded-lg px-3 py-2 text-sm"
                  @click="activeNav = 'review'"
                >
                  开始今日复习 →
                </button>
              </section>
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="text-sm text-brand-mid">近 7 天复习</h2>
                <p class="my-3 text-4xl font-semibold">
                  {{ planWeekCount }} <span class="text-sm font-normal">次</span>
                </p>
                <p class="text-xs text-brand-mid">
                  共 {{ entriesReady ? totalEntries : '—' }} 道错题 ·
                  {{ notebooks.length }} 本错题本
                </p>
              </section>
            </div>
            <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="font-semibold">近 7 天复习分布</h2>
                <div class="mt-6 flex h-44 items-end gap-3">
                  <div
                    v-for="day in planDays"
                    :key="day.label"
                    class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                  >
                    <span class="text-xs text-brand-mid">{{ day.count }}</span>
                    <div
                      class="w-full rounded-t-lg bg-accent/70"
                      :style="{ height: (day.count / planChartMax) * 110 + 'px' }"
                    />
                    <span class="text-xs text-brand-mid">{{ day.label }}</span>
                  </div>
                </div>
                <p v-if="!planWeekCount" class="mt-4 text-sm text-brand-mid">
                  还没有复习记录，完成复习后会显示在这里。
                </p>
              </section>
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="font-semibold">学科分布</h2>
                <div
                  v-for="subject in planSubjects"
                  :key="subject.name"
                  class="flex items-center justify-between border-b border-brand-light-gray py-4 text-sm"
                >
                  <span>{{ subject.name }}</span
                  ><span class="text-brand-mid">{{ subject.count }} 道</span>
                </div>
                <p v-if="!planSubjects.length" class="mt-6 text-sm text-brand-mid">
                  添加错题后显示学科分布。
                </p>
              </section>
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="font-semibold">复习重点</h2>
                <p class="mt-4 text-sm text-brand-mid">
                  {{
                    stillDue
                      ? '优先回顾已到期的错题，再练习其他内容。'
                      : '当前没有到期错题，可以进入错题本自由复习。'
                  }}
                </p>
                <div class="mt-5 rounded-xl bg-accent/10 p-4 text-sm">
                  今日已完成 {{ reviewedToday }} 次复习，尚有 {{ stillDue }} 道到期题目。
                </div>
                <button
                  type="button"
                  class="ui-choice mt-5 rounded-lg px-3 py-2 text-sm"
                  @click="activeNav = 'review'"
                >
                  选择错题本 →
                </button>
              </section>
              <section class="plan-card rounded-xl bg-white p-6">
                <h2 class="font-semibold">今日复习安排</h2>
                <div
                  v-for="nb in notebooks"
                  :key="nb.id"
                  class="flex items-center justify-between gap-3 border-b border-brand-light-gray py-4"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm">{{ nb.name }}</p>
                    <p class="mt-1 text-xs text-brand-mid">
                      已复习 {{ reviewedByNotebook[nb.id] || 0 }} 次 · 待复习
                      {{ stillDueByNotebook[nb.id] || 0 }} 道
                    </p>
                  </div>
                  <button
                    type="button"
                    class="ui-choice shrink-0 rounded-lg px-3 py-2 text-sm"
                    @click="onEnterNotebook(nb.id)"
                  >
                    打开 →
                  </button>
                </div>
                <p v-if="!notebooks.length" class="mt-6 text-sm text-brand-mid">
                  先创建一本错题本，开始积累。
                </p>
              </section>
            </div>
          </div>
        </template>

        <!-- Review Agent entrance -->
        <template v-else-if="activeNav === 'review'">
          <ReviewAgentEntry
            :history-target="agentHistoryTarget"
            :entry-link-error="entryLinkError"
            @open-entry="openAgentEntry"
          />
        </template>
      </div>
    </main>

    <!-- ═══════════ CREATE DIALOG ═══════════ -->
    <Transition :css="false" @enter="enterModal" @leave="leaveModal">
      <div
        v-if="showCreate"
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/15"
        @click.self="cancelCreate"
      >
        <div
          v-dialog-surface="'错题本管理'"
          class="modal-dialog bg-white dark:bg-[#1e1e1c] rounded-[12px] w-[420px] max-w-[92vw] p-6 border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50"
          @click.stop
        >
          <h3 class="text-[15px] font-semibold text-brand-dark dark:text-brand-light mb-4">
            新建错题本
          </h3>
          <div class="space-y-3">
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >名称</label
              >
              <input
                :disabled="!!notebookMutation"
                v-model="createName"
                aria-label="错题本名称"
                data-testid="notebook-name"
                type="text"
                placeholder="例如：数学错题本"
                class="ui-field w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmCreate"
              />
            </div>
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >简介</label
              >
              <input
                :disabled="!!notebookMutation"
                v-model="createDesc"
                aria-label="错题本简介"
                data-testid="notebook-description"
                type="text"
                placeholder="简短描述"
                class="ui-field w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmCreate"
              />
            </div>
          </div>
          <div role="alert" v-if="createErr" class="text-[12px] text-red-500 mt-2">
            {{ createErr }}
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button
              :disabled="!!notebookMutation"
              data-ui-variant="default"
              type="button"
              data-dialog-cancel
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] text-brand-dark dark:text-brand-mid border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelCreate"
            >
              取消
            </button>
            <button
              data-ui-variant="primary"
              type="button"
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] bg-[#d97757] text-white font-medium hover:bg-[#c56a48] transition-colors disabled:opacity-40"
              data-testid="confirm-create-notebook"
              :disabled="!!notebookMutation || !createName.trim()"
              @click="confirmCreate"
            >
              {{ notebookMutation ? '处理中…' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══════════ EDIT DIALOG ═══════════ -->
    <Transition :css="false" @enter="enterModal" @leave="leaveModal">
      <div
        v-if="editingId"
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/15"
        @click.self="cancelEdit"
      >
        <div
          v-dialog-surface="'错题本管理'"
          class="modal-dialog bg-white dark:bg-[#1e1e1c] rounded-[12px] w-[420px] max-w-[92vw] p-6 border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50"
          @click.stop
        >
          <h3 class="text-[15px] font-semibold text-brand-dark dark:text-brand-light mb-4">
            编辑错题本
          </h3>
          <div class="space-y-3">
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >名称</label
              >
              <input
                :disabled="!!notebookMutation"
                v-model="editName"
                aria-label="错题本名称"
                type="text"
                class="ui-field w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmEdit"
              />
            </div>
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >简介</label
              >
              <input
                :disabled="!!notebookMutation"
                v-model="editDesc"
                aria-label="错题本简介"
                type="text"
                class="ui-field w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmEdit"
              />
            </div>
          </div>
          <p v-if="mutationError" role="alert" class="ui-inline-error">{{ mutationError }}</p>
          <div class="flex justify-end gap-2 mt-5">
            <button
              :disabled="!!notebookMutation"
              data-ui-variant="default"
              type="button"
              data-dialog-cancel
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] text-brand-dark dark:text-brand-mid border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelEdit"
            >
              取消
            </button>
            <button
              :disabled="!!notebookMutation"
              data-ui-variant="primary"
              type="button"
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] bg-[#d97757] text-white font-medium hover:bg-[#c56a48] transition-colors"
              @click="confirmEdit"
            >
              {{ notebookMutation ? '处理中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ═══════════ DELETE CONFIRMATION ═══════════ -->
    <Transition :css="false" @enter="enterModal" @leave="leaveModal">
      <div
        v-if="deletingId"
        class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/15"
        @click.self="cancelDelete"
      >
        <div
          v-dialog-surface="'错题本管理'"
          class="modal-dialog bg-white dark:bg-[#1e1e1c] rounded-[12px] w-[380px] max-w-[92vw] p-6 border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50"
          @click.stop
        >
          <div class="flex items-center gap-2.5 mb-4">
            <div
              class="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                stroke-width="2.5"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </div>
            <div>
              <h3 class="text-[14px] font-bold text-brand-dark dark:text-brand-light">
                删除错题本
              </h3>
              <p class="text-[12px] text-brand-mid dark:text-brand-mid mt-0.5">
                将同时删除本错题本内的所有题目及复习记录，此操作不可撤销。
              </p>
            </div>
          </div>
          <p v-if="mutationError" role="alert" class="ui-inline-error">{{ mutationError }}</p>
          <div class="flex justify-end gap-2">
            <button
              :disabled="!!notebookMutation"
              data-ui-variant="default"
              type="button"
              data-dialog-cancel
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] font-medium border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 text-brand-dark dark:text-brand-mid hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelDelete"
            >
              取消
            </button>
            <button
              :disabled="!!notebookMutation"
              data-ui-variant="danger"
              type="button"
              class="ui-control px-4 py-2 rounded-[8px] text-[13px] font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              @click="confirmDelete"
            >
              {{ notebookMutation ? '处理中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
