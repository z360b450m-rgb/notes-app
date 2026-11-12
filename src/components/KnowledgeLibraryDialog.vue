<script setup lang="ts">
import SegmentedControl from './SegmentedControl.vue'
import { vDialogSurface } from '@/directives/dialogSurface'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { KnowledgeLibrary } from '@/composables/useKnowledgeLibraries'
import { useDialogBackdropClose } from '@/composables/useDialogBackdropClose'
import NotebookIngestPanel from './NotebookIngestPanel.vue'
import TaskProgress from './TaskProgress.vue'
import KnowledgeLibraryEntries from './KnowledgeLibraryEntries.vue'

const props = defineProps<{
  mode: 'insert' | 'manage'
  libraries: KnowledgeLibrary[]
  selected: string[]
  error: string
  importing: boolean
  importProgress: string
  importResults: { fileName: string; success: boolean; detail: string }[]
  activeImportId?: string
  actionIds?: string[]
  focusLibraryId?: string
  focusNotebookId?: string
}>()
const emit = defineEmits<{
  close: []
  insert: [ids: string[]]
  save: [input: { id?: string; name: string; description: string }]
  archive: [id: string]
  import: [files: File[]]
  'cancel-import': [id?: string]
  delete: [id: string]
  refresh: []
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick } = useDialogBackdropClose(
  () => emit('close'),
)
const fileInput = ref<HTMLInputElement | null>(null)
function pickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) emit('import', Array.from(input.files))
  input.value = ''
}
const tab = ref(props.mode)
const query = ref('')
const chosen = ref([...props.selected])
const editing = ref(false)
const draft = ref({ id: undefined as string | undefined, name: '', description: '' })
const showArchived = ref(false)
const pendingArchiveId = ref<string | null>(null)
const pendingDeleteId = ref<string | null>(null)
const entriesLibraryId = ref('')
const selectable = (item: KnowledgeLibrary) =>
  !item.archived && ['empty', 'ready'].includes(item.status)
const busyAction = (item: KnowledgeLibrary) =>
  props.actionIds?.includes(item.id) || ['cancelling', 'deleting'].includes(item.status)
