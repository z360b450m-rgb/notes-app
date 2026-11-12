<script setup lang="ts">
import { ref, computed, watch, nextTick, useId } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { vMenuMotion } from '@/utils/menuMotion'

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
const filterInputRef = ref<HTMLInputElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const portalTarget = ref<HTMLElement | string>('#app')
const listId = useId()
const activeOption = ref(-1)
function changeOpen(value: boolean) {
  if (value)
    portalTarget.value =
      triggerRef.value?.closest('dialog[open], [role="dialog"][aria-modal="true"]') ?? '#app'
  dropdownOpen.value = value
}

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

function closeDropdown() {
  dropdownOpen.value = false
  filterText.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  const length = filteredTags.value.length + (isNew.value ? 1 : 0)
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && length) {
    e.preventDefault()
    activeOption.value =
      activeOption.value < 0
        ? e.key === 'ArrowDown'
          ? 0
          : length - 1
        : (activeOption.value + (e.key === 'ArrowDown' ? 1 : -1) + length) % length
    void nextTick(() =>
      document
        .getElementById(`${listId}-${activeOption.value}`)
        ?.scrollIntoView({ block: 'nearest' }),
    )
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeOption.value >= 0 && activeOption.value < filteredTags.value.length)
      toggleTag(filteredTags.value[activeOption.value])
    else if (isNew.value) createTag()
    else if (filteredTags.value[0]) toggleTag(filteredTags.value[0])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeDropdown()
  }
}

watch(dropdownOpen, () => {
  filterText.value = ''
  activeOption.value = -1
})
watch(filterText, () => {
  activeOption.value = -1
})
</script>

<template>
  <PopoverRoot :open="dropdownOpen" @update:open="changeOpen">
    <div class="tag-select relative inline-flex">
      <!-- Select‑like trigger button -->
      <PopoverTrigger as-child>
        <button
          ref="triggerRef"
          type="button"
          aria-label="选择标签"
          :title="modelValue.length ? modelValue.join('、') : '选择标签'"
          class="metadata-select-trigger flex items-center justify-between gap-1 border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] rounded-lg px-2.5 py-1.5 text-xs outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all cursor-pointer whitespace-nowrap"
          :class="dropdownOpen ? 'border-accent ring-2 ring-accent/20' : ''"
        >
          <span v-if="modelValue.length === 0" class="text-gray-400 dark:text-gray-500"
            >标签...</span
          >
          <span v-else-if="modelValue.length === 1" class="text-gray-800 dark:text-brand-light">{{
            modelValue[0]
          }}</span>
          <span v-else class="text-gray-800 dark:text-brand-light"
            >标签 ({{ modelValue.length }})</span
          >
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
      </PopoverTrigger>

      <!-- Dropdown panel -->
      <PopoverPortal :to="portalTarget">
        <PopoverContent
          class="soft-menu tag-select-menu w-56 flex flex-col"
          align="start"
          :side-offset="8"
          :collision-padding="12"
          aria-label="选择标签"
          @open-auto-focus.prevent="filterInputRef?.focus()"
        >
          <!-- Selected tags (chips at top) -->
          <div
            v-if="modelValue.length > 0"
            class="flex flex-wrap gap-1 p-1.5 border-b border-gray-100 dark:border-[#2e2e2c]"
          >
            <span
              v-for="tag in modelValue"
              :key="tag"
              class="tag-select-chip inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent dark:bg-accent/20 dark:text-brand-light"
            >
              {{ tag }}
              <button
                type="button"
                class="tag-select-chip-remove ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                :aria-label="`移除标签：${tag}`"
                @click.stop="removeTag(tag)"
              >
                <svg
                  class="tag-select-chip-close"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </span>
          </div>

          <!-- Search input -->
          <div class="p-1.5 border-b border-gray-100 dark:border-[#2e2e2c]">
            <input
              ref="filterInputRef"
              v-model="filterText"
              type="text"
              role="combobox"
              aria-label="搜索或新建标签"
              aria-expanded="true"
              aria-autocomplete="list"
              :aria-controls="listId"
              :aria-activedescendant="activeOption >= 0 ? `${listId}-${activeOption}` : undefined"
              class="w-full text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#141413] outline-none text-gray-800 dark:text-brand-light focus:border-accent"
              :placeholder="placeholder"
              @keydown="onKeydown"
            />
          </div>

          <!-- Tag list -->
          <div
            :id="listId"
            role="listbox"
            aria-label="可选标签"
            aria-multiselectable="true"
            class="max-h-36 overflow-y-auto p-1"
          >
            <div
              v-if="filteredTags.length === 0 && !isNew"
              class="text-[11px] text-gray-400 dark:text-gray-500 text-center py-3"
            >
              暂无标签
            </div>
            <button
              v-for="(tag, index) in filteredTags"
              :key="tag"
              :id="`${listId}-${index}`"
              type="button"
              role="option"
              tabindex="-1"
              v-menu-motion
              class="soft-menu-item w-full flex items-center gap-2 text-left"
              :aria-selected="isSelected(tag)"
              :data-highlighted="activeOption === index ? '' : undefined"
              @mouseenter="activeOption = index"
              @mousedown.prevent
              @click="toggleTag(tag)"
            >
              <span
                class="w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                :class="
                  isSelected(tag)
                    ? 'bg-accent border-accent'
                    : 'border-gray-300 dark:border-[#3a3a38]'
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
              :id="`${listId}-${filteredTags.length}`"
              type="button"
              role="option"
              tabindex="-1"
              :aria-selected="false"
              :data-highlighted="activeOption === filteredTags.length ? '' : undefined"
              @mouseenter="activeOption = filteredTags.length"
              @mousedown.prevent
              v-menu-motion
              class="soft-menu-item w-full flex items-center gap-2 text-left text-accent"
              @click="createTag"
            >
              <span
                class="w-3.5 h-3.5 rounded border border-dashed border-accent/50 flex-shrink-0 flex items-center justify-center text-accent text-[10px]"
                >+</span
              >
              <span>创建 &ldquo;{{ filterText.trim() }}&rdquo;</span>
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </div>
  </PopoverRoot>
</template>
