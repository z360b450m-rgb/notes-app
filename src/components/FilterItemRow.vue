<script setup lang="ts">
import { computed } from 'vue'
import ActionMenu from './ActionMenu.vue'
import type { ActionMenuAction } from '@/types/ui'

const props = defineProps<{
  label: string
  count: number
  selected: boolean
  manageable?: boolean
  quickCreate?: boolean
}>()
const emit = defineEmits<{ select: []; edit: []; delete: []; quickCreate: [] }>()
const actions = computed<ActionMenuAction[]>(() => [
  ...(props.quickCreate ? [{ id: 'quickCreate', label: '新建错题', icon: 'add' as const }] : []),
  { id: 'edit', label: '重命名', icon: 'edit' },
  { id: 'delete', label: '删除', icon: 'delete', danger: true, separatorBefore: true },
])
function action(id: string) {
  if (id === 'edit') emit('edit')
  else if (id === 'delete') emit('delete')
  else if (id === 'quickCreate') emit('quickCreate')
}
</script>

<template>
  <div class="filter-item-row" :class="{ 'is-selected': selected }">
    <div class="filter-item-main">
      <button
        type="button"
        class="filter-item-select"
        :aria-pressed="selected"
        @click="emit('select')"
      >
        <span class="truncate" :title="label">{{ label }}</span>
        <span class="filter-item-count tabular-nums">{{ count }}</span>
      </button>
      <ActionMenu
        v-if="manageable"
        :label="`${label}的操作`"
        :actions="actions"
        trigger-class="filter-item-more"
        @select="action"
      />
    </div>
  </div>
</template>
