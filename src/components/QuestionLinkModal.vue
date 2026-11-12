<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
import { computed, nextTick, ref, watch } from 'vue'
import type { NoteEntry } from '@/types'

const props = defineProps<{
  visible: boolean
  entries: NoteEntry[]
  currentEntryId: string
  linkedTargetId?: string | null
}>()

const emit = defineEmits<{
  choose: [entry: NoteEntry]
  open: [id: string]
  remove: []
  cancel: []
}>()

const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const linkedEntry = computed(() =>
  props.linkedTargetId
    ? props.entries.find((entry) => entry.id === props.linkedTargetId) || null
    : null,
)

const filteredEntries = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return props.entries
    .filter((entry) => entry.id !== props.currentEntryId)
    .filter((entry) => {
      if (!keyword) return true
      return [entry.title, entry.subject, entry.source, entry.tags.join(' ')]
        .join(' ')
        .toLocaleLowerCase()
        .includes(keyword)
    })
    .slice(0, 80)
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    query.value = ''
    nextTick(() => searchInput.value?.focus())
  },
)
</script>

<template>
  <Teleport to="#app">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]"
        @mousedown.self="emit('cancel')"
        @keydown.esc="emit('cancel')"
      >
        <section
          v-dialog-surface="'题目链接'"
          role="dialog"
          aria-modal="true"
          aria-label="关联题目"
          class="flex max-h-[72vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#383835] dark:bg-[#1a1a18]"
        >
          <header class="border-b border-gray-100 px-5 py-4 dark:border-[#2e2e2c]">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-gray-800 dark:text-brand-light-gray">
                  {{ linkedTargetId ? '管理题目链接' : '链接到题目' }}
                </h2>
                <p class="mt-0.5 text-xs text-gray-400">仅显示当前笔记本中的其他题目</p>
              </div>
              <button
                data-ui-variant="text"
                data-dialog-cancel
                type="button"
                class="ui-control rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
                aria-label="关闭"
                @click="emit('cancel')"
              >
                ×
              </button>
            </div>

            <div
              v-if="linkedTargetId"
              class="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2"
              :class="
                linkedEntry
                  ? 'border-accent/20 bg-accent/5'
                  : 'border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/10'
              "
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-700 dark:text-brand-light-gray">
                  {{ linkedEntry?.title || '关联题目已删除' }}
                </div>
                <div class="truncate text-[11px] text-gray-400">
                  {{
                    linkedEntry
                      ? [linkedEntry.subject, linkedEntry.source].filter(Boolean).join(' · ')
                      : linkedTargetId
                  }}
                </div>
              </div>
              <button
                data-ui-variant="primary"
                v-if="linkedEntry"
                type="button"
                class="ui-control rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-105"
                @click="emit('open', linkedEntry.id)"
              >
                打开题目
              </button>
              <button
                data-ui-variant="default"
                data-dialog-cancel
                type="button"
                class="ui-control rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                @click="emit('remove')"
              >
                取消链接
              </button>
            </div>

            <input
              ref="searchInput"
              v-model="query"
              type="search"
              class="ui-field mt-3 h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-accent/60 focus:bg-white dark:border-[#383835] dark:bg-[#141413] dark:text-brand-light-gray"
              placeholder="搜索题目名称、科目、来源或标签"
            />
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <button
              data-ui-variant="primary"
              v-for="entry in filteredEntries"
              :key="entry.id"
              type="button"
              class="ui-control flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent/5"
              @click="emit('choose', entry)"
            >
              <span class="h-2 w-2 shrink-0 rounded-full bg-accent/70" />
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate text-sm font-medium text-gray-700 dark:text-brand-light-gray"
                >
                  {{ entry.title || '未命名题目' }}
                </span>
                <span class="block truncate text-[11px] text-gray-400">
                  {{
                    [entry.subject, entry.source, entry.tags.join('、')]
                      .filter(Boolean)
                      .join(' · ') || '暂无分类信息'
                  }}
                </span>
              </span>
              <span v-if="entry.id === linkedTargetId" class="text-[11px] font-medium text-accent">
                当前链接
              </span>
            </button>
            <div
              v-if="filteredEntries.length === 0"
              class="px-4 py-10 text-center text-sm text-gray-400"
            >
              没有找到可关联的题目
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
