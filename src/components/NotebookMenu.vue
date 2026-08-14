<script setup lang="ts">
// @AI-NOTE: 错题本菜单组件 —— 数据操作通过 useNotebooks Hook。
// 禁止直接操作存储、编写业务逻辑、管理跨组件状态。
import { ref, computed, watch } from 'vue'
import { useNotebooks } from '@/composables/useNotebooks'
import { entryRepository, reviewLogRepository } from '@/services/db'
import type { NoteEntry, ReviewLog } from '@/types'
import { useDarkMode } from '@/composables/useDarkMode'
import { useModalAnimations } from '@/composables/useModalAnimations'

const emit = defineEmits<{
  enter: [id: string]
  created: [id: string]
  'open-settings': []
}>()

const { isDark } = useDarkMode()
const { enterModal, leaveModal } = useModalAnimations()
const { notebooks, createNotebook, updateNotebook, deleteNotebook, reorderNotebooks } =
  useNotebooks()
// Load all entries independently — decoupled from the shared entries ref
// which gets filtered to a single notebook during the page transition.
const menuEntries = ref<NoteEntry[]>([])
const menuReviewLogs = ref<ReviewLog[]>([])
let statsLoadSequence = 0

watch(
  () => notebooks.value.map((notebook) => notebook.id),
  async (notebookIds) => {
    const sequence = ++statsLoadSequence
    try {
      const [entriesByNotebook, logsByNotebook] = await Promise.all([
        Promise.all(notebookIds.map((notebookId) => entryRepository.getAll(notebookId))),
        Promise.all(notebookIds.map((notebookId) => reviewLogRepository.getAll(notebookId))),
      ])
      if (sequence !== statsLoadSequence) return
      menuEntries.value = entriesByNotebook.flat()
      menuReviewLogs.value = logsByNotebook.flat()
    } catch (error) {
      console.error('Failed to load notebook menu statistics', error)
      if (sequence !== statsLoadSequence) return
      menuEntries.value = []
      menuReviewLogs.value = []
    }
  },
  { immediate: true },
)

const entryCountByNotebook = computed(() => {
  const map: Record<string, number> = {}
  for (const e of menuEntries.value) {
    if (e.notebookId) map[e.notebookId] = (map[e.notebookId] || 0) + 1
  }
  return map
})

const totalEntries = computed(() => {
  let sum = 0
  for (const c of Object.values(entryCountByNotebook.value)) sum += c
  return sum
})

// ── Review stats ──
const todayStart = new Date()
todayStart.setHours(0, 0, 0, 0)
const t0 = todayStart.getTime()

const reviewedToday = computed(() => {
  return menuReviewLogs.value.filter((l) => l.timestamp >= t0).length
})

// Entries currently still due (nextReviewDate <= now) — pending, not yet reviewed today
const stillDue = computed(() => {
  const now = Date.now()
  return menuEntries.value.filter((e) => e.nextReviewDate && e.nextReviewDate <= now).length
})

const stillDueByNotebook = computed(() => {
  const now = Date.now()
  const map: Record<string, number> = {}
  for (const e of menuEntries.value) {
    if (e.nextReviewDate && e.nextReviewDate <= now && e.notebookId) {
      map[e.notebookId] = (map[e.notebookId] || 0) + 1
    }
  }
  return map
})

// Entry id → notebook id lookup for cross-referencing review logs
const entryNotebookMap = computed(() => {
  const map: Record<string, string> = {}
  for (const e of menuEntries.value) {
    map[e.id] = e.notebookId
  }
  return map
})

// Today's completed reviews per notebook
const reviewedByNotebook = computed(() => {
  const map: Record<string, number> = {}
  for (const log of menuReviewLogs.value) {
    if (log.timestamp >= t0) {
      const nbId = entryNotebookMap.value[log.entryId]
      if (nbId) {
        map[nbId] = (map[nbId] || 0) + 1
      }
    }
  }
  return map
})

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
const activeNav = ref<'home' | 'review' | 'report' | 'plan'>('home')

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

function openCreate() {
  showCreate.value = true
  createName.value = ''
  createDesc.value = ''
  createErr.value = ''
}
function cancelCreate() {
  showCreate.value = false
}
async function confirmCreate() {
  if (!createName.value.trim()) return
  try {
    await createNotebook(createName.value.trim(), createDesc.value.trim(), '')
    showCreate.value = false
  } catch {
    createErr.value = '创建失败，请重试'
  }
}

