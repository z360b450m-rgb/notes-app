<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { libraryRequest } from '@/services/knowledgeDocumentImport'
import { useNotebookIngest } from '@/composables/useNotebookIngest'

const props = defineProps<{ libraryId: string }>()
const emit = defineEmits<{ changed: [] }>()
interface IndexedQuestion {
  entry_id: string
  notebook_id: string
  notebook_name: string
  title: string
  subject: string
  preview: string
  tags: string[]
  has_images: boolean
}
interface QuestionDetail extends IndexedQuestion {
  question: string
  options: string[]
  material: string
  reference_answer: string
  student_answer: string
  images: string[]
}
const ingest = useNotebookIngest()
const items = ref<IndexedQuestion[]>([])
const total = ref(0)
const offset = ref(0)
const query = ref('')
const loading = ref(false)
const error = ref('')
const detail = ref<QuestionDetail | null>(null)
const detailLoading = ref('')
const pendingRemove = ref<IndexedQuestion | null>(null)
const removing = ref(false)
const pageSize = 20
let version = 0
let detailVersion = 0
const controller = new AbortController()
const rowKey = (item: IndexedQuestion) => `${item.notebook_id}:${item.entry_id}`
const entryPath = (item: IndexedQuestion) =>
  `/${props.libraryId}/entries/${encodeURIComponent(item.notebook_id)}/${encodeURIComponent(item.entry_id)}`
const running = (item: IndexedQuestion) =>
  ingest.indexes.value.some(
    (index) =>
      index.kb_id === props.libraryId &&
      index.notebook_id === item.notebook_id &&
      index.status === 'running',
  )
