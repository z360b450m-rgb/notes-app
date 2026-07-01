import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry } from '@/types'
import { MASTERY_LEVEL_DEFS, getMasteryLevel } from '@/composables/useStats'

export type SortKey = 'updatedAt' | 'createdAt' | 'subject' | 'title' | 'custom' | 'shuffle'
export type SortDir = 'asc' | 'desc'

export interface FilterState {
  activeSubject: Ref<string>
  activeTag: Ref<string | null>
  activeSource: Ref<string | null>
  activeMastery: Ref<string>
  searchQuery: Ref<string>
  sortKey: Ref<SortKey>
  sortDir: Ref<SortDir>
  filteredEntries: ComputedRef<NoteEntry[]>
  subjectMap: ComputedRef<Record<string, number>>
  tagMap: ComputedRef<Record<string, number>>
  sourceMap: ComputedRef<Record<string, number>>
  masteryMap: ComputedRef<Record<string, number>>
  setSubject: (s: string) => void
  setTag: (t: string) => void
  setSource: (s: string) => void
  setMastery: (label: string) => void
  setSearch: (q: string) => void
  setSort: (key: SortKey, dir?: SortDir) => void
}

// ===================================================================
// @AI-GUIDE: 筛选、搜索与排序逻辑层
// 纯业务逻辑。学科/标签/掌握程度筛选、关键词搜索、多维度排序
// 均在此实现。FilterState 返回值类型必须向后兼容。
// ===================================================================
export function useFilter(entries: Ref<NoteEntry[]>): FilterState {
  const activeSubject = ref('__all__')
  const activeTag = ref<string | null>(null)
  const activeSource = ref<string | null>(null)
  const activeMastery = ref('__all__')
  const searchQuery = ref('')
  const sortKey = ref<SortKey>('updatedAt')
  const sortDir = ref<SortDir>('desc')
  const shuffleSeed = ref(0)

  const filteredEntries = computed(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _seed = shuffleSeed.value // re-compute when shuffle is clicked again
    let list = [...entries.value]

    if (activeSubject.value !== '__all__') {
      if (activeSubject.value === '__none__') {
        list = list.filter((e) => !e.subject)
      } else {
        list = list.filter((e) => e.subject === activeSubject.value)
      }
    }

    if (activeTag.value) {
      list = list.filter((e) => e.tags?.includes(activeTag.value!))
    }

    if (activeSource.value) {
      list = list.filter((e) => e.source === activeSource.value)
    }

    if (activeMastery.value !== '__all__') {
      const bucket = MASTERY_LEVEL_DEFS.find((b) => b.label === activeMastery.value)
      if (bucket) {
        list = list.filter((e) => getMasteryLevel(e) === bucket.level)
      }
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase()
      list = list.filter(
        (e) =>
          (e.question || '').toLowerCase().includes(q) ||
          (e.wrongAnswer || '').toLowerCase().includes(q) ||
          (e.correctAnswer || '').toLowerCase().includes(q) ||
          (e.subject || '').toLowerCase().includes(q) ||
          (e.source || '').toLowerCase().includes(q),
      )
    }

    const dir = sortDir.value === 'asc' ? 1 : -1

    switch (sortKey.value) {
      case 'createdAt':
        list.sort((a, b) => (a.createdAt - b.createdAt) * dir)
        break
      case 'subject':
        list.sort(
          (a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), 'zh') * dir,
        )
        break
      case 'title':
        list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh') * dir)
        break
      case 'custom':
        list.sort((a, b) => {
          const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER
          const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER
          if (ao !== bo) return (ao - bo) * dir
          return (a.updatedAt - b.updatedAt) * dir
        })
        break
      case 'shuffle':
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[list[i], list[j]] = [list[j], list[i]]
        }
        break
      default:
        list.sort((a, b) => (a.updatedAt - b.updatedAt) * dir)
    }

    return list
  })

  const subjectMap = computed(() => {
    const map: Record<string, number> = {}
    entries.value.forEach((e) => {
      if (e.subject) map[e.subject] = (map[e.subject] || 0) + 1
    })
    return map
  })

  const tagMap = computed(() => {
    const map: Record<string, number> = {}
    entries.value.forEach((e) =>
      (e.tags || []).forEach((t) => {
        map[t] = (map[t] || 0) + 1
      }),
    )
    return map
  })

  const sourceMap = computed(() => {
    const map: Record<string, number> = {}
    entries.value.forEach((e) => {
      if (e.source) map[e.source] = (map[e.source] || 0) + 1
    })
    return map
  })

  function setSubject(s: string) {
    activeSubject.value = s
  }

  function setTag(t: string) {
    if (t === '__all__') {
      activeTag.value = null
    } else {
      activeTag.value = activeTag.value === t ? null : t
    }
  }

  function setSource(s: string) {
    if (s === '__all__') {
      activeSource.value = null
    } else {
      activeSource.value = activeSource.value === s ? null : s
    }
  }

  const masteryMap = computed(() => {
    const map: Record<string, number> = {}
    for (const b of MASTERY_LEVEL_DEFS) map[b.label] = 0
    entries.value.forEach((e) => {
      const level = getMasteryLevel(e)
      const bucket = MASTERY_LEVEL_DEFS.find((b) => b.level === level)
      if (bucket) map[bucket.label]++
    })
    return map
  })

  function setMastery(label: string) {
    activeMastery.value = activeMastery.value === label ? '__all__' : label
  }

  function setSearch(q: string) {
    searchQuery.value = q
  }

  function setSort(key: SortKey, dir?: SortDir) {
    if (key === 'shuffle') {
      sortKey.value = 'shuffle'
      shuffleSeed.value++
      return
    }
    if (sortKey.value === key && !dir) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey.value = key
      sortDir.value = dir || 'desc'
    }
  }

  return {
    activeSubject,
    activeTag,
    activeSource,
    activeMastery,
    searchQuery,
    sortKey,
    sortDir,
    filteredEntries,
    subjectMap,
    tagMap,
    sourceMap,
    masteryMap,
    setSubject,
    setTag,
    setSource,
    setMastery,
    setSearch,
    setSort,
  }
}
