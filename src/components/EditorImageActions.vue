<script setup lang="ts">
defineEmits<{ screenshot: []; camera: []; import: [] }>()
</script>

<template>
  <div class="editor-image-actions flex flex-col gap-1">
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
      title="截屏"
      class="flex items-center gap-2 text-left"
      @click="$emit('screenshot')"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 1v4m8-4v4M1 8h4m-4 8h4m14-8h4m-4 8h4M8 19v4m8-4v4" />
      </svg>
      <span>截屏</span>
    </button>
    <button
      type="button"
      title="拍照"
      role="menuitem"
      tabindex="-1"
      class="flex items-center gap-2 text-left"
      @click="$emit('camera')"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"
      >
        <path d="M21 8v11H3V8h4l2-4h6l2 4Z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <span>拍照</span>
    </button>
    <button
      type="button"
      title="导入图片"
      role="menuitem"
      tabindex="-1"
      class="flex items-center gap-2 text-left"
      @click="$emit('import')"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 6-6 4 4 3-3 5 5" />
      </svg>
      <span>导入图片</span>
    </button>
  </div>
</template>
