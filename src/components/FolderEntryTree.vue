<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NoteEntry, QuestionGroup } from '@/types'
import type { SortKey } from '@/composables/useFilter'
import EntryList from './EntryList.vue'
import ConfirmPopover from './ConfirmPopover.vue'
import { useInlineReveal } from '@/composables/useInlineReveal'

const { enterReveal, leaveReveal, clearReveal } = useInlineReveal()

const props = defineProps<{
  entries: NoteEntry[]
  folders: string[]
  questionGroups: QuestionGroup[]
  activeId: string | null
  activeFolder: string | null
  sortKey: SortKey
  selectedIds: Set<string>
  selectedCount: number
}>()

const emit = defineEmits<{
  select: [id: string]
  selectFolder: [folder: string | null]
  renameEntry: [id: string, title: string]
  reorder: [ids: string[]]
  toggleSelect: [id: string]
  rangeSelect: [ids: string[], from: number, to: number]
  renameFolder: [oldName: string, newName: string]
  deleteFolder: [name: string]
  moveSelected: [folder?: string]
}>()

const expanded = ref<Set<string>>(new Set(['__none__']))
const editingFolder = ref<string | null>(null)
const editName = ref('')

watch(
  () => props.folders,
  (folders) => {
    // Refreshing/importing entries must preserve the user's folder choices.
    const available = new Set(['__none__', ...folders])
    expanded.value = new Set([...expanded.value].filter((folder) => available.has(folder)))
  },
)

const unfiledEntries = computed(() => props.entries.filter((entry) => !entry.folder))

function entriesIn(folder: string): NoteEntry[] {
  return props.entries.filter((entry) => entry.folder === folder)
}

function toggleFolder(folder: string | null) {
  const key = folder ?? '__none__'
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
  emit('selectFolder', folder)
}

function startRename(folder: string) {
  editingFolder.value = folder
  editName.value = folder
}

function finishRename(folder: string) {
  if (editingFolder.value !== folder) return
  const name = editName.value.trim()
  if (name && name !== folder) emit('renameFolder', folder, name)
  editingFolder.value = null
}
</script>

<template>
  <div class="pb-2" data-testid="folder-entry-tree">
    <div v-for="folder in folders" :key="folder" class="mb-0.5">
      <div
        class="folder-row group mx-2 flex h-8 items-center rounded-lg px-1.5 text-[12px] transition-colors"
        :class="
          activeFolder === folder
            ? 'bg-accent/10 text-accent'
            : 'text-gray-600 hover:bg-gray-100 dark:text-brand-light-gray dark:hover:bg-[#242422]'
        "
      >
        <button
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
          :title="folder"
          :aria-expanded="expanded.has(folder)"
          @click="toggleFolder(folder)"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            class="shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none"
            :class="expanded.has(folder) ? 'rotate-90' : ''"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            class="shrink-0"
          >
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          <input
            v-if="editingFolder === folder"
            v-model="editName"
            class="min-w-0 flex-1 rounded border border-accent bg-white px-1.5 py-0.5 text-[12px] text-gray-700 outline-none dark:bg-[#141413] dark:text-brand-light"
            autofocus
            @click.stop
            @keydown.enter.stop="finishRename(folder)"
            @keydown.escape.stop="editingFolder = null"
            @blur="finishRename(folder)"
          />
          <span v-else class="min-w-0 flex-1 truncate">{{ folder }}</span>
          <span
            class="shrink-0 text-xs font-normal tabular-nums text-gray-500 dark:text-brand-mid"
            >{{ entriesIn(folder).length }}</span
          >
        </button>

        <button
          v-if="selectedCount"
          class="ml-1 hidden h-6 w-6 items-center justify-center rounded group-hover:flex hover:bg-accent/15"
          :title="`将已选 ${selectedCount} 道错题移入 ${folder}`"
          @click.stop="emit('moveSelected', folder)"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 3v12M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </button>
        <button
          class="hidden h-6 w-6 items-center justify-center rounded group-hover:flex hover:bg-black/5"
          title="重命名文件夹"
          @click.stop="startRename(folder)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <ConfirmPopover
          :label="`删除文件夹：${folder}`"
          title="删除文件夹？"
          :description="`删除“${folder}”后，其中的题目将移至未归档，题目不会被删除。`"
          @confirm="emit('deleteFolder', folder)"
        />
      </div>

      <Transition
        :css="false"
        @enter="enterReveal"
        @leave="leaveReveal"
        @enter-cancelled="clearReveal"
        @leave-cancelled="clearReveal"
      >
        <div
          v-if="expanded.has(folder) && entriesIn(folder).length > 0"
          class="ml-5 border-l border-gray-100 pl-0.5 dark:border-[#2e2e2c]"
        >
          <EntryList
            :entries="entriesIn(folder)"
            :question-groups="questionGroups"
            :active-id="activeId"
            :sort-key="sortKey"
            :selected-ids="selectedIds"
            @select="emit('select', $event)"
            @rename="(id, title) => emit('renameEntry', id, title)"
            @reorder="emit('reorder', $event)"
            @toggle-select="emit('toggleSelect', $event)"
            @range-select="(ids, from, to) => emit('rangeSelect', ids, from, to)"
          />
        </div>
      </Transition>
    </div>

    <div class="mb-0.5">
      <div
        class="folder-row group mx-2 flex h-8 items-center rounded-lg px-1.5 text-[12px] transition-colors"
        :class="
          activeFolder === '__none__'
            ? 'bg-accent/10 text-accent'
            : 'text-gray-600 hover:bg-gray-100 dark:text-brand-light-gray dark:hover:bg-[#242422]'
        "
      >
        <button
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
          :aria-expanded="expanded.has('__none__')"
          @click="toggleFolder(null)"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            class="shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none"
            :class="expanded.has('__none__') ? 'rotate-90' : ''"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            class="shrink-0"
          >
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          <span class="min-w-0 flex-1 truncate">未归档</span>
          <span
            class="shrink-0 text-xs font-normal tabular-nums text-gray-500 dark:text-brand-mid"
            >{{ unfiledEntries.length }}</span
          >
        </button>
        <button
          v-if="selectedCount"
          class="ml-1 hidden h-6 w-6 items-center justify-center rounded group-hover:flex hover:bg-accent/15"
          title="将已选错题移到未归档"
          @click.stop="emit('moveSelected')"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 3v12M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </button>
      </div>
      <Transition
        :css="false"
        @enter="enterReveal"
        @leave="leaveReveal"
        @enter-cancelled="clearReveal"
        @leave-cancelled="clearReveal"
      >
        <div
          v-if="expanded.has('__none__') && unfiledEntries.length > 0"
          class="ml-5 border-l border-gray-100 pl-0.5 dark:border-[#2e2e2c]"
        >
          <EntryList
            :entries="unfiledEntries"
            :question-groups="questionGroups"
            :active-id="activeId"
            :sort-key="sortKey"
            :selected-ids="selectedIds"
            @select="emit('select', $event)"
            @rename="(id, title) => emit('renameEntry', id, title)"
            @reorder="emit('reorder', $event)"
            @toggle-select="emit('toggleSelect', $event)"
            @range-select="(ids, from, to) => emit('rangeSelect', ids, from, to)"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>
