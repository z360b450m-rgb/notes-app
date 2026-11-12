<script setup lang="ts" generic="T extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'

const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
function select(value: unknown) {
  const option = props.options.find((option) => option.value === value)
  if (option) emit('update:modelValue', option.value)
}
</script>

<template>
  <RadioGroupRoot
    class="ui-segmented"
    :aria-label="label"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="select"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      as="button"
      type="button"
      class="ui-segmented-item"
      :value="option.value"
      >{{ option.label }}</RadioGroupItem
    >
  </RadioGroupRoot>
</template>
