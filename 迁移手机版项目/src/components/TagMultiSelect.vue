<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    allTags: string[]
    modelValue: string[]
    placeholder?: string
  }>(),
  {
    placeholder: '搜索或新建标签...',
  },
)

const emit = defineEmits<{
  'update:modelValue': [tags: string[]]
  'add-tag': [name: string]
}>()

const dropdownOpen = ref(false)
const filterText = ref('')
const panelRef = ref<HTMLDivElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)

const filteredTags = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return props.allTags
  return props.allTags.filter((t) => t.toLowerCase().includes(q))
})

const isNew = computed(() => {
  const q = filterText.value.trim()
  return q && !props.allTags.includes(q)
})

function isSelected(tag: string): boolean {
  return props.modelValue.includes(tag)
}

function toggleTag(tag: string) {
  if (isSelected(tag)) {
    emit(
      'update:modelValue',
      props.modelValue.filter((t) => t !== tag),
    )
  } else {
    emit('update:modelValue', [...props.modelValue, tag])
  }
}

function removeTag(tag: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((t) => t !== tag),
  )
}

function createTag() {
  const name = filterText.value.trim()
  if (!name) return
  emit('add-tag', name)
  if (!isSelected(name)) {
    emit('update:modelValue', [...props.modelValue, name])
  }
  filterText.value = ''
  filterInputRef.value?.focus()
}

function openDropdown() {
  dropdownOpen.value = true
  filterText.value = ''
}

function closeDropdown() {
  dropdownOpen.value = false
  filterText.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (isNew.value) {
      createTag()
    }
  } else if (e.key === 'Escape') {
    closeDropdown()
  }
}

// Click outside
function onDocClick(e: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    closeDropdown()
  }
}

watch(dropdownOpen, (open) => {
  if (open) {
    setTimeout(() => filterInputRef.value?.focus(), 50)
  }
})

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="panelRef" class="relative inline-flex">
    <!-- Select‑like trigger button -->
    <button
      class="flex items-center justify-between gap-1 border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] rounded-lg px-2.5 py-1.5 text-xs outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all cursor-pointer whitespace-nowrap"
      :class="dropdownOpen ? 'border-accent ring-2 ring-accent/20' : ''"
      @click.stop="dropdownOpen ? closeDropdown() : openDropdown()"
    >
      <span v-if="modelValue.length === 0" class="text-gray-400 dark:text-gray-500">标签...</span>
      <span v-else-if="modelValue.length === 1" class="text-gray-800 dark:text-brand-light">{{
        modelValue[0]
      }}</span>
      <span v-else class="text-gray-800 dark:text-brand-light">标签 ({{ modelValue.length }})</span>
      <svg
        class="w-3 h-3 text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform"
        :class="{ 'rotate-180': dropdownOpen }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Dropdown panel -->
    <div
      v-if="dropdownOpen"
      class="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-[#1e1e1c] border border-gray-200 dark:border-[#2e2e2c] rounded-lg shadow-lg z-50 flex flex-col"
    >
      <!-- Selected tags (chips at top) -->
      <div
        v-if="modelValue.length > 0"
        class="flex flex-wrap gap-1 p-1.5 border-b border-gray-100 dark:border-[#2e2e2c]"
      >
        <span
          v-for="tag in modelValue"
          :key="tag"
          class="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent dark:bg-accent/20 dark:text-brand-light"
        >
          {{ tag }}
          <button
            class="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-red-200 dark:hover:bg-red-800 hover:text-red-600 dark:hover:text-red-300 transition-colors text-[10px] leading-none"
            @click.stop="removeTag(tag)"
          >
            &times;
          </button>
        </span>
      </div>

      <!-- Search input -->
      <div class="p-1.5 border-b border-gray-100 dark:border-[#2e2e2c]">
        <input
          ref="filterInputRef"
          v-model="filterText"
          type="text"
          class="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent"
          :placeholder="placeholder"
          @keydown="onKeydown"
        />
      </div>

      <!-- Tag list -->
      <div class="max-h-36 overflow-y-auto p-1">
        <div
          v-if="filteredTags.length === 0 && !isNew"
          class="text-[11px] text-gray-400 dark:text-gray-500 text-center py-3"
        >
          暂无标签
        </div>
        <button
          v-for="tag in filteredTags"
          :key="tag"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-colors text-left"
          @click="toggleTag(tag)"
        >
          <span
            class="w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
            :class="
              isSelected(tag) ? 'bg-accent border-accent' : 'border-gray-300 dark:border-[#3a3a38]'
            "
          >
            <svg
              v-if="isSelected(tag)"
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              stroke-width="3"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span class="text-gray-700 dark:text-brand-light">{{ tag }}</span>
        </button>

        <!-- Create new tag -->
        <button
          v-if="isNew"
          class="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded hover:bg-accent/5 transition-colors text-left text-accent"
          @click="createTag"
        >
          <span
            class="w-3.5 h-3.5 rounded border border-dashed border-accent/50 flex-shrink-0 flex items-center justify-center text-accent text-[10px]"
            >+</span
          >
          <span>创建 &ldquo;{{ filterText.trim() }}&rdquo;</span>
        </button>
      </div>
    </div>
  </div>
</template>
