<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { rememberedHighlightColor as rememberedColor } from '../composables/useRichTextSizing'
import MetadataSelect from './MetadataSelect.vue'

const props = defineProps<{
  imageSelected: boolean
  imageWidth: string
  textSelected: boolean
  bold: boolean
  boldMixed: boolean
  highlightColor: string
}>()

const tray = ref<HTMLElement | null>(null)
const paletteOpen = ref(false)
const colors = [
  { value: '#fff59d', label: '黄色' },
  { value: '#bbf7d0', label: '绿色' },
  { value: '#bfdbfe', label: '蓝色' },
  { value: '#fbcfe8', label: '粉色' },
]
const highlightActive = computed(
  () => props.highlightColor !== 'transparent' && props.highlightColor !== 'mixed',
)
const scopeLabel = computed(() => (props.textSelected ? '所选文字' : '后续输入'))

function chooseColor(color: string) {
  if (color !== 'transparent') rememberedColor.value = color
  emit('highlight', color)
  paletteOpen.value = false
}

function toggleHighlight() {
  chooseColor(highlightActive.value ? 'transparent' : rememberedColor.value)
}

function closePalette(event: PointerEvent) {
  if (event.target instanceof Node && !tray.value?.contains(event.target)) paletteOpen.value = false
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !paletteOpen.value) return
  if (document.activeElement && tray.value?.contains(document.activeElement)) {
    tray.value.querySelector<HTMLButtonElement>('[aria-label="选择荧光颜色"]')?.focus()
  }
  paletteOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', closePalette)
  document.addEventListener('keydown', handleEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closePalette)
  document.removeEventListener('keydown', handleEscape)
})

const emit = defineEmits<{
  'preserve-selection': []
  'image-width': [width: string]
  'toggle-bold': []
  highlight: [color: string]
  link: []
}>()

function onImageWidthChange(value: string) {
  if (value) emit('image-width', value)
}
</script>