// ── Edit notebook ──
const editingId = ref<string | null>(null)
const editName = ref('')
const editDesc = ref('')
function startEdit(nb: { id: string; name: string; description: string }) {
  editingId.value = nb.id
  editName.value = nb.name
  editDesc.value = nb.description
}
function cancelEdit() {
  editingId.value = null
}
async function confirmEdit() {
  if (!editingId.value || !editName.value.trim()) return
  await updateNotebook(editingId.value, {
    name: editName.value.trim(),
    description: editDesc.value.trim(),
  })
  editingId.value = null
}

// ── Delete notebook ──
const deletingId = ref<string | null>(null)
function startDelete(id: string) {
  deletingId.value = id
}
function cancelDelete() {
  deletingId.value = null
}
async function confirmDelete() {
  if (!deletingId.value) return
  await deleteNotebook(deletingId.value)
  deletingId.value = null
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

// ── Drag-and-drop within sidebar ──
const draggedId = ref<string | null>(null)
const dragOverIdx = ref<number | null>(null)
let dragJustEnded = false

function onDragStart(e: DragEvent, id: string) {
  draggedId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}
function onDragOver(e: DragEvent, idx: number) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverIdx.value = idx
}
function onDragLeave() {
  dragOverIdx.value = null
}
function onDrop(e: DragEvent, dropIdx: number) {
  e.preventDefault()
  const srcId = draggedId.value
  dragOverIdx.value = null
  draggedId.value = null
  if (!srcId) return
  const ids = notebooks.value.map((n) => n.id)
  const srcIdx = ids.indexOf(srcId)
  if (srcIdx === -1 || srcIdx === dropIdx) return
  ids.splice(srcIdx, 1)
  ids.splice(dropIdx, 0, srcId)
  reorderNotebooks(ids)
}
function onDragEnd() {
  draggedId.value = null
  dragOverIdx.value = null
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
    class="flex h-screen bg-[#faf9f5] dark:bg-[#141413] text-brand-dark dark:text-brand-light font-sans"
  >
    <!-- ═══════════ LEFT SIDEBAR ═══════════ -->
    <aside
      class="w-[220px] flex-shrink-0 bg-white dark:bg-[#1e1e1c] border-r border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 flex flex-col"
    >
      <!-- Logo + Nav -->
      <div class="px-5 pt-8 pb-4">
        <div class="flex flex-col gap-1 mb-8">
          <span
            class="text-[22px] font-bold text-brand-dark dark:text-brand-light font-display tracking-tight leading-none"
            >错题本</span
          >
          <span class="block w-8 h-[3px] rounded-full bg-accent" />
        </div>

        <nav class="space-y-1">
          <button
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
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors duration-150"
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

      <!-- Divider -->
      <div class="mx-5 h-[3px] bg-[#e8e6dc] dark:bg-[#2e2e2c]" />

      <!-- Notebook list -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <div class="flex items-center justify-between mb-3">
          <span
            class="text-[11px] font-semibold text-brand-mid dark:text-brand-mid uppercase tracking-[1px]"
            >我的错题本</span
          >
          <span class="text-[10px] text-brand-mid dark:text-brand-mid tabular-nums">{{
            notebooks.length
          }}</span>
        </div>

        <div class="space-y-0.5">
          <button
            v-for="(nb, idx) in notebooks"
            :key="nb.id"
            draggable="true"
            class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[13px] transition-colors duration-150 group"
            :class="
              dragOverIdx === idx
                ? 'bg-[#fdf0e8]/50 dark:bg-[#2e2018]/50'
                : 'hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28]'
            "
            @click="onNotebookClick(nb.id)"
            @dragstart="onDragStart($event, nb.id)"
            @dragover="onDragOver($event, idx)"
            @dragleave="onDragLeave"
            @drop="onDrop($event, idx)"
            @dragend="onDragEnd"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: dotColor(idx) }"
            />
            <span class="flex-1 text-left truncate text-brand-dark dark:text-brand-light-gray">{{
              nb.name
            }}</span>
            <span class="text-[11px] text-brand-mid dark:text-brand-mid tabular-nums"
              >{{ entryCountByNotebook[nb.id] || 0 }} · {{ reviewedByNotebook[nb.id] || 0 }}/{{
                dueByNotebook[nb.id] || 0
              }}</span
            >
          </button>
        </div>

        <button
          class="w-full flex items-center gap-2 px-2.5 py-1.5 mt-1 rounded-[8px] text-[13px] text-brand-mid dark:text-brand-mid hover:text-[#d97757] dark:text-[#f0c4a8] hover:bg-[#fdf0e8]/30 dark:hover:bg-[#2e2018]/30 transition-colors duration-150"
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

      <!-- Settings -->
      <div class="px-5 py-3 border-t border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50">
        <button
          class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-[13px] text-brand-mid dark:text-brand-mid hover:text-brand-dark dark:text-brand-mid hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
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
    <main class="flex-1 flex flex-col min-w-0 overflow-y-auto">
      <!-- Top bar -->
      <div class="flex items-center justify-between px-8 py-4">
        <h1 class="text-[18px] font-semibold text-brand-dark dark:text-brand-light">
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
        <div class="flex items-center gap-3">
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
              class="w-[220px] pl-9 pr-3 py-1.5 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light outline-none focus:border-[#d97757] bg-white dark:bg-[#1e1e1c] placeholder-[#888] dark:placeholder-[#aaa] transition-colors"
            />
          </div>
        </div>
      </div>

      <div class="flex-1 px-8 pb-12 space-y-6">
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
              <div class="text-[28px] font-bold text-brand-dark dark:text-brand-light leading-none">
                {{ notebooks.length }}
              </div>
              <div class="text-[13px] text-brand-mid dark:text-brand-mid mt-1.5">错题本</div>
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
              <div class="text-[28px] font-bold text-brand-dark dark:text-brand-light leading-none">
                {{ totalEntries }}
              </div>
              <div class="text-[13px] text-brand-mid dark:text-brand-mid mt-1.5">总题数</div>
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
              <div class="text-[28px] font-bold text-brand-dark dark:text-brand-light leading-none">
                {{ reviewedToday }}/{{ totalDue }}
              </div>
              <div class="text-[13px] text-brand-mid dark:text-brand-mid mt-1.5">
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
            <p
              class="text-[14px] text-[#141413] dark:text-[#f0c4a8] font-serif italic leading-relaxed"
            >
              {{ randomQuote }}
            </p>
          </div>

          <!-- Notebook table -->
          <div
            class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 overflow-hidden"
          >
            <!-- Table header -->
            <div
              class="flex items-center px-5 py-3 text-[12px] font-semibold text-brand-mid dark:text-brand-mid uppercase tracking-[0.5px] border-b border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50"
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
                class="flex items-center px-5 py-3 border-b border-[#e8e6dc]/30 dark:border-[#2e2e2c]/30 hover:bg-[#faf9f5] dark:hover:bg-[#242422] transition-colors duration-150 cursor-pointer"
                @click="onEnterNotebook(nb.id)"
              >
                <div class="flex-[2] flex items-center gap-2.5 min-w-0">
                  <span
                    class="w-3 h-3 rounded-[3px] flex-shrink-0"
                    :style="{ backgroundColor: dotColor(idx) }"
                  />
                  <span
                    class="text-[14px] text-brand-dark dark:text-brand-light-gray font-medium truncate group-hover:text-[#d97757] dark:text-[#f0c4a8]"
                    >{{ nb.name }}</span
                  >
                </div>
                <span class="flex-[1.5] text-[13px] text-brand-mid dark:text-brand-mid tabular-nums"
                  >{{ entryCountByNotebook[nb.id] || 0 }} 题 ·
                  {{ reviewedByNotebook[nb.id] || 0 }}/{{ dueByNotebook[nb.id] || 0 }}</span
                >
                <span class="flex-[1.5] text-[13px] text-brand-mid dark:text-brand-mid">{{
                  fmtTime(nb.updatedAt)
                }}</span>
                <span class="flex-[1]">
                  <span
                    v-if="nb.description"
                    class="inline-block px-2 py-0.5 rounded-[10px] text-[11px] bg-[#fdf0e8] dark:bg-[#2e2018] text-[#d97757] dark:text-[#f0c4a8] font-medium"
                    >{{ shortDesc(nb.description) }}</span
                  >
                </span>
                <div class="flex-[1.5] flex items-center justify-end gap-1">
                  <button
                    class="w-7 h-7 flex items-center justify-center rounded-[8px] text-brand-mid dark:text-[#999] hover:text-[#d97757] dark:text-[#f0c4a8] hover:bg-[#fdf0e8]/50 dark:hover:bg-[#2e2018]/50 transition-colors"
                    title="编辑"
                    @click.stop="startEdit(nb)"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    class="w-7 h-7 flex items-center justify-center rounded-[8px] text-brand-mid dark:text-[#999] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    title="删除"
                    @click.stop="startDelete(nb.id)"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-if="notebooks.length === 0"
              class="px-5 py-12 text-center text-[13px] text-brand-mid dark:text-[#999]"
            >
              还没有错题本，点击下方按钮创建第一个
            </div>

            <!-- Add new row -->
            <button
              class="w-full flex items-center justify-center gap-1.5 px-5 py-3 text-[13px] text-brand-mid dark:text-brand-mid hover:text-[#d97757] dark:text-[#f0c4a8] hover:bg-[#fdf0e8]/20 dark:hover:bg-[#2e2018]/20 border-t border-dashed border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 transition-colors duration-150"
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

        <!-- PLAN VIEW (placeholder) -->
        <template v-else-if="activeNav === 'plan'">
          <div
            class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-8 text-center text-brand-mid dark:text-brand-mid text-[14px]"
          >
            复习计划功能即将上线
          </div>
        </template>

        <!-- REVIEW VIEW (placeholder) -->
        <template v-else-if="activeNav === 'review'">
          <div
            class="bg-white dark:bg-[#1e1e1c] rounded-[12px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 p-8"
          >
            <h3 class="text-[15px] font-semibold text-brand-dark dark:text-brand-light mb-4">
              选择要复习的错题本
            </h3>
            <div class="space-y-2">
              <button
                v-for="(nb, idx) in notebooks"
                :key="nb.id"
                class="w-full flex items-center gap-3 px-4 py-3 rounded-[10px] border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 hover:border-[#d97757] hover:bg-[#fdf0e8]/10 dark:hover:bg-[#2e2018]/10 transition-colors text-left"
                @click="onEnterNotebook(nb.id)"
              >
                <span
                  class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: dotColor(idx) }"
                />
                <span class="flex-1 text-[14px] text-brand-dark dark:text-brand-light-gray">{{
                  nb.name
                }}</span>
                <span class="text-[12px] text-brand-mid dark:text-brand-mid"
                  >{{ entryCountByNotebook[nb.id] || 0 }} 题 ·
                  {{ reviewedByNotebook[nb.id] || 0 }}/{{ dueByNotebook[nb.id] || 0 }}</span
                >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  :stroke="isDark ? '#f0c4a8' : '#d97757'"
                  stroke-width="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <div
                v-if="notebooks.length === 0"
                class="text-center text-brand-mid dark:text-brand-mid text-[13px] py-8"
              >
                还没有错题本
              </div>
            </div>
          </div>
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
                v-model="createName"
                data-testid="notebook-name"
                type="text"
                placeholder="例如：数学错题本"
                class="w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmCreate"
              />
            </div>
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >简介</label
              >
              <input
                v-model="createDesc"
                data-testid="notebook-description"
                type="text"
                placeholder="简短描述"
                class="w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmCreate"
              />
            </div>
          </div>
          <div v-if="createErr" class="text-[12px] text-red-500 mt-2">{{ createErr }}</div>
          <div class="flex justify-end gap-2 mt-5">
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] text-brand-dark dark:text-brand-mid border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelCreate"
            >
              取消
            </button>
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] bg-[#d97757] text-white font-medium hover:bg-[#c56a48] transition-colors disabled:opacity-40"
              data-testid="confirm-create-notebook"
              :disabled="!createName.trim()"
              @click="confirmCreate"
            >
              创建
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
                v-model="editName"
                type="text"
                class="w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmEdit"
              />
            </div>
            <div>
              <label class="text-[12px] font-medium text-brand-dark dark:text-brand-mid"
                >简介</label
              >
              <input
                v-model="editDesc"
                type="text"
                class="w-full mt-1 px-3 py-2 rounded-[8px] border border-[#e8e6dc] dark:border-[#2e2e2c] text-[13px] text-brand-dark dark:text-brand-light bg-white dark:bg-[#1e1e1c] outline-none focus:border-[#d97757] transition-colors"
                @keydown.enter="confirmEdit"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] text-brand-dark dark:text-brand-mid border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelEdit"
            >
              取消
            </button>
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] bg-[#d97757] text-white font-medium hover:bg-[#c56a48] transition-colors"
              @click="confirmEdit"
            >
              保存
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
          <div class="flex justify-end gap-2">
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] font-medium border border-[#e8e6dc]/50 dark:border-[#2e2e2c]/50 text-brand-dark dark:text-brand-mid hover:bg-[#e8e6dc] dark:hover:bg-[#2a2a28] transition-colors"
              @click="cancelDelete"
            >
              取消
            </button>
            <button
              class="px-4 py-2 rounded-[8px] text-[13px] font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              @click="confirmDelete"
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
