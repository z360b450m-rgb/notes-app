import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { NoteEntry } from '@/types'

interface ExtrasStore {
  subjects: string[]
  tags: string[]
  sources: string[]
}

const GLOBAL_KEY = 'meta_extras_v2__global'

function makeKey(notebookId: string): string {
  return `meta_extras_v2_${notebookId || '_global'}`
}

function loadExtras(key: string): ExtrasStore {
  try {
    const raw = localStorage.getItem(key)
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

function saveExtras(key: string, store: ExtrasStore) {
  try {
    localStorage.setItem(key, JSON.stringify(store))
  } catch {
    /* quota exceeded or unavailable */
  }
}

function uniqSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
}

export interface MetaStore {
  allSubjects: ComputedRef<string[]>
  allTags: ComputedRef<string[]>
  allSources: ComputedRef<string[]>
  addSubject: (name: string, global?: boolean) => void
  removeSubject: (name: string) => void
  renameSubject: (oldName: string, newName: string) => void
  addTag: (name: string, global?: boolean) => void
  removeTag: (name: string) => void
  renameTag: (oldName: string, newName: string) => void
  addSource: (name: string, global?: boolean) => void
  removeSource: (name: string) => void
  renameSource: (oldName: string, newName: string) => void
}

export function useMetaStore(entries: Ref<NoteEntry[]>, getNotebookId: () => string): MetaStore {
  const storageKey = computed(() => makeKey(getNotebookId()))

  const extrasStore = ref<ExtrasStore>(loadExtras(storageKey.value))
  const globalExtras = ref<ExtrasStore>(loadExtras(GLOBAL_KEY))

  function persist() {
    saveExtras(storageKey.value, extrasStore.value)
  }

  function persistGlobal() {
    saveExtras(GLOBAL_KEY, globalExtras.value)
  }

  watch(storageKey, (newKey) => {
    extrasStore.value = loadExtras(newKey)
  })

  // Merge per-notebook extras + global extras + entry data
  const allSubjects = computed(() =>
    uniqSorted([
      ...entries.value.map((e) => e.subject).filter(Boolean),
      ...extrasStore.value.subjects,
      ...globalExtras.value.subjects,
    ]),
  )

  const allTags = computed(() =>
    uniqSorted([
      ...entries.value.flatMap((e) => e.tags || []),
      ...extrasStore.value.tags,
      ...globalExtras.value.tags,
    ]),
  )

  const allSources = computed(() =>
    uniqSorted([
      ...entries.value.map((e) => e.source).filter(Boolean),
      ...extrasStore.value.sources,
      ...globalExtras.value.sources,
    ]),
  )

  // ── Subjects ──

  function addSubject(name: string, global = false) {
    const trimmed = name.trim()
    if (!trimmed) return
    const target = global ? globalExtras : extrasStore
    const persistFn = global ? persistGlobal : persist
    if (!target.value.subjects.includes(trimmed)) {
      target.value = {
        ...target.value,
        subjects: [...target.value.subjects, trimmed],
      }
      persistFn()
    }
  }

  function removeSubject(name: string) {
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      if (store.value.subjects.includes(name)) {
        store.value = {
          ...store.value,
          subjects: store.value.subjects.filter((s) => s !== name),
        }
        persistFn()
      }
    }
  }

  function renameSubject(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      const subjects = store.value.subjects
      const idx = subjects.indexOf(oldName)
      if (idx === -1) continue
      const replaced = [...subjects]
      if (subjects.includes(trimmed)) {
        replaced.splice(idx, 1)
      } else {
        replaced[idx] = trimmed
      }
      store.value = { ...store.value, subjects: replaced }
      persistFn()
      return
    }
  }

  // ── Tags ──

  function addTag(name: string, global = false) {
    const trimmed = name.trim()
    if (!trimmed) return
    const target = global ? globalExtras : extrasStore
    const persistFn = global ? persistGlobal : persist
    if (!target.value.tags.includes(trimmed)) {
      target.value = {
        ...target.value,
        tags: [...target.value.tags, trimmed],
      }
      persistFn()
    }
  }

  function removeTag(name: string) {
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      if (store.value.tags.includes(name)) {
        store.value = {
          ...store.value,
          tags: store.value.tags.filter((t) => t !== name),
        }
        persistFn()
      }
    }
  }

  function renameTag(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      const tags = store.value.tags
      const idx = tags.indexOf(oldName)
      if (idx === -1) continue
      const replaced = [...tags]
      if (tags.includes(trimmed)) {
        replaced.splice(idx, 1)
      } else {
        replaced[idx] = trimmed
      }
      store.value = { ...store.value, tags: replaced }
      persistFn()
      return
    }
  }

  // ── Sources ──

  function addSource(name: string, global = false) {
    const trimmed = name.trim()
    if (!trimmed) return
    const target = global ? globalExtras : extrasStore
    const persistFn = global ? persistGlobal : persist
    if (!target.value.sources.includes(trimmed)) {
      target.value = {
        ...target.value,
        sources: [...target.value.sources, trimmed],
      }
      persistFn()
    }
  }

  function removeSource(name: string) {
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      if (store.value.sources.includes(name)) {
        store.value = {
          ...store.value,
          sources: store.value.sources.filter((s) => s !== name),
        }
        persistFn()
      }
    }
  }

  function renameSource(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    for (const [store, persistFn] of [
      [extrasStore, persist] as const,
      [globalExtras, persistGlobal] as const,
    ]) {
      const sources = store.value.sources
      const idx = sources.indexOf(oldName)
      if (idx === -1) continue
      const replaced = [...sources]
      if (sources.includes(trimmed)) {
        replaced.splice(idx, 1)
      } else {
        replaced[idx] = trimmed
      }
      store.value = { ...store.value, sources: replaced }
      persistFn()
      return
    }
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
