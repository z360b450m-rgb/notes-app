import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry } from '@/types'

const EXTRAS_KEY = 'meta_extras_v1'

interface ExtrasStore {
  subjects: string[]
  tags: string[]
  sources: string[]
}

function loadExtras(): ExtrasStore {
  try {
    const raw = localStorage.getItem(EXTRAS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (
        parsed &&
        Array.isArray(parsed.subjects) &&
        Array.isArray(parsed.tags) &&
        Array.isArray(parsed.sources)
      ) {
        return parsed
      }
    }
  } catch {
    /* ignore corrupt data */
  }
  return { subjects: [], tags: [], sources: [] }
}

function saveExtras(store: ExtrasStore) {
  try {
    localStorage.setItem(EXTRAS_KEY, JSON.stringify(store))
  } catch {
    /* quota exceeded or unavailable */
  }
}

const extrasStore = ref<ExtrasStore>(loadExtras())

function persist() {
  saveExtras(extrasStore.value)
}

function uniqSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
}

export interface MetaStore {
  allSubjects: ComputedRef<string[]>
  allTags: ComputedRef<string[]>
  allSources: ComputedRef<string[]>
  addSubject: (name: string) => void
  removeSubject: (name: string) => void
  renameSubject: (oldName: string, newName: string) => void
  addTag: (name: string) => void
  removeTag: (name: string) => void
  renameTag: (oldName: string, newName: string) => void
  addSource: (name: string) => void
  removeSource: (name: string) => void
  renameSource: (oldName: string, newName: string) => void
}

export function useMetaStore(entries: Ref<NoteEntry[]>): MetaStore {
  const allSubjects = computed(() =>
    uniqSorted([
      ...entries.value.map((e) => e.subject).filter(Boolean),
      ...extrasStore.value.subjects,
    ]),
  )

  const allTags = computed(() =>
    uniqSorted([...entries.value.flatMap((e) => e.tags || []), ...extrasStore.value.tags]),
  )

  const allSources = computed(() =>
    uniqSorted([
      ...entries.value.map((e) => e.source).filter(Boolean),
      ...extrasStore.value.sources,
    ]),
  )

  function addSubject(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!extrasStore.value.subjects.includes(trimmed)) {
      extrasStore.value = {
        ...extrasStore.value,
        subjects: [...extrasStore.value.subjects, trimmed],
      }
      persist()
    }
  }

  function removeSubject(name: string) {
    extrasStore.value = {
      ...extrasStore.value,
      subjects: extrasStore.value.subjects.filter((s) => s !== name),
    }
    persist()
  }

  function addTag(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!extrasStore.value.tags.includes(trimmed)) {
      extrasStore.value = {
        ...extrasStore.value,
        tags: [...extrasStore.value.tags, trimmed],
      }
      persist()
    }
  }

  function removeTag(name: string) {
    extrasStore.value = {
      ...extrasStore.value,
      tags: extrasStore.value.tags.filter((t) => t !== name),
    }
    persist()
  }

  function addSource(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (!extrasStore.value.sources.includes(trimmed)) {
      extrasStore.value = {
        ...extrasStore.value,
        sources: [...extrasStore.value.sources, trimmed],
      }
      persist()
    }
  }

  function removeSource(name: string) {
    extrasStore.value = {
      ...extrasStore.value,
      sources: extrasStore.value.sources.filter((s) => s !== name),
    }
    persist()
  }

  function renameSubject(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const subjects = extrasStore.value.subjects
    const idx = subjects.indexOf(oldName)
    if (idx === -1) return
    const replaced = [...subjects]
    if (subjects.includes(trimmed)) {
      // Merge: remove old name, new name already exists
      replaced.splice(idx, 1)
    } else {
      replaced[idx] = trimmed
    }
    extrasStore.value = { ...extrasStore.value, subjects: replaced }
    persist()
  }

  function renameTag(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const tags = extrasStore.value.tags
    const idx = tags.indexOf(oldName)
    if (idx === -1) return
    const replaced = [...tags]
    if (tags.includes(trimmed)) {
      replaced.splice(idx, 1)
    } else {
      replaced[idx] = trimmed
    }
    extrasStore.value = { ...extrasStore.value, tags: replaced }
    persist()
  }

  function renameSource(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const sources = extrasStore.value.sources
    const idx = sources.indexOf(oldName)
    if (idx === -1) return
    const replaced = [...sources]
    if (sources.includes(trimmed)) {
      replaced.splice(idx, 1)
    } else {
      replaced[idx] = trimmed
    }
    extrasStore.value = { ...extrasStore.value, sources: replaced }
    persist()
  }

  return {
    allSubjects,
    allTags,
    allSources,
    addSubject,
    removeSubject,
    renameSubject,
    addTag,
    removeTag,
    renameTag,
    addSource,
    removeSource,
    renameSource,
  }
}