const filtered = computed(() =>
  props.libraries.filter(
    (x) =>
      ((tab.value === 'manage' && showArchived.value) || !x.archived) &&
      `${x.name} ${x.description}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
)
onMounted(() => dialog.value?.showModal())
watch(
  () => props.focusLibraryId,
  async (id) => {
    if (!id || props.mode !== 'manage') return
    tab.value = 'manage'
    query.value = ''
    showArchived.value = true
    editing.value = false
    await nextTick()
    dialog.value
      ?.querySelector<HTMLElement>(
        props.focusNotebookId ? '.knowledge-ingest' : `[data-library-id="${CSS.escape(id)}"]`,
      )
      ?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
watch(
  () => props.libraries,
  () => {
    if (!props.error) editing.value = false
    chosen.value = chosen.value.filter((id) =>
      props.libraries.some((item) => item.id === id && selectable(item)),
    )
  },
)
function toggle(id: string) {
  chosen.value = chosen.value.includes(id)
    ? chosen.value.filter((x) => x !== id)
    : [...chosen.value, id]
}
function edit(item?: KnowledgeLibrary) {
  pendingDeleteId.value = null
  pendingArchiveId.value = null
  draft.value = item
    ? { id: item.id, name: item.name, description: item.description }
    : { id: undefined, name: '', description: '' }
  editing.value = true
  nextTick(() => dialog.value?.querySelector<HTMLInputElement>('#knowledge-name')?.focus())
}
function insert() {
  emit(
    'insert',
    chosen.value.filter((id) => props.libraries.some((x) => x.id === id && selectable(x))),
  )
  emit('close')
}
function switchTab(mode: 'insert' | 'manage') {
  pendingDeleteId.value = null
  pendingArchiveId.value = null
  tab.value = mode
  editing.value = false
}
function createLibrary() {
  tab.value = 'manage'
  edit()
}
function confirmArchive(item: KnowledgeLibrary) {
  if (pendingArchiveId.value !== item.id) return
  pendingArchiveId.value = null
  emit('archive', item.id)
}
function askDelete(item: KnowledgeLibrary) {
  pendingDeleteId.value = item.id
  pendingArchiveId.value = null
}
function confirmDelete(item: KnowledgeLibrary) {
  if (pendingDeleteId.value !== item.id || busyAction(item)) return
  emit('delete', item.id)
  pendingDeleteId.value = null
}
function cancelDialog() {
  if (pendingDeleteId.value) pendingDeleteId.value = null
  else if (pendingArchiveId.value) pendingArchiveId.value = null
  else emit('close')
}
watch([query, showArchived], () => {
  pendingArchiveId.value = null
  pendingDeleteId.value = null
})
</script>

<template>
  <dialog
    v-dialog-surface="'知识库'"
    ref="dialog"
    aria-labelledby="knowledge-heading"
    class="knowledge-dialog m-auto box-border w-[min(760px,calc(100vw-24px))] max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain rounded-2xl border border-black/10 bg-[#eeece5] p-4 text-brand-dark shadow-xl sm:p-6 dark:border-white/10 dark:bg-[#2d2b28] dark:text-brand-light"
    @cancel.prevent="cancelDialog"
    @pointerdown="onBackdropPointerDown"
    @pointercancel="onBackdropPointerCancel"
    @click="onBackdropClick"
  >
    <header class="mb-5 flex items-start justify-between">
      <div>
        <h2 id="knowledge-heading" class="text-xl font-semibold">知识库</h2>
        <p class="mt-2 text-sm text-brand-mid">管理学习资料与错题索引，选择对话的参考范围。</p>
      </div>
      <button
        data-ui-variant="text"
        data-dialog-cancel
        type="button"
        aria-label="关闭知识库"
        class="ui-control rounded-lg px-3 py-1"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>
    <SegmentedControl
      label="知识库模式"
      :model-value="tab"
      :options="[
        { value: 'insert', label: '插入知识库' },
        { value: 'manage', label: '管理知识库' },
      ]"
      @update:model-value="switchTab($event === 'manage' ? 'manage' : 'insert')"
    />
    <p v-if="error" role="alert" class="mb-4 text-sm text-red-500">{{ error }}</p>
    <NotebookIngestPanel
      v-if="tab === 'manage' && !editing"
      :libraries="libraries.filter(selectable)"
      :preferred-knowledge-base-id="focusLibraryId || selected[0]"
      :preferred-notebook-id="focusNotebookId"
      @background="emit('close')"
    />
    <input
      ref="fileInput"
      type="file"
      accept=".md,.pdf,text/markdown,application/pdf"
      multiple
      class="hidden"
      aria-label="导入 Markdown 或 PDF 学习资料"
      @change="pickFiles"
    />
    <div class="knowledge-import mb-5 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold">导入学习资料</p>
          <p class="mt-1 text-xs leading-6 text-brand-mid">
            Markdown / PDF · 每个文件创建一个服务端知识库，入库完成后可检索
          </p>
        </div>
        <button
          data-ui-variant="default"
          type="button"
          :disabled="importing"
          class="ui-control rounded-xl px-4 py-2 text-sm"
          @click="fileInput?.click()"
        >
          {{ importing ? '导入中…' : '导入文件' }}
        </button>
      </div>
      <p v-if="importing" role="status" class="mt-3 text-xs text-accent">{{ importProgress }}</p>
      <template v-if="importing">
        <TaskProgress label="学习资料入库进度" />
        <p class="mt-2 text-xs text-brand-mid">关闭窗口后继续后台入库，完成后会通知你。</p>
        <button
          data-ui-variant="text"
          data-dialog-cancel
          type="button"
          class="ui-control mt-2 text-xs text-accent"
          @click="emit('close')"
        >
          后台运行
        </button>
      </template>
      <button
        data-ui-variant="default"
        data-dialog-cancel
        v-if="importing && activeImportId"
        type="button"
        :disabled="
          actionIds?.includes(activeImportId) ||
          libraries.some(
            (item) =>
              item.id === activeImportId && ['cancelling', 'deleting'].includes(item.status),
          )
        "
        class="ui-control mt-2 rounded-lg px-3 py-1.5 text-xs text-accent"
        @click="emit('cancel-import', activeImportId)"
      >
        取消本次导入
      </button>
      <ul v-if="importResults.length" aria-live="polite" class="mt-3 space-y-2">
        <li
          v-for="(result, index) in importResults"
          :key="index"
          class="break-words text-xs"
          :class="result.success ? 'text-brand-mid' : 'text-red-500'"
        >
          {{ result.success ? '✓' : '×' }} {{ result.fileName }} · {{ result.detail }}
        </li>
      </ul>
      <p class="mt-2 text-xs leading-6 text-brand-mid">
        支持 UTF-8 编码的 Markdown（不超过 5 MB）和 PDF（不超过 100 MB、最多 300 页）。PDF
        需登录后解析。
      </p>
    </div>
    <form v-if="editing" class="space-y-4" @submit.prevent="emit('save', draft)">
      <label class="block text-xs"
        >名称<input
          id="knowledge-name"
          v-model="draft.name"
          required
          maxlength="60"
          class="ui-field mt-2 block w-full px-3 py-2 text-sm"
          placeholder="例如：英语语法笔记"
      /></label>
      <label class="block text-xs"
        >简介<input
          v-model="draft.description"
          maxlength="200"
          class="ui-field mt-2 block w-full px-3 py-2 text-sm"
          placeholder="可留空，导入时自动生成简短简介"
      /></label>
      <div class="flex justify-end gap-3">
        <button
          data-ui-variant="default"
          data-dialog-cancel
          type="button"
          class="ui-control rounded-xl px-4 py-2 text-sm"
          @click="editing = false"
        >
          取消</button
        ><button
          data-ui-variant="primary"
          type="submit"
          class="ui-control rounded-xl bg-accent px-4 py-2 text-sm text-white"
        >
          保存知识库
        </button>
      </div>
    </form>
    <template v-else>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <input
          v-model="query"
          aria-label="搜索知识库"
          placeholder="搜索知识库…"
          class="ui-field w-full min-w-0 flex-1 basis-40 px-3 py-2 text-sm"
        />
        <button
          data-ui-variant="default"
          type="button"
          class="ui-control rounded-xl px-4 py-2 text-sm"
          @click="createLibrary"
        >
          ＋ 新建知识库
        </button>
      </div>
      <label v-if="tab === 'manage'" class="mb-4 flex items-center gap-2 text-xs text-brand-mid"
        ><input v-model="showArchived" type="checkbox" />显示已归档</label
      >
      <div
        v-if="!filtered.length"
        class="rounded-2xl border border-dashed border-black/10 px-5 py-10 text-center dark:border-white/10"
      >
        <p class="text-sm">{{ libraries.length ? '没有匹配的知识库' : '还没有知识库' }}</p>
        <p class="mt-2 text-xs text-brand-mid">新建一个知识库，放入你的笔记和复习资料。</p>
      </div>
      <div class="space-y-3">
        <div
          v-for="item in filtered"
          :key="item.id"
          :data-library-id="item.id"
          :class="{ 'ring-2 ring-accent/50': item.id === focusLibraryId }"
          class="knowledge-library-card flex min-w-0 flex-wrap items-start gap-3 rounded-2xl border border-black/10 p-4 dark:border-white/10"
        >
          <input
            v-if="tab === 'insert'"
            type="checkbox"
            :aria-label="`选择 ${item.name}`"
            :checked="chosen.includes(item.id)"
            :disabled="!selectable(item)"
            class="mt-1"
            @change="toggle(item.id)"
          />
          <div class="min-w-0 flex-1 basis-40">
            <h3 class="break-words text-sm font-semibold">
              {{ item.name }}
              <span v-if="item.archived" class="text-xs text-brand-mid">已归档</span>
            </h3>
            <p class="mt-1 text-xs leading-6 text-brand-mid">
              {{ item.description || '暂无简介' }}
            </p>
            <p class="mt-2 text-xs text-brand-mid">
              {{ (item.charCount || 0).toLocaleString() }} 字 ·
              {{ item.source ? item.source.format.toUpperCase() : '服务端知识库'
              }}{{ item.source?.pageCount ? ` · ${item.source.pageCount} 页` : '' }}
            </p>
            <p
              v-if="['uploading', 'processing', 'cancelling', 'deleting'].includes(item.status)"
              role="status"
              class="mt-2 text-xs text-accent"
            >
              {{ item.stage || '正在处理' }}
            </p>
            <p
              v-else-if="['failed', 'cancel_failed', 'delete_failed'].includes(item.status)"
              role="alert"
              class="mt-2 text-xs text-red-500"
            >
              {{ item.error }}
            </p>
            <p
              v-else-if="item.status === 'cancelled'"
              role="status"
              class="mt-2 text-xs text-brand-mid"
            >
              已取消导入
            </p>
            <p v-else-if="item.status === 'ready'" class="mt-2 text-xs text-brand-mid">
              已入库 · {{ item.chunkCount }} 段资料 · {{ item.entityCount }} 个知识实体
            </p>
            <TaskProgress
              v-if="['uploading', 'processing', 'cancelling', 'deleting'].includes(item.status)"
              :label="`${item.name}入库进度`"
            />
          </div>
          <button
            data-ui-variant="text"
            v-if="
              ['uploading', 'processing', 'cancel_failed'].includes(item.status) &&
              item.id !== activeImportId
            "
            type="button"
            :disabled="busyAction(item)"
            class="ui-control rounded-lg px-3 py-1.5 text-xs text-accent"
            @click="emit('cancel-import', item.id)"
          >
            {{ item.status === 'cancel_failed' ? '重试清理' : '取消导入' }}
          </button>
          <div v-if="tab === 'manage'" class="flex max-w-full flex-wrap gap-2">
            <template v-if="pendingDeleteId === item.id">
              <p role="status" class="w-full text-xs leading-6 text-brand-mid">
                删除“{{ item.name }}”？资料及检索索引将永久删除，源错题和聊天记录会保留。
              </p>
              <button
                data-ui-variant="default"
                data-dialog-cancel
                type="button"
                class="ui-control rounded-lg px-3 py-1.5 text-xs"
                @click="pendingDeleteId = null"
              >
                取消
              </button>
              <button
                data-ui-variant="danger"
                type="button"
                :disabled="busyAction(item)"
                class="ui-control rounded-lg bg-red-700 px-3 py-1.5 text-xs text-white"
                @click="confirmDelete(item)"
              >
                确认删除
              </button>
            </template>
            <template v-else-if="pendingArchiveId === item.id">
              <p role="status" class="w-full text-xs leading-6 text-brand-mid">
                {{ item.archived ? '确定恢复这个知识库？' : '确定归档这个知识库？' }}
              </p>
              <button
                data-ui-variant="default"
                data-dialog-cancel
                type="button"
                class="ui-control rounded-lg px-3 py-1.5 text-xs"
                @click="pendingArchiveId = null"
              >
                取消
              </button>
              <button
                data-ui-variant="danger"
                type="button"
                class="ui-control rounded-lg bg-accent px-3 py-1.5 text-xs text-white"
                @click="confirmArchive(item)"
              >
                {{ item.archived ? '确认恢复' : '确认归档' }}
              </button>
            </template>
            <template v-else>
              <button
                data-ui-variant="default"
                type="button"
                :disabled="busyAction(item)"
                :aria-expanded="entriesLibraryId === item.id"
                class="ui-control rounded-lg px-3 py-1.5 text-xs text-accent"
                @click="entriesLibraryId = entriesLibraryId === item.id ? '' : item.id"
              >
                {{ entriesLibraryId === item.id ? '收起错题' : '查看错题' }}
              </button>
              <button
                data-ui-variant="text"
                type="button"
                :disabled="busyAction(item)"
                class="ui-control rounded-lg px-3 py-1.5 text-xs"
                @click="edit(item)"
              >
                编辑
              </button>
              <button
                data-ui-variant="default"
                type="button"
                :disabled="busyAction(item)"
                class="ui-control rounded-lg px-3 py-1.5 text-xs"
                @click="pendingArchiveId = item.id"
              >
                {{ item.archived ? '恢复' : '归档' }}
              </button>
              <button
                data-ui-variant="danger-text"
                type="button"
                :disabled="busyAction(item)"
                class="ui-control rounded-lg px-3 py-1.5 text-xs text-red-700"
                @click="askDelete(item)"
              >
                {{ item.status === 'delete_failed' ? '重试删除' : '删除' }}
              </button>
            </template>
          </div>
          <KnowledgeLibraryEntries
            v-if="tab === 'manage' && entriesLibraryId === item.id"
            :library-id="item.id"
            @changed="emit('refresh')"
          />
        </div>
      </div>
      <footer
        class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/15"
      >
        <span class="text-xs leading-6 text-brand-mid"
          >资料保存在服务端，入库完成后可用于对话检索</span
        ><button
          data-ui-variant="primary"
          v-if="tab === 'insert'"
          type="button"
          class="ui-control rounded-xl bg-accent px-4 py-2 text-sm text-white"
          @click="insert"
        >
          确认选择
          {{ chosen.filter((id) => libraries.some((x) => x.id === id && selectable(x))).length }} 个
        </button>
      </footer>
    </template>
  </dialog>
</template>

<style scoped>
.knowledge-dialog::backdrop {
  background: rgba(30, 27, 23, 0.3);
  backdrop-filter: blur(6px);
}
</style>
