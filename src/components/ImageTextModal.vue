<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { recognizeImageText } from '@/services/imageOcr'
import { rotateImage } from '@/utils/imageFilters'

const props = withDefaults(
  defineProps<{
    imageSrc: string
    notebookId: string
    keepOriginal?: boolean
    inserting?: boolean
    insertionError?: string
  }>(),
  { keepOriginal: false },
)
const emit = defineEmits<{
  confirm: [text: string, imageSrc: string, keepOriginal: boolean]
  skip: [imageSrc: string]
  cancel: []
}>()
const currentSrc = ref(props.imageSrc)
const dialog = ref<HTMLElement | null>(null)
const text = ref('')
const processing = ref(false)
const rotating = ref(false)
const error = ref('')
const keepImage = ref(props.keepOriginal)
let controller: AbortController | null = null
let sequence = 0

function stop() {
  sequence++
  controller?.abort()
  processing.value = false
}
function cancel() {
  stop()
  emit('cancel')
}
function insertImageOnly() {
  stop()
  emit('skip', currentSrc.value)
}
async function recognize() {
  stop()
  const revision = sequence
  const request = new AbortController()
  controller = request
  processing.value = true
  error.value = ''
  const timeout = setTimeout(() => request.abort(), 125_000)
  try {
    const result = await recognizeImageText(currentSrc.value, props.notebookId, request.signal)
    if (revision !== sequence) return
    text.value = result
    if (!result.trim()) error.value = '没有识别到文字，可以重新裁剪或仅插入图片。'
  } catch (cause) {
    if (revision !== sequence) return
    error.value = request.signal.aborted
      ? '识别超时，请重试或仅插入图片。'
      : cause instanceof Error
        ? cause.message
        : '文字识别失败，请重试'
  } finally {
    clearTimeout(timeout)
    if (revision === sequence) processing.value = false
  }
}
async function rotate(degrees: number) {
  const revision = sequence
  rotating.value = true
  try {
    const result = await rotateImage(currentSrc.value, degrees)
    if (revision !== sequence) return
    currentSrc.value = result
    text.value = ''
    void recognize()
  } catch {
    error.value = '旋转失败，请重新选择图片'
  } finally {
    rotating.value = false
  }
}
watch(
  () => [props.imageSrc, props.notebookId],
  () => {
    currentSrc.value = props.imageSrc
    text.value = ''
    keepImage.value = props.keepOriginal
    void recognize()
  },
  { immediate: true },
)
onMounted(() => dialog.value?.focus())
onUnmounted(stop)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    @click.self="cancel"
    @keydown.esc.stop.prevent="cancel"
  >
    <section
      v-dialog-surface="'识别图片文字'"
      ref="dialog"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-text-title"
      data-testid="image-text-modal"
      class="mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
    >
      <header
        class="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-[#2e2e2c]"
      >
        <h2 id="image-text-title" class="font-semibold text-gray-800 dark:text-brand-light-gray">
          图片转文字
        </h2>
        <button
          data-ui-variant="text"
          data-dialog-cancel
          type="button"
          aria-label="关闭图片转文字"
          class="ui-control rounded px-2 py-1 text-gray-500 hover:bg-black/5"
          @click="cancel"
        >
          ✕
        </button>
      </header>
      <div class="overflow-auto p-5">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <div
              class="mb-2 flex items-center justify-between text-sm text-gray-500 dark:text-brand-mid"
            >
              <span>原图</span>
              <div class="flex gap-2">
                <button
                  data-ui-variant="text"
                  type="button"
                  aria-label="向左旋转"
                  :disabled="processing || rotating"
                  class="ui-control disabled:opacity-40"
                  @click="rotate(-90)"
                >
                  ↶
                </button>
                <button
                  data-ui-variant="text"
                  type="button"
                  aria-label="向右旋转"
                  :disabled="processing || rotating"
                  class="ui-control disabled:opacity-40"
                  @click="rotate(90)"
                >
                  ↷
                </button>
              </div>
            </div>
            <div
              class="flex min-h-[240px] items-center justify-center overflow-auto rounded-lg border border-gray-200 bg-gray-50 dark:border-[#2e2e2c] dark:bg-[#141413]"
            >
              <img
                :src="currentSrc"
                alt="待识别的原图"
                class="max-h-[50vh] max-w-full object-contain"
              />
            </div>
          </div>
          <div class="flex min-h-[280px] flex-col">
            <label for="image-text-result" class="mb-2 text-sm text-gray-500 dark:text-brand-mid"
              >识别文字（可修改）</label
            >
            <textarea
              id="image-text-result"
              v-model="text"
              :disabled="processing || rotating"
              :maxlength="200000"
              class="ui-field min-h-[240px] flex-1 resize-y rounded-lg border border-gray-200 bg-transparent p-3 text-sm leading-relaxed text-gray-800 outline-none focus:border-accent disabled:opacity-60 dark:border-[#2e2e2c] dark:text-gray-200"
              :placeholder="
                processing
                  ? '正在识别图片中的文字…'
                  : '识别结果将显示在这里，也可以手动输入或修改。'
              "
            />
          </div>
        </div>
        <p v-if="processing" role="status" class="mt-3 text-sm text-gray-500 dark:text-brand-mid">
          正在识别文字，首次使用需要加载模型…
        </p>
        <p v-if="error || insertionError" role="alert" class="mt-3 text-sm text-red-500">
          {{ insertionError || error }}
        </p>
        <label class="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-brand-mid">
          <input v-model="keepImage" type="checkbox" class="accent-accent" />同时保留原图
        </label>
        <p class="mt-2 text-xs text-gray-400">图表建议保留原图；识别后请核对数字、公式和选项。</p>
      </div>
      <footer
        class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-[#2e2e2c]"
      >
        <button
          data-ui-variant="primary"
          type="button"
          class="ui-control mr-auto rounded-lg px-3 py-2 text-sm text-gray-500 disabled:opacity-40"
          :disabled="processing || rotating"
          @click="recognize"
        >
          重新识别
        </button>
        <button
          data-ui-variant="default"
          data-dialog-cancel
          type="button"
          class="ui-control rounded-lg px-3 py-2 text-sm text-gray-500"
          @click="cancel"
        >
          取消
        </button>
        <button
          data-ui-variant="default"
          type="button"
          class="ui-control rounded-lg px-3 py-2 text-sm text-gray-500 disabled:opacity-40"
          :disabled="inserting || rotating"
          @click="insertImageOnly"
        >
          仅插入图片
        </button>
        <button
          data-ui-variant="primary"
          type="button"
          class="ui-control rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          :disabled="processing || rotating || inserting || !text.trim()"
          @click="emit('confirm', text, currentSrc, keepImage)"
        >
          {{ inserting ? '正在插入…' : '插入文字' }}
        </button>
      </footer>
    </section>
  </div>
</template>
