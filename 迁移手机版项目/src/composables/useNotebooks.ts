import { ref, computed } from 'vue'
import type { Notebook } from '@/types'
import { db } from '@/services/db'

function genId(): string {
  return 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

const notebooks = ref<Notebook[]>([])
const activeId = ref<string | null>(null)

const activeNotebook = computed(() => notebooks.value.find((n) => n.id === activeId.value))

async function loadNotebooks() {
  try {
    const list = await db.getAllNotebooks()
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    notebooks.value = list
  } catch (e) {
    console.error('Failed to load notebooks', e)
    notebooks.value = []
  }
}

async function createNotebook(
  name: string,
  description: string,
  instructions: string,
): Promise<Notebook> {
  const now = Date.now()
  const maxOrder = notebooks.value.reduce((max, n) => Math.max(max, n.sortOrder ?? 0), 0)
  const nb: Notebook = {
    id: genId(),
    name,
    description,
    instructions,
    sortOrder: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.putNotebook(nb)
  notebooks.value.push(nb)
  return nb
}

async function updateNotebook(
  id: string,
  partial: Partial<Pick<Notebook, 'name' | 'description' | 'instructions'>>,
) {
  const nb = notebooks.value.find((n) => n.id === id)
  if (!nb) return
  Object.assign(nb, partial, { updatedAt: Date.now() })
  // Spread to plain object — Vue reactive Proxy can't cross Electron IPC
  await db.putNotebook({ ...nb })
}

async function deleteNotebook(id: string) {
  // Cascade: delete all entries in this notebook
  // The Electron main.cjs handles cascade; for idbDb we handle it here
  await db.deleteNotebook(id)
  notebooks.value = notebooks.value.filter((n) => n.id !== id)
  if (activeId.value === id) activeId.value = null
}

const LAST_NOTEBOOK_KEY = 'cuotiben_last_notebook'

function selectNotebook(id: string) {
  activeId.value = id
  try {
    localStorage.setItem(LAST_NOTEBOOK_KEY, id)
  } catch {
    /* ignore */
  }
}

function restoreLastNotebook(): string | null {
  try {
    return localStorage.getItem(LAST_NOTEBOOK_KEY)
  } catch {
    return null
  }
}

function clearLastNotebook() {
  try {
    localStorage.removeItem(LAST_NOTEBOOK_KEY)
  } catch {
    /* ignore */
  }
}

async function reorderNotebooks(orderedIds: string[]) {
  const now = Date.now()
  const updates: Promise<void>[] = []
  orderedIds.forEach((id, idx) => {
    const nb = notebooks.value.find((n) => n.id === id)
    if (nb) {
      nb.sortOrder = idx
      nb.updatedAt = now
      updates.push(db.putNotebook({ ...nb }))
    }
  })
  await Promise.all(updates)
  // Trigger Vue reactivity by replacing the array reference.
  // In-place .sort() on a reactive proxy may not reliably cause re-render.
  notebooks.value = [...notebooks.value].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

// ===================================================================
// @AI-GUIDE: 错题本 CRUD 与状态管理层
// 纯业务逻辑。错题本创建/更新/删除/排序均在此实现。
// 模块级单例 ref (notebooks, activeId) 在组件间共享状态。
// 返回值类型签名必须向后兼容。
// ===================================================================
export function useNotebooks() {
  return {
    notebooks,
    activeId,
    activeNotebook,
    loadNotebooks,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    selectNotebook,
    restoreLastNotebook,
    clearLastNotebook,
    reorderNotebooks,
  }
}
