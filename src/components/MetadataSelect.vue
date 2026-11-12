<script setup lang="ts" generic="T extends string | number | undefined">
import { computed, ref } from 'vue'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import { vMenuMotion } from '@/utils/menuMotion'

const props = defineProps<{
  modelValue: T
  options: (T | { value: T; label: string })[]
  label: string
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  title?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: T]
  blur: []
}>()
const open = ref(false)
const trigger = ref<{ $el: HTMLElement } | null>(null)
const portalTarget = ref<HTMLElement | string>('#app')
function key(value: T) {
  return `value:${typeof value}:${String(value)}`
}
const clearable = computed(() => props.clearable ?? Boolean(props.placeholder))
const items = computed(() => {
  const values = new Map<string, { value: T; label: string; key: string }>()
  for (const option of props.options) {
    const item = typeof option === 'object' ? option : { value: option, label: String(option) }
    values.set(key(item.value), { ...item, key: key(item.value) })
  }
  if (
    !values.has(key(props.modelValue)) &&
    props.modelValue !== '' &&
    props.modelValue !== undefined
  ) {
    values.set(key(props.modelValue), {
      value: props.modelValue,
      label: String(props.modelValue),
      key: key(props.modelValue),
    })
  }
  return [...values.values()]
})
const selectedValue = computed(() =>
  props.modelValue === '' && clearable.value ? 'empty' : key(props.modelValue),
)

function select(value: unknown) {
  if (typeof value !== 'string') return
  if (value === 'empty') emit('update:modelValue', '' as T)
  else {
    const item = items.value.find((item) => item.key === value)
    if (item) emit('update:modelValue', item.value)
  }
}
function onOpenChange(value: boolean) {
  // A modal dialog is in the browser's top layer; app-level portals render behind it.
  if (value)
    portalTarget.value =
      trigger.value?.$el.closest('dialog[open], [role="dialog"][aria-modal="true"]') ?? '#app'
  open.value = value
  if (!value) emit('blur')
}
</script>

<template>
  <SelectRoot
    :model-value="selectedValue"
    :open="open"
    :disabled="disabled"
    @update:model-value="select"
    @update:open="onOpenChange"
  >
    <SelectTrigger
      ref="trigger"
      class="metadata-select-trigger"
      :aria-label="label"
      :title="title"
      @blur="!open && emit('blur')"
    >
      <SelectValue :placeholder="placeholder" />
      <svg
        class="metadata-select-chevron"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </SelectTrigger>
    <SelectPortal :to="portalTarget">
      <SelectContent
        class="soft-menu metadata-select-menu"
        position="popper"
        align="start"
        :side-offset="8"
        :collision-padding="12"
        @escape-key-down.prevent="onOpenChange(false)"
      >
        <SelectViewport>
          <SelectItem
            v-if="clearable"
            v-menu-motion
            class="soft-menu-item metadata-select-empty"
            value="empty"
          >
            <SelectItemText>{{ placeholder || '未设置' }}</SelectItemText>
            <SelectItemIndicator class="metadata-select-check">✓</SelectItemIndicator>
          </SelectItem>
          <SelectItem
            v-for="item in items"
            :key="item.key"
            v-menu-motion
            class="soft-menu-item"
            :value="item.key"
          >
            <SelectItemText>{{ item.label }}</SelectItemText>
            <SelectItemIndicator class="metadata-select-check">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <polyline points="5 12 9 16 19 6" />
              </svg>
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
