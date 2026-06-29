<script setup lang="ts">
// @AI-NOTE: 标签筛选组件 —— 筛选状态由 useFilter Hook 管理。
// 禁止在此实现筛选逻辑或直接操作存储。
import { ref, nextTick } from 'vue'

defineProps<{
  activeTag: string | null
  tagMap: Record<string, number>
  allTags: string[]
}>()

const emit = defineEmits<{
  filter: [tag: string]
  'add-tag': [name: string]
}>()

const addingTag = ref(false)
const newTagName = ref('')
const newTagInput = ref<HTMLInputElement | null>(null)

function startAddTag() {
  addingTag.value = true
  newTagName.value = ''
  nextTick(() => newTagInput.value?.focus())
}

function confirmAddTag() {
  const name = newTagName.value.trim()
  if (name) emit('add-tag', name)
  addingTag.value = false
}

function cancelAddTag() {
  addingTag.value = false
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div class="sidebar-section mb-3.5">
    <div class="flex items-center justify-between mb-1.5">
      <h3
        class="text-[12px] uppercase tracking-[0.7px] text-gray-500 dark:text-brand-mid font-semibold"
      >
        标签
      </h3>
      <button
        class="w-5 h-5 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-accent dark:hover:text-accent hover:bg-accent/10 transition-colors"
        title="新建标签"
        @click="startAddTag()"
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

    <!-- Inline input for new tag -->
    <div v-if="addingTag" class="flex items-center gap-1 mb-1.5">
      <input
        ref="newTagInput"
        v-model="newTagName"
        type="text"
        class="flex-1 text-[12px] px-2 py-1 rounded-md border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
        placeholder="新标签名称"
        @keydown.enter="confirmAddTag()"
        @keydown.escape="cancelAddTag()"
      />
      <button
        class="text-[11px] px-1.5 py-1 rounded bg-accent text-white hover:bg-accent/90 transition-colors flex-shrink-0"
        @click="confirmAddTag()"
      >
        确定
      </button>
      <button
        class="text-[11px] px-1.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors flex-shrink-0"
        @click="cancelAddTag()"
      >
        取消
      </button>
    </div>

    <div class="flex flex-wrap gap-1">
      <template v-if="allTags.length === 0">
        <span class="text-[12px] text-gray-500 dark:text-brand-mid">暂无标签</span>
      </template>
      <button
        v-for="tag in allTags"
        :key="tag"
        class="tag-dot text-[12px] px-2 py-0.5 rounded-md bg-brand-light-gray dark:bg-[#2a2a28] text-brand-mid dark:text-brand-mid cursor-pointer border-none transition-all duration-200 ease-out active:scale-95 hover:bg-accent-light hover:text-accent"
        :class="{ '!bg-accent !text-white': activeTag === tag }"
        @click="emit('filter', tag)"
      >
        {{ tag }} ({{ tagMap[tag] || 0 }})
      </button>
    </div>
  </div>
</template>
