<script setup lang="ts">
import SidebarAnchorIcon from './SidebarAnchorIcon.vue'
import FilterItemRow from './FilterItemRow.vue'
import { useInlineReveal } from '@/composables/useInlineReveal'
const { enterReveal, leaveReveal, clearReveal } = useInlineReveal()

// @AI-NOTE: 学科筛选组件 —— 筛选状态由 useFilter Hook 管理。
// 禁止在此实现筛选逻辑或直接操作存储。
import { ref, nextTick } from 'vue'

defineProps<{
  activeSubject: string
  subjectMap: Record<string, number>
  allSubjects: string[]
  allCount: number
  noneCount: number
}>()

const emit = defineEmits<{
  filter: [subject: string]
  quickCreate: [subject: string]
  'add-subject': [name: string, global?: boolean]
  'rename-subject': [oldName: string, newName: string]
  'delete-subject': [name: string]
}>()

const sectionOpen = ref(false)
const addingSubject = ref(false)
const newSubjectName = ref('')
const newSubjectGlobal = ref(false)
const newSubjectInput = ref<HTMLInputElement | null>(null)

function startAddSubject() {
  sectionOpen.value = true
  addingSubject.value = true
  newSubjectName.value = ''
  newSubjectGlobal.value = false
  nextTick(() => newSubjectInput.value?.focus({ preventScroll: true }))
}

function confirmAddSubject() {
  const name = newSubjectName.value.trim()
  if (name) emit('add-subject', name, newSubjectGlobal.value)
  addingSubject.value = false
}

function cancelAddSubject() {
  addingSubject.value = false
}

// Edit state
const editingName = ref<string | null>(null)
const editValue = ref('')
const editInput = ref<HTMLInputElement | null>(null)
function setEditInput(el: unknown) {
  editInput.value = el instanceof HTMLInputElement ? el : null
}

function startEdit(name: string) {
  editingName.value = name
  editValue.value = name
  nextTick(() => editInput.value?.focus())
}

function confirmEdit() {
  const trimmed = editValue.value.trim()
  if (trimmed && editingName.value && trimmed !== editingName.value) {
    emit('rename-subject', editingName.value, trimmed)
  }
  editingName.value = null
}

function cancelEdit() {
  editingName.value = null
}

// Delete state
const deletingName = ref<string | null>(null)

function startDelete(name: string) {
  deletingName.value = name
}

function confirmDelete() {
  if (deletingName.value) {
    emit('delete-subject', deletingName.value)
  }
  deletingName.value = null
}

function cancelDelete() {
  deletingName.value = null
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="sidebar-section mb-3.5">
    <div class="filter-section-header flex items-center justify-between mb-1.5">
      <button
        class="min-h-10 px-3 py-2 rounded-xl flex items-center gap-2 text-base font-semibold uppercase tracking-[0.5px] text-gray-500 dark:text-brand-mid hover:text-gray-700 dark:hover:text-brand-light-gray transition-colors"
        :aria-expanded="sectionOpen"
        @click="sectionOpen = !sectionOpen"
      >
        <SidebarAnchorIcon kind="subject" />
        学科
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          class="transition-transform duration-200"
          :class="sectionOpen ? 'rotate-180' : ''"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button
        class="w-6 h-6 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-accent dark:hover:text-accent hover:bg-accent/10 transition-colors"
        title="新建学科"
        @click="startAddSubject()"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <div class="section-collapse" :class="{ active: sectionOpen }">
      <div class="section-collapse-inner">
        <!-- Inline input for new subject -->
        <Transition :css="false" @enter="enterReveal" @leave="leaveReveal" @enter-cancelled="clearReveal" @leave-cancelled="clearReveal"><div v-if="addingSubject" class="mb-1.5 space-y-1.5">
          <input
            ref="newSubjectInput"
            v-model="newSubjectName"
            type="text"
            class="w-full text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
            placeholder="新学科名称"
            @keydown.enter="confirmAddSubject()"
            @keydown.escape="cancelAddSubject()"
          />
          <div class="flex items-center justify-end gap-1">
            <button
              class="text-xs px-2 py-1.5 rounded-l-md border border-accent bg-accent text-white hover:brightness-110 transition-colors flex-shrink-0"
              @click="confirmAddSubject()"
            >
              确定
            </button>
            <button
              class="text-xs px-2 py-1.5 rounded-r-md border border-l-0 border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
              @click="cancelAddSubject()"
            >
              取消
            </button>
          </div>
          <label
            class="flex items-center gap-1 text-xs text-gray-500 dark:text-brand-mid cursor-pointer select-none"
          >
            <input
              v-model="newSubjectGlobal"
              type="checkbox"
              class="w-3.5 h-3.5 rounded accent-accent"
            />
            应用于所有错题本
          </label>
        </div></Transition>
        <div class="filter-item-list">
          <FilterItemRow label="全部" :count="allCount" :selected="activeSubject === '__all__'" @select="emit('filter', '__all__')" />
          <FilterItemRow label="未分类" :count="noneCount" :selected="activeSubject === '__none__'" @select="emit('filter', '__none__')" />

          <template v-for="subject in allSubjects" :key="subject">
            <!-- Inline edit mode -->
            <span v-if="editingName === subject" class="inline-flex items-center gap-1">
              <input
                :ref="setEditInput"
                v-model="editValue"
                type="text"
                class="text-sm px-3 py-1.5 rounded-md border border-accent bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light w-28 focus:ring-2 focus:ring-accent/20 transition-all"
                @keydown.enter="confirmEdit()"
                @keydown.escape="cancelEdit()"
              />
              <button
                class="text-xs px-1.5 py-1.5 rounded bg-accent text-white hover:bg-accent/90 transition-colors flex-shrink-0"
                @click="confirmEdit()"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                class="text-xs px-1.5 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                @click="cancelEdit()"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>

            <!-- Delete confirmation -->
            <span v-else-if="deletingName === subject" class="inline-flex items-center gap-1">
              <span class="text-xs text-red-500 dark:text-red-400 px-1"
                >删除 "{{ subject }}" ({{ subjectMap[subject] || 0 }} 条)?</span
              >
              <button
                class="text-xs px-1.5 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors flex-shrink-0"
                @click="confirmDelete()"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                class="text-xs px-1.5 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                @click="cancelDelete()"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>

            <FilterItemRow v-else :label="subject" :count="subjectMap[subject] || 0" :selected="activeSubject === subject" manageable quick-create @quick-create="emit('quickCreate', subject)" @select="emit('filter', subject)" @edit="startEdit(subject)" @delete="startDelete(subject)" />
</template>
        </div>
      </div>
    </div>
  </div>
</template>