<template>
  <div
    ref="tray"
    class="button-tray formatting-controls flex flex-wrap items-center gap-1"
    @mousedown="emit('preserve-selection')"
  >
    <button
      type="button"
      aria-label="切换加粗"
      :aria-pressed="boldMixed ? 'mixed' : bold"
      :title="
        boldMixed
          ? '所选文字包含多种加粗状态；点击统一加粗（Ctrl+B）'
          : `切换${scopeLabel}的加粗状态（Ctrl+B）`
      "
      class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-600 transition-colors hover:border-accent/50 hover:text-accent dark:border-[#3a3a37] dark:bg-[#1a1a18] dark:text-brand-mid dark:hover:text-brand-light"
      :class="{
        'bg-accent/10 text-accent': bold && !boldMixed,
      }"
      @mousedown.prevent
      @click="emit('toggle-bold')"
    >
      B
      <span
        v-if="boldMixed"
        aria-hidden="true"
        class="absolute bottom-1 h-0.5 w-2 rounded bg-current"
      ></span>
    </button>

    <div
      class="highlight-split relative flex shrink-0 items-center"
      :data-active="highlightActive || paletteOpen"
    >
      <button
        type="button"
        aria-label="切换荧光笔"
        :aria-pressed="highlightColor === 'mixed' ? 'mixed' : highlightActive"
        :title="
          highlightColor === 'mixed'
            ? '所选文字包含多种荧光格式；点击统一颜色'
            : `${highlightActive ? '清除' : '设置'}${scopeLabel}的荧光`
        "
        class="highlight-main flex h-8 items-center gap-1.5 rounded-l-lg border border-gray-200 bg-white px-2 text-xs text-gray-600 dark:border-[#3a3a37] dark:bg-[#1a1a18] dark:text-brand-mid"
        :class="{
          'bg-accent/10 text-accent': highlightActive,
        }"
        @mousedown.prevent
        @click="toggleHighlight"
      >
        <span class="flex flex-col gap-0.5"
          ><span>荧光笔</span
          ><span class="h-1 rounded" :style="{ backgroundColor: rememberedColor }"></span
        ></span>
        <span v-if="highlightColor === 'mixed'" class="text-[11px]">混合</span>
      </button>
      <button
        type="button"
        aria-label="选择荧光颜色"
        title="选择荧光颜色"
        :aria-expanded="paletteOpen"
        class="highlight-arrow flex h-8 w-8 items-center justify-center rounded-r-lg"
        @mousedown.prevent
        @click="paletteOpen = !paletteOpen"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          :class="{ 'rotate-180': paletteOpen }"
          class="transition-transform"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        v-if="paletteOpen"
        role="group"
        aria-label="荧光颜色"
        data-ui-menu
        class="soft-menu absolute left-0 top-full z-50 mt-2 w-40"
      >
        <button
          v-for="color in colors"
          :key="color.value"
          type="button"
          :aria-pressed="highlightColor === color.value"
          :class="{ 'bg-accent/10 text-accent': highlightColor === color.value }"
          class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-brand-light dark:hover:bg-white/10"
          @mousedown.prevent
          @click="chooseColor(color.value)"
        >
          <span
            class="h-3 w-3 rounded border border-black/10"
            :style="{ backgroundColor: color.value }"
          ></span
          >{{ color.label }}
        </button>
        <button
          type="button"
          class="mt-1 w-full border-t border-gray-200 px-2 py-2 text-left text-xs text-gray-600 dark:border-[#3a3a37] dark:text-brand-mid"
          @mousedown.prevent
          @click="chooseColor('transparent')"
        >
          无颜色
        </button>
      </div>
    </div>

    <button
      type="button"
      aria-label="链接到其他题目"
      title="将所选文字链接到其他题目；未选择文字时插入题目名称"
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 outline-none transition-colors hover:border-accent/50 hover:text-accent dark:border-[#3a3a37] dark:bg-[#1a1a18] dark:text-brand-mid dark:hover:text-brand-light"
      @mousedown.prevent
      @click="emit('link')"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>

    <div v-if="imageSelected" class="image-size-controls w-[70px] shrink-0">
      <MetadataSelect
        label="调整图片大小"
        :disabled="!imageSelected"
        :model-value="imageWidth"
        :clearable="false"
        :options="[
          { value: 'auto', label: '原始' },
          { value: '25', label: '25%' },
          { value: '50', label: '50%' },
          { value: '75', label: '75%' },
          { value: '100', label: '100%' },
        ]"
        :title="imageSelected ? '调整当前图片大小' : '请先点击内容中的图片'"
        @update:model-value="onImageWidthChange"
      />
    </div>
  </div>
</template>

<style scoped>
.highlight-split {
  gap: 0 !important;
  border: 0;
  border-radius: 8px;
}
.formatting-controls > button,
.formatting-controls > select,
.highlight-main,
.highlight-arrow {
  border: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  color: var(--neo-muted, #78776e) !important;
}
.formatting-controls > button:hover,
.highlight-main:hover,
.highlight-arrow:hover,
.highlight-arrow[aria-expanded='true'],
.formatting-controls > button[aria-pressed='true'],
.formatting-controls > button[aria-pressed='mixed'],
.highlight-main[aria-pressed='true'],
.highlight-main[aria-pressed='mixed'] {
  background: var(--neo-selected, #f9e8df) !important;
  color: var(--neo-accent, #d97757) !important;
}
.highlight-main {
  border: 0 !important;
  border-radius: 8px 0 0 8px !important;
}
.highlight-arrow {
  padding: 0 !important;
  min-width: 32px;
  border: 0 !important;
  border-radius: 0 8px 8px 0 !important;
}
.highlight-arrow::before {
  content: '';
  position: absolute;
  height: 14px;
  border-left: 1px solid var(--neo-line, #d1d5db);
  transform: translateX(-16px);
}
</style>
