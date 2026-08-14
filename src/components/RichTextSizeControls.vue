<script setup lang="ts">
defineProps<{
  imageSelected: boolean
}>()

const emit = defineEmits<{
  'preserve-selection': []
  'font-size': [size: string]
  'image-width': [width: string]
}>()

function onFontSizeChange(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) emit('font-size', select.value)
  select.value = ''
}

function onImageWidthChange(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) emit('image-width', select.value)
  select.value = ''
}
</script>

<template>
  <div class="flex items-center gap-1" @mousedown="emit('preserve-selection')">
    <select
      aria-label="调整字体大小"
      title="调整字体大小；未选中文字时应用到整个区域"
      class="h-6 w-[58px] rounded-md border border-gray-200 bg-white px-1 text-[10px] text-gray-500 outline-none hover:border-accent/50 dark:border-[#3a3a37] dark:bg-[#1a1a18] dark:text-brand-mid"
      @change="onFontSizeChange"
    >
      <option value="" selected disabled>字号</option>
      <option value="13">13 px</option>
      <option value="16">16 px</option>
      <option value="18">18 px</option>
      <option value="24">24 px</option>
      <option value="32">32 px</option>
    </select>

    <select
      aria-label="调整图片大小"
      :disabled="!imageSelected"
      :title="imageSelected ? '调整当前图片大小' : '请先点击内容中的图片'"
      class="h-6 w-[58px] rounded-md border border-gray-200 bg-white px-1 text-[10px] text-gray-500 outline-none hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#3a3a37] dark:bg-[#1a1a18] dark:text-brand-mid"
      @change="onImageWidthChange"
    >
      <option value="" selected disabled>图片</option>
      <option value="auto">原始</option>
      <option value="25">25%</option>
      <option value="50">50%</option>
      <option value="75">75%</option>
      <option value="100">100%</option>
    </select>
  </div>
</template>
