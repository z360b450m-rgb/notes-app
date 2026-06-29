<script setup lang="ts">
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
  'add-subject': [name: string]
}>()

const addingSubject = ref(false)
const newSubjectName = ref('')
const newSubjectInput = ref<HTMLInputElement | null>(null)

function startAddSubject() {
  addingSubject.value = true
  newSubjectName.value = ''
  nextTick(() => newSubjectInput.value?.focus())
}

function confirmAddSubject() {
  const name = newSubjectName.value.trim()
  if (name) emit('add-subject', name)
  addingSubject.value = false
}

function cancelAddSubject() {
  addingSubject.value = false
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="sidebar-section mb-3.5">
    <div class="flex items-center justify-between mb-1.5">
      <h3
        class="text-[12px] uppercase tracking-[0.7px] text-gray-500 dark:text-brand-mid font-semibold"
      >
        学科
      </h3>
      <button
        class="w-5 h-5 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-accent dark:hover:text-accent hover:bg-accent/10 transition-colors"
        title="新建学科"
        @click="startAddSubject()"
      >
        <svg
          width="12"
          height="12"
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

    <!-- Inline input for new subject -->
    <div v-if="addingSubject" class="flex items-center gap-1 mb-1.5">
      <input
        ref="newSubjectInput"
        v-model="newSubjectName"
        type="text"
        class="flex-1 text-[12px] px-2 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        placeholder="新学科名称"
        @keydown.enter="confirmAddSubject()"
        @keydown.escape="cancelAddSubject()"
      />
      <button
        class="text-[11px] px-1.5 py-1 rounded bg-accent text-white hover:bg-accent/90 transition-colors flex-shrink-0"
        @click="confirmAddSubject()"
      >
        确定
      </button>
      <button
        class="text-[11px] px-1.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
        @click="cancelAddSubject()"
      >
        取消
      </button>
    </div>

    <div class="flex flex-wrap gap-1">
      <button
        class="subject-chip text-[13px] px-2.5 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray cursor-pointer transition-all duration-200 ease-out active:scale-95 hover:border-accent hover:text-accent whitespace-nowrap"
        :class="{ '!bg-accent !text-white !border-accent': activeSubject === '__all__' }"
        @click="emit('filter', '__all__')"
      >
        全部 ({{ allCount }})
      </button>
      <button
        class="subject-chip text-[13px] px-2.5 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray cursor-pointer transition-all duration-200 ease-out active:scale-95 hover:border-accent hover:text-accent whitespace-nowrap"
        :class="{ '!bg-accent !text-white !border-accent': activeSubject === '__none__' }"
        @click="emit('filter', '__none__')"
      >
        未分类 ({{ noneCount }})
      </button>
      <span
        v-for="subject in allSubjects"
        :key="subject"
        class="inline-flex items-center"
        :class="{ active: activeSubject === subject }"
      >
        <button
          class="subject-chip text-[13px] px-2.5 py-1 rounded-l-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray cursor-pointer transition-all duration-200 ease-out active:scale-95 hover:border-accent hover:text-accent whitespace-nowrap border-r-0"
          :class="{
            '!bg-accent !text-white !border-accent !border-r !border-r-white/30':
              activeSubject === subject,
          }"
          @click="emit('filter', subject)"
        >
          {{ subject }} ({{ subjectMap[subject] || 0 }})
        </button>
        <button
          class="subject-add-btn text-sm font-bold px-[7px] py-1 rounded-r-md border border-gray-200 dark:border-[#2e2e2c] border-l-0 bg-white dark:bg-[#141413] text-gray-500 dark:text-brand-light-gray cursor-pointer transition-all duration-200 ease-out active:scale-95 hover:bg-accent hover:text-white hover:border-accent leading-tight"
          :class="{
            '!bg-accent !text-white !border-accent !border-l !border-l-white/30 hover:brightness-110':
              activeSubject === subject,
          }"
          title="在此学科下新建错题"
          @click.stop="emit('quickCreate', subject)"
        >
          +
        </button>
      </span>
    </div>
  </div>
</template>
