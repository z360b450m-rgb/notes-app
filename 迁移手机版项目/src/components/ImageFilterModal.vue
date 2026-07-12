<script setup lang="ts">
import { ref, watch } from 'vue'
import { applyDocumentFilter, rotateImage } from '@/utils/imageFilters'

const props = defineProps<{
  imageSrc: string
}>()

const emit = defineEmits<{
  confirm: [filteredBase64: string, threshold: number]
  skip: [originalBase64: string]
  cancel: []
}>()

const threshold = ref(150)
const keepOnlyBlack = ref(true)
const currentSrc = ref(props.imageSrc)
const filteredSrc = ref<string>('')
const processing = ref(false)
const error = ref('')
const rotating = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function updatePreview() {
  error.value = ''
  processing.value = true
  try {
    filteredSrc.value = await applyDocumentFilter(currentSrc.value, {
      threshold: threshold.value,
      keepOnlyBlack: keepOnlyBlack.value,
    })
  } catch {
    error.value = '图像处理失败'
  } finally {
    processing.value = false
  }
}

function schedulePreview() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(updatePreview, 150)
}

watch([threshold, keepOnlyBlack], schedulePreview, { immediate: true })

// 确保 currentSrc 初始值同步
watch(
  () => props.imageSrc,
  (val) => {
    currentSrc.value = val
    schedulePreview()
  },
)

async function rotate(direction: 'left' | 'right') {
  rotating.value = true
  try {
    currentSrc.value = await rotateImage(currentSrc.value, direction === 'right' ? 90 : -90)
    schedulePreview()
  } catch {
    error.value = '旋转失败'
  } finally {
    rotating.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    @click.self="emit('cancel')"
  >
    <div
      class="bg-white dark:bg-[#1e1e1c] rounded-2xl shadow-xl border border-gray-200 dark:border-[#2e2e2c] w-full max-w-2xl mx-4 flex flex-col max-h-[90vh] overflow-hidden"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-[#2e2e2c] flex-shrink-0"
      >
        <h2 class="text-[15px] font-semibold text-gray-800 dark:text-brand-light-gray">文档滤镜</h2>
        <span class="text-[11px] text-gray-400 dark:text-brand-mid"> 白底黑字二值化 </span>
        <!-- Rotate controls -->
        <div class="flex items-center gap-1">
          <button
            class="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors disabled:opacity-30"
            title="逆时针旋转 90°"
            :disabled="processing || rotating"
            @click="rotate('left')"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            class="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors disabled:opacity-30"
            title="顺时针旋转 90°"
            :disabled="processing || rotating"
            @click="rotate('right')"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Preview area: side-by-side -->
      <div class="flex-1 overflow-auto p-5">
        <div class="grid grid-cols-2 gap-4">
          <!-- Original -->
          <div>
            <div class="text-[11px] font-semibold text-gray-400 dark:text-brand-mid mb-1.5">
              原图
            </div>
            <div
              class="rounded-lg border border-gray-200 dark:border-[#2e2e2c] overflow-hidden bg-gray-100 dark:bg-[#141413] flex items-center justify-center min-h-[200px]"
            >
              <img :src="currentSrc" class="max-w-full max-h-[50vh] object-contain" />
            </div>
          </div>

          <!-- Filtered preview -->
          <div>
            <div class="text-[11px] font-semibold text-gray-400 dark:text-brand-mid mb-1.5">
              黑白效果
            </div>
            <div
              class="rounded-lg border border-gray-200 dark:border-[#2e2e2c] overflow-hidden bg-gray-100 dark:bg-[#141413] flex items-center justify-center min-h-[200px]"
            >
              <div
                v-if="processing"
                class="flex items-center gap-2 text-[12px] text-gray-400 dark:text-brand-mid"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class="animate-spin"
                >
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
                处理中...
              </div>
              <img
                v-else-if="filteredSrc"
                :src="filteredSrc"
                class="max-w-full max-h-[50vh] object-contain"
              />
              <span v-else class="text-[12px] text-gray-400 dark:text-brand-mid">
                {{ error || '等待处理...' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Threshold slider -->
        <div class="mt-4 flex items-center gap-3">
          <span class="text-[11px] text-gray-400 dark:text-brand-mid w-8 text-right">
            {{ threshold }}
          </span>
          <input
            type="range"
            min="60"
            max="240"
            v-model.number="threshold"
            class="flex-1 h-2 rounded-full appearance-none bg-gray-200 dark:bg-[#2e2e2c] accent-accent cursor-pointer"
          />
          <div class="flex gap-1 text-[10px] text-gray-400 dark:text-brand-mid">
            <button
              class="px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
              @click="threshold = Math.max(60, threshold - 10)"
            >
              −10
            </button>
            <button
              class="px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
              @click="threshold = Math.min(240, threshold + 10)"
            >
              +10
            </button>
          </div>
        </div>
        <p class="mt-1 text-[10px] text-gray-400 dark:text-brand-mid">
          阈值越高保留更多黑色笔迹，越低背景越干净。拖动滑块至文字清晰、背景纯白即可。
        </p>

        <!-- Keep only black toggle -->
        <label
          class="mt-3 flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors select-none"
          :class="[
            keepOnlyBlack
              ? 'border-accent/40 bg-accent/5 text-accent'
              : 'border-gray-200 dark:border-[#2e2e2c] text-gray-500 dark:text-brand-mid hover:bg-gray-50 dark:hover:bg-[#2a2a28]',
          ]"
        >
          <input v-model="keepOnlyBlack" type="checkbox" class="hidden" />
          <div
            class="w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
            :class="
              keepOnlyBlack ? 'bg-accent border-accent' : 'border-gray-300 dark:border-brand-mid'
            "
          >
            <svg
              v-if="keepOnlyBlack"
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              stroke-width="3"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <span class="text-[11px] font-medium">仅保留黑色（去除红笔批改、印章等彩色）</span>
        </label>
      </div>

      <!-- Footer -->
      <div
        class="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-[#2e2e2c] flex-shrink-0 bg-brand-light dark:bg-[#1a1a18]"
      >
        <button
          class="px-4 py-2 text-[12px] rounded-lg text-gray-500 dark:text-brand-mid hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
          @click="emit('skip', currentSrc)"
        >
          跳过滤镜
        </button>
        <button
          class="px-5 py-2 text-[12px] font-medium rounded-lg bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          :disabled="processing || !filteredSrc"
          @click="filteredSrc && emit('confirm', filteredSrc, threshold)"
        >
          使用黑白图
        </button>
      </div>
    </div>
  </div>
</template>
