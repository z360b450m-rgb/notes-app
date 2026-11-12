<script setup lang="ts">
defineProps<{ kind: 'subject' | 'tag' | 'source' | 'mastery' }>()
</script>
<template>
  <svg
    class="sidebar-anchor-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="kind === 'subject'">
      <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" />
      <path d="M12 5v15" />
    </template>
    <template v-else-if="kind === 'tag'">
      <path d="M3 3h8l10 10-8 8L3 11Z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </template>
    <path v-else-if="kind === 'source'" d="M3 7V5h7l2 3h9v12H3V7Z" />
    <template v-else><path d="M4 20V10m8 10V4m8 16v-7" /></template>
  </svg>
</template>