const images = computed(() =>
  (detail.value?.images ?? []).filter(
    (url) => /^https?:\/\//i.test(url) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url),
  ),
)
async function load() {
  const requestVersion = ++version
  loading.value = true
  error.value = ''
  detail.value = null
  detailVersion++
  detailLoading.value = ''
  pendingRemove.value = null
  try {
    const params = new URLSearchParams({
      q: query.value.trim(),
      offset: String(offset.value),
      limit: String(pageSize),
    })
    const result = await libraryRequest(
      `/${props.libraryId}/entries?${params}`,
      {},
      controller.signal,
    )
    if (requestVersion !== version || controller.signal.aborted) return
    if (!Array.isArray(result?.items) || !Number.isInteger(result.total))
      throw new Error('错题列表响应无效')
    total.value = result.total
    if (offset.value >= total.value && offset.value > 0) {
      offset.value = Math.max(0, Math.floor((total.value - 1) / pageSize) * pageSize)
      await load()
      return
    }
    items.value = result.items
  } catch (cause) {
    if (requestVersion === version && !controller.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : '错题读取失败，请重试'
      items.value = []
    }
  } finally {
    if (requestVersion === version) loading.value = false
  }
}
async function view(item: IndexedQuestion) {
  if (detail.value && rowKey(detail.value) === rowKey(item)) {
    detailVersion++
    detail.value = null
    detailLoading.value = ''
    return
  }
  const requestVersion = ++detailVersion
  detailLoading.value = rowKey(item)
  detail.value = null
  error.value = ''
  try {
    const result = await libraryRequest(entryPath(item), {}, controller.signal)
    if (requestVersion === detailVersion && !controller.signal.aborted) detail.value = result
  } catch (cause) {
    if (requestVersion === detailVersion && !controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '题目读取失败'
  } finally {
    if (requestVersion === detailVersion) detailLoading.value = ''
  }
}
async function remove() {
  const item = pendingRemove.value
  if (!item || removing.value || running(item)) return
  removing.value = true
  error.value = ''
  try {
    const result = await libraryRequest(entryPath(item), { method: 'DELETE' }, controller.signal)
    if (result?.removed !== true) throw new Error('未能确认错题已移除，请重试')
    await ingest.refresh()
    await load()
    emit('changed')
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '移除失败，请重试'
  } finally {
    removing.value = false
  }
}
function search() {
  offset.value = 0
  void load()
}
function page(direction: number) {
  offset.value += direction * pageSize
  void load()
}
watch(
  () => props.libraryId,
  () => {
    offset.value = 0
    query.value = ''
    void load()
  },
  { immediate: true },
)
watch(
  () =>
    ingest.indexes.value
      .filter((index) => index.kb_id === props.libraryId)
      .map((index) => `${index.id}:${index.status}:${index.indexed_count}`)
      .join('|'),
  () => {
    if (!removing.value) void load()
  },
)
onScopeDispose(() => {
  version++
  detailVersion++
  controller.abort()
})
</script>

<template>
  <section
    aria-label="知识库已入库错题"
    class="w-full min-w-0 border-t border-black/10 pt-4 dark:border-white/10"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="text-sm font-semibold">已入库错题 · {{ total }} 道</h4>
      <button
        data-ui-variant="default"
        type="button"
        :disabled="loading || removing"
        class="ui-control rounded-lg border border-black/10 px-3 py-1.5 text-xs text-brand-dark disabled:opacity-40 dark:border-white/15 dark:text-brand-light"
        @click="load"
      >
        刷新错题
      </button>
    </div>
    <p class="mt-1 text-xs leading-6 text-brand-mid">
      这里展示入库时保存的题目。移除只影响当前知识库，源错题会保留；再次执行来源错题本入库时会重新导入。
    </p>
    <form class="mt-3 flex gap-2" @submit.prevent="search">
      <input
        v-model="query"
        aria-label="搜索已入库错题"
        placeholder="搜索题名、题干或知识点"
        maxlength="200"
        class="ui-field min-w-0 flex-1 px-3 py-2 text-xs"
        :disabled="removing"
      />
      <button
        data-ui-variant="primary"
        type="submit"
        class="ui-control rounded-lg border border-black/10 px-3 py-2 text-xs text-brand-dark disabled:opacity-40 dark:border-white/15 dark:text-brand-light"
        :disabled="loading || removing"
      >
        搜索
      </button>
    </form>
    <p v-if="error" role="alert" class="mt-3 text-xs text-red-500">{{ error }}</p>
    <p v-if="loading" role="status" class="mt-3 text-xs text-brand-mid">正在读取错题…</p>
    <p v-else-if="!items.length && !error" class="mt-4 text-xs text-brand-mid">
      {{ query.trim() ? '没有匹配的错题' : '这个知识库还没有已入库错题' }}
    </p>
    <ul v-else class="mt-3 space-y-3">
      <li
        v-for="item in items"
        :key="rowKey(item)"
        class="min-w-0 rounded-xl border border-black/10 p-3 dark:border-white/10"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1 basis-40">
            <p class="break-words text-sm font-medium">{{ item.title }}</p>
            <p class="mt-1 break-words text-xs text-brand-mid">
              {{ item.notebook_name }} · {{ item.subject || '未分类' }}
            </p>
            <p class="mt-2 break-words text-xs leading-6 text-brand-mid">{{ item.preview }}</p>
            <p v-if="item.tags.length" class="mt-1 break-words text-xs text-brand-mid">
              {{ item.tags.join(' · ') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              data-ui-variant="text"
              type="button"
              :aria-expanded="!!detail && rowKey(detail) === rowKey(item)"
              :disabled="removing"
              class="ui-control rounded-lg border border-black/10 px-3 py-1.5 text-xs text-brand-dark dark:border-white/15 dark:text-brand-light"
              @click="view(item)"
            >
              {{
                detailLoading === rowKey(item)
                  ? '读取中…'
                  : detail && rowKey(detail) === rowKey(item)
                    ? '收起题目'
                    : '查看题目'
              }}
            </button>
            <button
              data-ui-variant="danger-text"
              type="button"
              :disabled="removing || running(item)"
              class="ui-control rounded-lg px-3 py-1.5 text-xs text-red-700 disabled:opacity-40 dark:text-red-300"
              @click="pendingRemove = item"
            >
              {{ running(item) ? '入库中' : '从知识库移除' }}
            </button>
          </div>
        </div>
        <div
          v-if="detail && rowKey(detail) === rowKey(item)"
          class="mt-3 space-y-3 border-t border-black/10 pt-3 text-xs leading-6 dark:border-white/10"
        >
          <div v-if="detail.material">
            <p class="font-semibold">公共材料</p>
            <p class="whitespace-pre-wrap break-words">{{ detail.material }}</p>
          </div>
          <div>
            <p class="font-semibold">题干</p>
            <p class="whitespace-pre-wrap break-words">{{ detail.question }}</p>
            <p
              v-for="(option, index) in detail.options"
              :key="index"
              class="whitespace-pre-wrap break-words"
            >
              {{ option }}
            </p>
          </div>
          <img
            v-for="(url, index) in images"
            :key="index"
            :src="url"
            alt="已入库题目图片"
            referrerpolicy="no-referrer"
            class="max-h-80 max-w-full rounded-lg object-contain"
          />
          <p v-if="detail.has_images && !images.length" class="text-brand-mid">
            题目包含绘图，完整图形请在来源错题本中查看。
          </p>
          <div v-if="detail.student_answer">
            <p class="font-semibold">学生答案</p>
            <p class="whitespace-pre-wrap break-words">{{ detail.student_answer }}</p>
          </div>
          <div v-if="detail.reference_answer">
            <p class="font-semibold">参考答案与解析</p>
            <p class="whitespace-pre-wrap break-words">{{ detail.reference_answer }}</p>
          </div>
        </div>
        <div
          v-if="pendingRemove && rowKey(pendingRemove) === rowKey(item)"
          class="mt-3 rounded-lg bg-red-500/5 p-3"
        >
          <p role="status" class="break-words text-xs leading-6">
            确认从当前知识库移除“{{ item.title }}”？源错题会保留。
          </p>
          <div class="mt-2 flex justify-end gap-2">
            <button
              data-ui-variant="default"
              data-dialog-cancel
              type="button"
              :disabled="removing"
              class="ui-control rounded-lg px-3 py-1.5 text-xs"
              @click="pendingRemove = null"
            >
              取消移除
            </button>
            <button
              data-ui-variant="danger"
              type="button"
              :disabled="removing || running(item)"
              class="ui-control rounded-lg bg-red-700 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              @click="remove"
            >
              {{ removing ? '正在移除…' : '确认移除' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
    <div v-if="total > pageSize" class="mt-4 flex items-center justify-between gap-2 text-xs">
      <button
        data-ui-variant="text"
        type="button"
        :disabled="loading || removing || offset === 0"
        class="ui-control rounded-lg px-3 py-1.5 disabled:opacity-40"
        @click="page(-1)"
      >
        上一页
      </button>
      <span>{{ Math.floor(offset / pageSize) + 1 }} / {{ Math.ceil(total / pageSize) }}</span>
      <button
        data-ui-variant="text"
        type="button"
        :disabled="loading || removing || offset + pageSize >= total"
        class="ui-control rounded-lg px-3 py-1.5 disabled:opacity-40"
        @click="page(1)"
      >
        下一页
      </button>
    </div>
  </section>
</template>
