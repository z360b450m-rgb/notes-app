<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { KnowledgeLibrary } from '@/composables/useKnowledgeLibraries'
import { useNotebookIngest } from '@/composables/useNotebookIngest'
import MetadataSelect from './MetadataSelect.vue'
import TaskProgress from './TaskProgress.vue'

const props = defineProps<{
  libraries: KnowledgeLibrary[]
  preferredKnowledgeBaseId?: string
  preferredNotebookId?: string
}>()
const emit = defineEmits<{ background: [] }>()
const { sources, indexes, error, submitting, refresh, execute: submit } = useNotebookIngest()
const kbId = ref('')
const notebookId = ref('')
const result = computed(() =>
  indexes.value.find((x) => x.kb_id === kbId.value && x.notebook_id === notebookId.value),
)
const busy = computed(() => submitting.value || result.value?.status === 'running')
const progress = computed(() =>
  submitting.value
    ? undefined
    : result.value?.status === 'completed'
      ? 100
      : result.value?.report.pending
        ? Math.min(100, (result.value.report.processed / result.value.report.pending) * 100)
        : undefined,
)
watch(
  () => props.libraries,
  () => {
    kbId.value =
      props.libraries.find((item) => !item.archived && item.id === kbId.value)?.id ??
      props.libraries.find((item) => !item.archived && item.id === props.preferredKnowledgeBaseId)
        ?.id ??
      props.libraries.find((item) => !item.archived)?.id ??
      ''
  },
  { immediate: true },
)
watch(
  () => props.preferredKnowledgeBaseId,
  (id) => {
    if (id && props.libraries.some((item) => item.id === id && !item.archived)) kbId.value = id
  },
  { immediate: true },
)
watch(
  () => props.preferredNotebookId,
  (id) => {
    if (id) notebookId.value = id
  },
  { immediate: true },
)
async function execute(remove = false) {
  if (!busy.value && kbId.value && notebookId.value)
    await submit(kbId.value, notebookId.value, remove)
}
onMounted(async () => {
  await refresh()
  notebookId.value = props.preferredNotebookId || sources.value[0]?.id || ''
})
</script>

<template>
  <section
    aria-label="错题本入库"
    class="knowledge-ingest mb-5 min-w-0 rounded-xl border border-black/10 p-4 dark:border-white/10"
  >
    <h3 class="text-sm font-semibold">错题本入库</h3>
    <p class="mt-1 text-xs leading-6 text-brand-mid">
      选择知识库和错题本，点击执行后才更新索引。再次执行会同步新增、修改和删除的题目。
    </p>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <label class="text-xs"
        >目标知识库
        <div class="mt-2">
          <MetadataSelect
            v-model="kbId"
            :disabled="submitting"
            label="入库目标知识库"
            placeholder="请先新建或选择知识库"
            :options="
              libraries
                .filter((library) => !library.archived)
                .map((library) => ({ value: library.id, label: library.name }))
            "
          />
        </div>
      </label>
      <label class="text-xs"
        >来源错题本
        <div class="mt-2">
          <MetadataSelect
            v-model="notebookId"
            :disabled="submitting"
            label="入库来源错题本"
            placeholder="请选择错题本"
            :options="
              sources.map((book) => ({
                value: book.id,
                label: `${book.name}${book.deleted ? '（已删除，再执行可清理索引）' : ''}`,
              }))
            "
          />
        </div>
      </label>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-xs text-red-500">{{ error }}</p>
    <TaskProgress v-if="submitting && !result" label="正在提交错题本入库任务" />
    <div class="mt-3 flex flex-wrap gap-3">
      <button
        data-ui-variant="primary"
        type="button"
        :disabled="busy || !kbId || !notebookId"
        class="ui-control rounded-xl bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
        @click="execute()"
      >
        {{ busy ? '入库中…' : '执行入库' }}
      </button>
      <button
        data-ui-variant="default"
        v-if="result?.indexed_count"
        type="button"
        :disabled="busy"
        class="ui-control rounded-xl px-4 py-2 text-xs disabled:opacity-40"
        @click="execute(true)"
      >
        移除该错题本索引
      </button>
    </div>
    <div v-if="busy" class="mt-3 text-xs text-brand-mid">
      <p>可以关闭窗口或切换页面，任务将在后台继续。</p>
      <button
        data-ui-variant="default"
        type="button"
        class="ui-control mt-2 text-accent"
        @click="emit('background')"
      >
        后台运行
      </button>
    </div>
    <div
      v-if="result"
      role="status"
      aria-live="polite"
      class="knowledge-index-result mt-4 rounded-lg border p-3 text-xs leading-6"
    >
      <TaskProgress
        v-if="result.status === 'running' || result.status === 'completed'"
        :value="progress"
        label="错题本入库进度"
      />
      <p class="text-sm font-medium">
        {{
          result.status === 'running'
            ? '正在处理'
            : result.status === 'completed'
              ? '入库完成'
              : '部分失败，请检查后重新执行'
        }}
        · 当前已入库 {{ result.indexed_count }} 道题
      </p>
      <p>
        新增 {{ result.report.added }} · 更新 {{ result.report.updated }} · 删除
        {{ result.report.deleted }} · 跳过 {{ result.report.skipped }} · 失败
        {{ result.report.failed }}
      </p>
      <p class="text-brand-mid">
        本次变更 {{ result.report.pending }} 项，已处理
        {{ result.report.processed }} 项。只读取服务器已保存的数据。
      </p>
      <ul v-if="result.report.failures.length" class="mt-1 text-red-500">
        <li v-for="failure in result.report.failures.slice(0, 5)" :key="failure.entry_id">
          {{ failure.entry_id }}：{{ failure.message }}
        </li>
      </ul>
    </div>
  </section>
</template>
