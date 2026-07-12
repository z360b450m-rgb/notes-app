// 知识库列表 + 当前选中的 KB。后端 /kbs 是真源；前端 localStorage 缓存上次选中的 KB。
import { ref } from 'vue'

const DEFAULT_BASE_URL = 'http://localhost:8000'
const SELECTED_KB_KEY = 'selected_kb_id_v1'
export const DEFAULT_KB_ID = 'notes'

export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  created_at?: number
  is_default?: boolean
}

const kbs = ref<KnowledgeBase[]>([{ id: DEFAULT_KB_ID, name: '错题库', is_default: true }])
const currentKbId = ref<string>(localStorage.getItem(SELECTED_KB_KEY) || DEFAULT_KB_ID)
const loading = ref(false)
const lastError = ref<string | null>(null)

function persistSelection(id: string) {
  localStorage.setItem(SELECTED_KB_KEY, id)
}

export function useKnowledgeBases(opts?: { baseUrl?: string }) {
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE_URL

  async function refresh() {
    loading.value = true
    lastError.value = null
    try {
      const resp = await fetch(`${baseUrl}/kbs`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = (await resp.json()) as KnowledgeBase[]
      kbs.value = data
      // 当前 kb 不存在则回退到默认
      if (!data.some((k) => k.id === currentKbId.value)) {
        select(DEFAULT_KB_ID)
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function select(id: string) {
    currentKbId.value = id
    persistSelection(id)
  }

  async function create(payload: { id: string; name: string; description?: string }) {
    const resp = await fetch(`${baseUrl}/kbs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`新建失败：${resp.status} ${text}`)
    }
    await refresh()
  }

  async function rename(id: string, payload: { name: string; description?: string }) {
    const resp = await fetch(`${baseUrl}/kbs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`重命名失败：${resp.status} ${text}`)
    }
    await refresh()
  }

  async function remove(id: string) {
    const resp = await fetch(`${baseUrl}/kbs/${id}`, { method: 'DELETE' })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`删除失败：${resp.status} ${text}`)
    }
    if (currentKbId.value === id) select(DEFAULT_KB_ID)
    await refresh()
  }

  async function reindex(id: string, reset = true) {
    const resp = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kb_id: id, reset }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`重建索引失败：${resp.status} ${text}`)
    }
    return resp.json()
  }

  async function dataDir(id: string): Promise<string> {
    const resp = await fetch(`${baseUrl}/kbs/${id}/data-dir`)
    if (!resp.ok) throw new Error('取数据目录失败')
    const data = (await resp.json()) as { data_dir: string }
    return data.data_dir
  }

  return {
    kbs,
    currentKbId,
    loading,
    lastError,
    refresh,
    select,
    create,
    rename,
    remove,
    reindex,
    dataDir,
  }
}
