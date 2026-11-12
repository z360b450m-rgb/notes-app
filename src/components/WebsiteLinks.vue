<script setup lang="ts">
// Open documentation separately so the current editing session stays in place.
const visible = !window.electronAPI && window.location.protocol !== 'file:'
</script>

<template>
  <nav
    v-if="visible"
    aria-label="官网与文档"
    class="flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-brand-mid"
  >
    <a href="/" target="_blank" rel="noopener" class="hover:text-accent">官网首页 ↗</a>
    <a href="/docs/" target="_blank" rel="noopener" class="hover:text-accent">使用文档 ↗</a>
  </nav>
</template>
