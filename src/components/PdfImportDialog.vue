<script setup lang="ts">
import MetadataSelect from './MetadataSelect.vue'
import { vDialogSurface } from '@/directives/dialogSurface'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PdfImportResult } from '@/services/pdfImport'
import { pdfQuestionIssues, type PdfDraft, type PdfQuestion } from '@/services/pdfQuestionDraft'
import { useDialogBackdropClose } from '@/composables/useDialogBackdropClose'
import TaskProgress from './TaskProgress.vue'

const props = withDefaults(
  defineProps<{
    loading: boolean
    progress: string
    error: string
    result: PdfImportResult | null
    draft?: PdfDraft | null
    confirming?: boolean
    cancelling?: boolean
    visible?: boolean
  }>(),
  { visible: true },
)
const emit = defineEmits<{
  close: []
  submit: [file: File]
  confirm: [keys: string[]]
  reload: []
  background: []
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick } =
  useDialogBackdropClose(close)
const file = ref<File | null>(null)
const selected = ref<string[]>([])
const reviewed = ref(false)
const sourceUrl = ref('')
const activeKey = ref('')
const activeKind = ref<'question' | 'group'>('question')
const editor = ref<HTMLElement | null>(null)
const directory = ref<HTMLElement | null>(null)
const busy = computed(() => props.loading || !!props.confirming || !!props.cancelling)
const preview = computed(() =>
  props.draft && props.result?.status !== 'completed' ? props.draft : null,
)
const activeQuestion = computed(() =>
  activeKind.value === 'question'
    ? preview.value?.draft.questions.find((question) => question.key === activeKey.value)
    : undefined,
)
const activeGroup = computed(() =>
  activeKind.value === 'group'
    ? preview.value?.draft.groups.find((group) => group.key === activeKey.value)
    : undefined,
)
const questionIndex = computed(
  () =>
    preview.value?.draft.questions.findIndex((question) => question.key === activeKey.value) ?? -1,
)
function questionLocation(question: PdfQuestion) {
  const position =
    (preview.value?.draft.questions.findIndex((q) => q.key === question.key) ?? -1) + 1
  const group = preview.value?.draft.groups.findIndex((g) => g.key === question.group_key) ?? -1
  return `第 ${position} 道${group >= 0 ? ` · 第 ${group + 1} 组` : ''} · 原第 ${question.source_number} 题 · PDF 第 ${question.source_pages.join('、')} 页`
}
const validationIssues = computed(() =>
  (preview.value?.draft.questions ?? [])
    .filter((question) => selected.value.includes(question.key))
    .map((question) => ({ question, messages: pdfQuestionIssues(question) }))
    .filter((issue) => issue.messages.length),
)
function confirmSelection() {
  const first = validationIssues.value[0]
  if (first) {
    void showItem('question', first.question.key)
    return
  }
  emit('confirm', selected.value)
}
const allSelected = computed({
  get: () =>
    !!preview.value?.draft.questions.length &&
    selected.value.length === preview.value.draft.questions.length,
  set: (value: boolean) => {
    selected.value = value
      ? (preview.value?.draft.questions.map((question) => question.key) ?? [])
      : []
  },
})
const step = computed(() => (props.result?.status === 'completed' ? 3 : preview.value ? 2 : 1))
watch(
  () => props.draft?.id,
  () => {
    selected.value = props.draft?.draft.questions.map((q) => q.key) ?? []
    activeKind.value = 'question'
    activeKey.value = props.draft?.draft.questions[0]?.key ?? ''
    reviewed.value = false
  },
  { immediate: true },
)
watch(
  () => props.draft?.revision,
  () => {
    const keys = new Set(props.draft?.draft.questions.map((question) => question.key))
    selected.value = selected.value.filter((key) => keys.has(key))
  },
)
async function showItem(kind: 'question' | 'group', key: string) {
  activeKind.value = kind
  activeKey.value = key
  await nextTick()
  editor.value?.scrollTo({ top: 0 })
  // Keep the selected item visible without scrolling the dialog or its footer.
  const item = directory.value?.querySelector<HTMLElement>(
    kind === 'question' ? '.pdf-nav-row.is-active' : '.pdf-material-nav [aria-current="true"]',
  )
  if (!item) return
  for (const pane of [item.parentElement, directory.value]) {
    if (!pane) continue
    const bounds = pane.getBoundingClientRect()
    const target = item.getBoundingClientRect()
    if (pane.scrollHeight > pane.clientHeight) {
      if (target.top < bounds.top) pane.scrollTop -= bounds.top - target.top
      else if (target.bottom > bounds.bottom) pane.scrollTop += target.bottom - bounds.bottom
    }
    if (pane.scrollWidth > pane.clientWidth) {
      if (target.left < bounds.left) pane.scrollLeft -= bounds.left - target.left
      else if (target.right > bounds.right) pane.scrollLeft += target.right - bounds.right
    }
  }
  if (kind === 'question' && key === preview.value?.draft.questions[0]?.key)
    directory.value?.scrollTo({ top: 0 })
}
function nextQuestion(offset: number) {
  const question = preview.value?.draft.questions[questionIndex.value + offset]
  if (question) void showItem('question', question.key)
}
function images(keys: string[]) {
  return [...new Set(keys)].flatMap((key) => {
    const asset = props.draft?.draft.assets.find((a) => a.key === key)
    return asset ? [asset] : []
  })
}
function addOption(question: PdfDraft['draft']['questions'][number]) {
  const key = 'ABCDEFGH'.split('').find((letter) => !question.options.some((o) => o.key === letter))
  if (key) question.options.push({ key, text: '' })
}

function syncVisibility() {
  if (props.visible === false) dialog.value?.close()
  else if (!dialog.value?.open) dialog.value?.showModal()
}
onMounted(syncVisibility)
watch(() => props.visible, syncVisibility)

function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = file.value ? URL.createObjectURL(file.value) : ''
}

function close() {
  if (!props.confirming && !props.cancelling) emit('close')
}
function reload() {
  reviewed.value = false
  emit('reload')
}
onUnmounted(() => {
  dialog.value?.close()
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
})
</script>

<template>
  <dialog
    v-dialog-surface="'导入 PDF'"
    ref="dialog"
    aria-labelledby="pdf-import-title"
    class="pdf-import-dialog"
    :class="{ 'pdf-import-dialog--preview': preview }"
    @cancel.prevent="close"
    @pointerdown="onBackdropPointerDown"
    @pointercancel="onBackdropPointerCancel"
    @click="onBackdropClick"
  >
    <div class="pdf-import-layout">
      <header class="pdf-import-header">
        <div>
          <p class="pdf-eyebrow">AI 辅助导入</p>
          <h2 id="pdf-import-title">导入 PDF 错题</h2>
          <p class="pdf-subtitle">
            {{
              preview
                ? '逐题校对识别结果，确认后保存到错题本。'
                : '从试卷中提取题目、图片和公共材料。'
            }}
          </p>
        </div>
        <span class="pdf-stage">{{
          step === 3 ? '导入完成' : preview ? '等待校对' : loading ? '正在识别' : '选择文件'
        }}</span>
      </header>

      <ol class="pdf-steps" aria-label="导入步骤">
        <li
          v-for="(label, index) in ['选择文件', '校对题目', '完成导入']"
          :key="label"
          :aria-current="step === index + 1 ? 'step' : undefined"
          :class="{ 'is-current': step === index + 1, 'is-complete': step > index + 1 }"
        >
          <span>{{ step > index + 1 ? '✓' : index + 1 }}</span
          >{{ label }}
        </li>
      </ol>

      <div v-if="error" role="alert" class="pdf-error">{{ error }}</div>
      <div v-if="validationIssues.length" role="alert" class="pdf-error pdf-validation">
        <p>所选题目中有 {{ validationIssues.length }} 道需要处理，点击可定位：</p>
        <button
          class="ui-choice"
          v-for="issue in validationIssues"
          :key="issue.question.key"
          type="button"
          data-testid="pdf-import-issue"
          :disabled="busy"
          @click="showItem('question', issue.question.key)"
        >
          {{ questionLocation(issue.question) }}：{{ issue.messages.join('；') }}
        </button>
      </div>
      <p v-if="loading" role="status" class="pdf-progress">
        <span class="pdf-spinner" aria-hidden="true" />{{ progress || '正在处理，请稍候…' }}
      </p>
      <div v-if="loading || confirming" class="px-5 pb-3">
        <TaskProgress :label="confirming ? 'PDF 题目录入进度' : 'PDF 识别进度'" />
        <div class="mt-2 flex items-center justify-between gap-3 text-xs text-brand-mid">
          <span>可以切换页面，完成后会通知你。</span>
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control text-accent"
            @click="emit('background')"
          >
            后台运行
          </button>
        </div>
      </div>

      <section v-if="preview" data-testid="pdf-import-preview" class="pdf-preview">
        <div class="pdf-preview-bar">
          <div class="min-w-0">
            <p class="pdf-filename" :title="preview.filename">{{ preview.filename }}</p>
            <p class="pdf-muted">
              {{ preview.draft.questions.length }} 道题目 ·
              {{ preview.draft.groups.length }} 份公共材料 · {{ preview.draft.page_count }} 页
            </p>
          </div>
          <a
            v-if="sourceUrl"
            :href="sourceUrl"
            target="_blank"
            rel="noopener"
            class="pdf-source-link"
            >查看原 PDF ↗</a
          >
        </div>

        <div class="pdf-import-body">
          <aside ref="directory" class="pdf-directory" aria-label="导入内容目录">
            <div class="pdf-directory-heading">
              <h3>题目</h3>
              <label
                ><input
                  v-model="allSelected"
                  type="checkbox"
                  :indeterminate="selected.length > 0 && !allSelected"
                  :disabled="busy"
                />全选</label
              >
            </div>
            <nav class="pdf-question-nav" aria-label="选择校对题目">
              <div
                v-for="question in preview.draft.questions"
                :key="question.key"
                data-testid="pdf-import-question"
                class="pdf-nav-row"
                :class="{
                  'is-active': activeKind === 'question' && activeKey === question.key,
                  'is-excluded': !selected.includes(question.key),
                }"
              >
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="question.key"
                  :aria-label="'第 ' + question.source_number + ' 题'"
                  :disabled="busy"
                />
                <button
                  class="ui-choice"
                  type="button"
                  :aria-current="
                    activeKind === 'question' && activeKey === question.key ? 'true' : undefined
                  "
                  :disabled="busy"
                  @click="showItem('question', question.key)"
                >
                  <span class="pdf-nav-title">第 {{ question.source_number }} 题</span>
                  <span class="pdf-nav-description">{{ question.stem || '待补充题干' }}</span>
                  <span v-if="pdfQuestionIssues(question).length" class="pdf-nav-issue">
                    {{ pdfQuestionIssues(question).join('；') }}
                  </span>
                  <span class="pdf-nav-meta"
                    >{{ question.kind === 'choice' ? '选择题' : '非选择题' }} · 第
                    {{ question.source_pages.join('、') }} 页<span
                      v-if="question.warnings.length"
                      class="pdf-warning-dot"
                      title="有待核对提示"
                  /></span>
                </button>
              </div>
            </nav>
            <template v-if="preview.draft.groups.length">
              <h3 class="pdf-material-heading">
                公共材料 <span>{{ preview.draft.groups.length }}</span>
              </h3>
              <nav class="pdf-material-nav" aria-label="选择校对公共材料">
                <button
                  class="ui-choice"
                  v-for="group in preview.draft.groups"
                  :key="group.key"
                  type="button"
                  data-testid="pdf-import-group"
                  :aria-current="
                    activeKind === 'group' && activeKey === group.key ? 'true' : undefined
                  "
                  :disabled="busy"
                  @click="showItem('group', group.key)"
                >
                  <span class="truncate">{{ group.title || '未命名材料' }}</span
                  ><span class="pdf-muted"
                    >{{
                      preview.draft.questions.filter((q) => q.group_key === group.key).length
                    }}
                    题</span
                  >
                </button>
              </nav>
            </template>
          </aside>

          <div ref="editor" class="pdf-editor" aria-label="校对编辑区">
            <fieldset
              v-if="activeQuestion"
              :key="'question-' + activeQuestion.key"
              :disabled="busy"
              class="pdf-question-form"
            >
              <div class="pdf-editor-heading">
                <div>
                  <p class="pdf-eyebrow">
                    题目校对 · {{ questionIndex + 1 }} / {{ preview.draft.questions.length }}
                  </p>
                  <h3>第 {{ activeQuestion.source_number }} 题</h3>
                </div>
                <div class="pdf-pager">
                  <button
                    class="ui-control"
                    data-ui-variant="text"
                    type="button"
                    aria-label="上一题"
                    :disabled="busy || questionIndex <= 0"
                    @click="nextQuestion(-1)"
                  >
                    ←
                  </button>
                  <button
                    class="ui-control"
                    data-ui-variant="text"
                    type="button"
                    aria-label="下一题"
                    :disabled="busy || questionIndex >= preview.draft.questions.length - 1"
                    @click="nextQuestion(1)"
                  >
                    →
                  </button>
                </div>
              </div>
              <p v-if="!selected.includes(activeQuestion.key)" class="pdf-excluded-notice">
                此题未被选中，确认时不会录入。
              </p>
              <div class="pdf-field-grid">
                <label class="pdf-label"
                  >题型
                  <MetadataSelect
                    :model-value="activeQuestion.kind"
                    :label="'第' + activeQuestion.source_number + '题题型'"
                    :clearable="false"
                    :options="[
                      { value: 'choice', label: '选择题' },
                      { value: 'free_response', label: '非选择题' },
                    ]"
                    @update:model-value="
                      activeQuestion.kind = $event === 'choice' ? 'choice' : 'free_response'
                    "
                  />
                </label>
                <label class="pdf-label"
                  >关联公共材料
                  <MetadataSelect
                    :model-value="activeQuestion.group_key || ''"
                    :label="'第' + activeQuestion.source_number + '题公共材料'"
                    :clearable="false"
                    :options="[
                      { value: '', label: '独立题（保留已有材料）' },
                      ...preview.draft.groups.map((group) => ({
                        value: group.key,
                        label: group.title,
                      })),
                    ]"
                    @update:model-value="activeQuestion.group_key = $event || null"
                  />
                </label>
              </div>
              <button
                v-if="activeQuestion.group_key"
                type="button"
                class="ui-choice pdf-related-link"
                @click="showItem('group', activeQuestion.group_key)"
              >
                查看并校对关联材料 ↗
              </button>
              <label class="pdf-label"
                >题干
                <textarea
                  v-model="activeQuestion.stem"
                  rows="5"
                  class="ui-field pdf-field pdf-stem"
                />
              </label>
              <div v-if="activeQuestion.standalone_material_text" class="pdf-retained-material">
                <p class="pdf-eyebrow">保留的公共材料</p>
                <p class="whitespace-pre-wrap">{{ activeQuestion.standalone_material_text }}</p>
              </div>
              <div
                v-if="
                  images([...activeQuestion.asset_keys, ...activeQuestion.standalone_asset_keys])
                    .length
                "
                class="pdf-assets"
              >
                <p class="pdf-eyebrow">题目原图</p>
                <img
                  v-for="asset in images([
                    ...activeQuestion.asset_keys,
                    ...activeQuestion.standalone_asset_keys,
                  ])"
                  :key="asset.key"
                  :src="asset.url"
                  alt="本题原图"
                />
              </div>
              <div v-if="activeQuestion.kind === 'choice'" class="pdf-options">
                <h4>
                  选项
                  <span class="pdf-muted">{{
                    activeQuestion.option_mode === 'image' && !activeQuestion.options.length
                      ? '图形选项'
                      : activeQuestion.options.length + ' 项'
                  }}</span>
                </h4>
                <p
                  v-if="activeQuestion.option_mode === 'image' && !activeQuestion.options.length"
                  class="pdf-muted"
                  data-testid="pdf-image-options"
                >
                  图形选项保留在上方原图中，按图中字母作答，无需补填文字选项。
                </p>
                <p
                  v-for="message in pdfQuestionIssues(activeQuestion)"
                  :key="message"
                  class="pdf-nav-issue"
                >
                  {{ message }}
                </p>
                <div
                  v-for="(option, index) in activeQuestion.options"
                  :key="index"
                  class="pdf-option-row"
                >
                  <input
                    v-model="option.key"
                    maxlength="1"
                    aria-label="选项字母"
                    class="ui-field pdf-field pdf-option-key"
                  />
                  <input
                    v-model="option.text"
                    :aria-label="
                      '第' + activeQuestion.source_number + '题' + option.key + '选项内容'
                    "
                    class="ui-field pdf-field pdf-option-text"
                  />
                  <button
                    data-ui-variant="default"
                    type="button"
                    :aria-label="'移除' + option.key + '选项'"
                    class="ui-control pdf-remove-option"
                    @click="activeQuestion.options.splice(index, 1)"
                  >
                    ×
                  </button>
                </div>
                <button
                  data-ui-variant="default"
                  v-if="activeQuestion.options.length < 8 && activeQuestion.option_mode !== 'image'"
                  type="button"
                  class="ui-control pdf-text-button"
                  @click="addOption(activeQuestion)"
                >
                  ＋ 补充选项
                </button>
              </div>
              <div v-if="activeQuestion.warnings.length" class="pdf-warnings">
                <p class="font-medium">待核对</p>
                <p v-for="warning in activeQuestion.warnings" :key="warning">{{ warning }}</p>
              </div>
              <details class="pdf-answer-details">
                <summary>答案与作答 <span>选填，未识别的内容可以留空</span></summary>
                <label class="pdf-label"
                  >参考答案<input
                    v-model="activeQuestion.correct_answer"
                    class="ui-field pdf-field"
                /></label>
                <label class="pdf-label"
                  >解析<textarea
                    v-model="activeQuestion.explanation"
                    rows="3"
                    class="ui-field pdf-field"
                  />
                </label>
                <label class="pdf-label"
                  >原作答<textarea
                    v-model="activeQuestion.student_answer"
                    rows="3"
                    class="ui-field pdf-field"
                  />
                </label>
              </details>
            </fieldset>

            <fieldset
              v-else-if="activeGroup"
              :key="'group-' + activeGroup.key"
              :disabled="busy"
              class="pdf-group-form"
            >
              <div class="pdf-editor-heading">
                <div>
                  <p class="pdf-eyebrow">公共材料校对</p>
                  <h3>{{ activeGroup.title || '未命名材料' }}</h3>
                </div>
                <span class="pdf-muted"
                  >{{
                    preview.draft.questions.filter((q) => q.group_key === activeGroup.key).length
                  }}
                  道关联题目</span
                >
              </div>
              <label class="pdf-label"
                >材料标题<input v-model="activeGroup.title" class="ui-field pdf-field"
              /></label>
              <label class="pdf-label"
                >公共材料文字<textarea
                  v-model="activeGroup.material_text"
                  rows="10"
                  class="ui-field pdf-field"
                />
              </label>
              <div v-if="images(activeGroup.asset_keys).length" class="pdf-assets">
                <p class="pdf-eyebrow">材料原图</p>
                <img
                  v-for="asset in images(activeGroup.asset_keys)"
                  :key="asset.key"
                  :src="asset.url"
                  alt="公共材料原图"
                />
              </div>
              <div v-if="activeGroup.warnings.length" class="pdf-warnings">
                <p v-for="warning in activeGroup.warnings" :key="warning">{{ warning }}</p>
              </div>
              <div class="pdf-related-questions">
                <p class="pdf-eyebrow">关联题目</p>
                <button
                  v-for="question in preview.draft.questions.filter(
                    (q) => q.group_key === activeGroup.key,
                  )"
                  :key="question.key"
                  type="button"
                  class="ui-choice pdf-text-button"
                  @click="showItem('question', question.key)"
                >
                  第 {{ question.source_number }} 题 →
                </button>
              </div>
            </fieldset>
            <p v-else class="pdf-empty">暂无识别题目，请重新加载草稿。</p>

            <details v-if="preview.draft.notices.length" class="pdf-import-notices">
              <summary>导入说明</summary>
              <p v-for="notice in preview.draft.notices" :key="notice">{{ notice }}</p>
            </details>
          </div>
        </div>
      </section>

      <div v-else class="pdf-import-body pdf-upload-body">
        <div v-if="result?.status === 'completed'" role="status" class="pdf-success">
          <span aria-hidden="true">✓</span>
          <h3>题目已导入</h3>
          <p>已保存 {{ result.importedCount }} 道题目。</p>
          <p class="pdf-muted">关闭窗口后，即可在错题本中查看。</p>
        </div>
        <template v-else>
          <label class="pdf-upload-zone" :class="{ 'is-busy': busy || !!result }">
            <svg
              aria-hidden="true"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M12 17v-6m-3 3 3-3 3 3" />
            </svg>
            <span class="pdf-upload-title">{{ file ? file.name : '选择一份 PDF 试卷' }}</span>
            <span class="pdf-muted">{{
              file
                ? (file.size / 1024 / 1024).toFixed(1) + ' MB · 点击重新选择'
                : '支持图文试卷与扫描件'
            }}</span>
            <span class="pdf-file-button">{{ file ? '更换文件' : '选择 PDF 文件' }}</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              aria-label="选择 PDF 文件"
              :disabled="busy || !!result"
              @change="selectFile"
            />
          </label>
          <p class="pdf-upload-hint">单个文件不超过 100 MB · 最多 300 页</p>
          <p v-if="result?.status === 'submitted'" role="status" class="pdf-pending">
            {{ result.message || 'PDF 解析任务已提交，题目尚未保存。' }}
          </p>
          <p class="pdf-upload-note">识别完成后，先校对题目与材料，再确认录入。</p>
        </template>
      </div>

      <footer class="pdf-import-footer">
        <template v-if="preview">
          <label class="pdf-review-check"
            ><input v-model="reviewed" type="checkbox" :disabled="busy" /><span
              >我已对照原 PDF 核对所选题目、图片和公共材料关系；缺失答案保留为空。</span
            ></label
          >
          <div class="pdf-footer-actions">
            <p class="pdf-muted">
              已选 <strong>{{ selected.length }}</strong> / {{ preview.draft.questions.length }} 题
            </p>
            <div class="pdf-action-buttons">
              <button
                data-ui-variant="default"
                type="button"
                class="ui-control pdf-text-button pdf-reload-button"
                :disabled="busy"
                @click="reload"
              >
                重新加载草稿
              </button>
              <button
                data-ui-variant="default"
                data-dialog-cancel
                type="button"
                class="ui-control pdf-secondary"
                :disabled="confirming || cancelling"
                @click="close"
              >
                关闭
              </button>
              <button
                data-ui-variant="primary"
                type="button"
                data-testid="pdf-import-confirm"
                class="ui-control pdf-primary"
                :disabled="busy || !reviewed || !selected.length"
                @click="confirmSelection"
              >
                {{ confirming ? '正在录入…' : '确认录入 ' + selected.length + ' 道题目' }}
              </button>
            </div>
          </div>
        </template>
        <div v-else class="pdf-action-buttons pdf-upload-actions">
          <button
            data-ui-variant="text"
            data-dialog-cancel
            type="button"
            class="ui-control pdf-secondary"
            :disabled="confirming || cancelling"
            @click="close"
          >
            {{ cancelling ? '正在取消…' : result ? '关闭' : '取消' }}
          </button>
          <button
            data-ui-variant="primary"
            v-if="!result"
            type="button"
            class="ui-control pdf-primary"
            :disabled="!file || loading"
            @click="file && emit('submit', file)"
          >
            {{ loading ? '处理中…' : '提交 PDF' }}
          </button>
        </div>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.pdf-import-dialog {
  width: min(560px, calc(100vw - 32px));
  max-width: none;
  max-height: min(900px, calc(100dvh - 40px));
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--neo-line);
  border-radius: 18px;
  background: var(--neo-reading);
  color: var(--neo-ink);
  box-shadow: 0 24px 80px #0003;
}
.pdf-import-dialog::backdrop {
  background: #16140f66;
  backdrop-filter: blur(5px);
}
.pdf-import-dialog--preview {
  width: min(1080px, calc(100vw - 40px));
  height: min(860px, calc(100dvh - 40px));
}
.pdf-import-layout {
  display: flex;
  flex-direction: column;
  max-height: inherit;
  height: 100%;
  min-height: 0;
}
.pdf-import-header {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 24px 28px 18px;
}
.pdf-eyebrow {
  font-size: 11px;
  line-height: 1.6;
  color: var(--neo-muted);
  letter-spacing: 0.06em;
}
.pdf-import-header h2 {
  margin: 3px 0 7px;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.pdf-subtitle,
.pdf-muted {
  font-size: 12px;
  line-height: 1.7;
  color: var(--neo-muted);
}
.pdf-stage {
  flex-shrink: 0;
  margin-top: 4px;
  padding: 4px 9px;
  border: 1px solid var(--neo-line);
  border-radius: 6px;
  font-size: 11px;
  color: var(--neo-muted);
}
.pdf-steps {
  display: flex;
  flex-shrink: 0;
  gap: 26px;
  padding: 0 28px 18px;
  border-bottom: 1px solid var(--neo-line);
}
.pdf-steps li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--neo-muted);
}
.pdf-steps li > span {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--neo-line);
  border-radius: 50%;
  font-size: 10px;
}
.pdf-steps .is-current {
  color: var(--neo-ink);
  font-weight: 600;
}
.pdf-steps .is-current > span {
  background: var(--neo-ink);
  color: var(--neo-reading);
  border-color: var(--neo-ink);
}
.pdf-steps .is-complete > span {
  color: var(--neo-accent);
  border-color: var(--neo-accent);
}
.pdf-error,
.pdf-progress {
  flex-shrink: 0;
  margin: 12px 20px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.pdf-error {
  color: #b64638;
  background: #b646380d;
  border: 1px solid #b6463826;
}
.pdf-validation {
  max-height: 160px;
  overflow: auto;
}
.pdf-validation button {
  display: block;
  text-align: left;
  text-decoration: underline;
  margin-top: 4px;
}
.pdf-nav-issue {
  display: block;
  color: #b64638;
  font-size: 12px;
}
:global(.dark) .pdf-nav-issue {
  color: #f1a99c;
}
:global(.dark) .pdf-error {
  color: #f1a99c;
}
.pdf-progress {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--neo-surface);
  color: var(--neo-muted);
}
.pdf-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid var(--neo-line);
  border-top-color: var(--neo-accent);
  border-radius: 50%;
  animation: pdf-spin 1s linear infinite;
}
@keyframes pdf-spin {
  to {
    transform: rotate(360deg);
  }
}
.pdf-preview {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.pdf-preview-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--neo-line);
}
.pdf-filename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}
.pdf-source-link {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--neo-accent);
}
.pdf-import-body {
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.pdf-directory {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 10px;
  background: var(--neo-surface);
  border-right: 1px solid var(--neo-line);
}
.pdf-directory-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 10px;
}
.pdf-directory-heading h3,
.pdf-material-heading {
  font-size: 12px;
  font-weight: 600;
}
.pdf-directory-heading label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--neo-muted);
}
.pdf-nav-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
}
.pdf-nav-row > input {
  flex-shrink: 0;
  margin-top: 3px;
}
.pdf-nav-row.is-active {
  background: var(--neo-reading);
  border-color: var(--neo-line);
}
.pdf-nav-row.is-excluded .pdf-nav-title {
  color: var(--neo-muted);
}
.pdf-nav-row > button {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.pdf-nav-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
.pdf-nav-description {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
  font-size: 11px;
  color: var(--neo-muted);
}
.pdf-nav-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 6px;
  font-size: 10px;
  color: var(--neo-muted);
}
.pdf-warning-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b38a41;
}
.pdf-material-heading {
  display: flex;
  justify-content: space-between;
  margin: 20px 10px 8px;
  padding-top: 16px;
  border-top: 1px solid var(--neo-line);
}
.pdf-material-heading span {
  color: var(--neo-muted);
  font-weight: 400;
}
.pdf-material-nav {
  display: grid;
  gap: 3px;
}
.pdf-material-nav > button {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  font-size: 12px;
}
.pdf-material-nav > button[aria-current='true'] {
  background: var(--neo-reading);
  color: var(--neo-accent);
}
.pdf-editor {
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 28px;
}
.pdf-editor fieldset {
  display: grid;
  gap: 20px;
  min-width: 0;
  border: 0;
  padding: 0;
}
.pdf-editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.pdf-editor-heading h3 {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 600;
}
.pdf-pager {
  display: flex;
  gap: 6px;
}
.pdf-pager > button {
  width: 32px;
  height: 30px;
  border: 1px solid var(--neo-line);
}
.pdf-label {
  display: grid;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
}
.pdf-field-grid {
  display: grid;
  grid-template-columns: 1fr 1.45fr;
  gap: 16px;
}
.pdf-field {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
.pdf-options {
  display: grid;
  gap: 9px;
}
.pdf-options h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  font-size: 12px;
  font-weight: 500;
}
.pdf-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pdf-option-key {
  flex: 0 0 38px;
  width: 38px;
  text-align: center;
}
.pdf-option-text {
  flex: 1;
}
.pdf-remove-option {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  font-size: 18px;
  color: var(--neo-muted);
}
.pdf-related-link {
  justify-self: start;
  margin-top: -12px;
  text-align: left;
  color: var(--neo-accent);
  font-size: 12px;
}
.pdf-assets {
  display: grid;
  gap: 10px;
}
.pdf-assets img {
  display: block;
  max-height: 480px;
  max-width: 100%;
  border: 1px solid var(--neo-line);
  border-radius: 6px;
  background: white;
  object-fit: contain;
}
.pdf-warnings {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-left: 2px solid #b38a41;
  background: #b38a410a;
  color: #927132;
  font-size: 12px;
  line-height: 1.7;
}
:global(.dark) .pdf-warnings {
  color: #d7b56f;
}
.pdf-retained-material {
  padding: 14px;
  background: var(--neo-surface);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.8;
}
.pdf-answer-details {
  padding-top: 16px;
  border-top: 1px solid var(--neo-line);
  font-size: 12px;
}
.pdf-answer-details summary {
  cursor: pointer;
  font-weight: 500;
  line-height: 1.8;
}
.pdf-answer-details summary span {
  margin-left: 8px;
  font-weight: 400;
  color: var(--neo-muted);
  font-size: 11px;
}
.pdf-answer-details > label {
  margin-top: 16px;
}
.pdf-import-notices {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--neo-line);
  font-size: 11px;
  line-height: 1.8;
  color: var(--neo-muted);
}
.pdf-import-notices summary {
  cursor: pointer;
}
.pdf-import-notices p {
  margin-top: 8px;
}
.pdf-related-questions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.pdf-excluded-notice,
.pdf-empty {
  font-size: 12px;
  color: var(--neo-muted);
}
.pdf-import-footer {
  flex-shrink: 0;
  padding: 16px 24px;
  border-top: 1px solid var(--neo-line);
  background: var(--neo-reading);
}
.pdf-review-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 720px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--neo-muted);
}
.pdf-review-check input {
  flex-shrink: 0;
  margin-top: 3px;
}
.pdf-footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
}
.pdf-footer-actions strong {
  color: var(--neo-ink);
  font-weight: 600;
}
.pdf-action-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pdf-primary,
.pdf-secondary {
  padding: 9px 16px;
  border: 1px solid var(--neo-line);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.pdf-text-button {
  justify-self: start;
  text-align: left;
  font-size: 12px;
  color: var(--neo-muted);
}
.pdf-reload-button {
  margin-right: 8px;
  font-size: 11px;
}
.pdf-upload-body {
  display: block;
  overflow-y: auto;
  padding: 28px;
}
.pdf-upload-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px 20px;
  border: 1px dashed var(--neo-line);
  border-radius: 12px;
  text-align: center;
  cursor: pointer;
  background: var(--neo-surface);
}
.pdf-upload-zone > svg {
  color: var(--neo-muted);
}
.pdf-upload-zone:focus-within {
  outline: 2px solid var(--neo-accent);
  outline-offset: 3px;
}
.pdf-upload-zone.is-busy {
  opacity: 0.65;
  cursor: default;
}
.pdf-upload-title {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 15px;
  font-weight: 500;
}
.pdf-file-button {
  padding: 8px 14px;
  margin-top: 5px;
  border: 1px solid var(--neo-line);
  border-radius: 7px;
  background: var(--neo-reading);
  font-size: 12px;
}
.pdf-upload-zone input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.pdf-upload-hint,
.pdf-upload-note {
  margin-top: 14px;
  text-align: center;
  font-size: 11px;
  line-height: 1.8;
  color: var(--neo-muted);
}
.pdf-upload-note {
  margin-top: 22px;
}
.pdf-upload-actions {
  justify-content: flex-end;
}
.pdf-success {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
}
.pdf-success > span {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--neo-surface);
  color: var(--neo-accent);
  font-size: 22px;
}
.pdf-success h3 {
  font-size: 18px;
  font-weight: 600;
}
.pdf-pending {
  margin-top: 20px;
  color: var(--neo-muted);
  font-size: 12px;
  line-height: 1.8;
}

/* Keep this dense editing surface flat instead of stacking global inset shadows. */
#app .pdf-import-dialog button:not(:where(.ui-control, .ui-choice, .metadata-select-trigger)) {
  background: transparent !important;
  color: var(--neo-ink) !important;
  border: 0 !important;
  border-radius: 6px;
  box-shadow: none !important;
  transform: none;
}
#app .pdf-import-dialog button::after {
  display: none;
}
#app
  .pdf-import-dialog
  button:not(:where(.ui-control, .ui-choice, .metadata-select-trigger)):hover:not(:disabled) {
  background-color: var(--neo-surface) !important;
}
#app .pdf-import-dialog .pdf-material-nav > button[aria-current='true'] {
  background: var(--neo-reading) !important;
  color: var(--neo-accent) !important;
}
#app .pdf-import-dialog .pdf-text-button:not(.ui-control),
#app .pdf-import-dialog .pdf-remove-option:not(.ui-control) {
  color: var(--neo-muted) !important;
}
#app .pdf-import-dialog .pdf-related-link {
  color: var(--neo-accent) !important;
}
#app .pdf-import-dialog .pdf-secondary:not(.ui-control),
#app .pdf-import-dialog .pdf-pager > button:not(.ui-control) {
  border: 1px solid var(--neo-line) !important;
}
#app .pdf-import-dialog .pdf-secondary {
  background: transparent;
}
#app .pdf-import-dialog .pdf-import-body .pdf-editor .pdf-field {
  border: 1px solid var(--neo-line) !important;
  border-radius: 6px !important;
  background: var(--neo-reading) !important;
  color: var(--neo-ink) !important;
  padding: 9px 11px !important;
  line-height: 1.7;
  box-shadow: none !important;
  font-size: 13px;
  font-weight: 400;
  animation: none !important;
}
#app .pdf-import-dialog .pdf-import-body .pdf-editor .pdf-option-key {
  padding: 9px 4px !important;
}
#app .pdf-import-dialog .pdf-import-body .pdf-editor .pdf-field:focus {
  outline: 2px solid var(--neo-accent);
  outline-offset: 1px;
  box-shadow: none !important;
}
@media (max-width: 640px) {
  .pdf-import-dialog {
    max-height: calc(100dvh - 24px);
    border-radius: 14px;
  }
  .pdf-import-dialog--preview {
    width: calc(100vw - 16px);
    height: calc(100dvh - 24px);
  }
  .pdf-import-header {
    padding: 16px 16px 12px;
    gap: 8px;
  }
  .pdf-import-header h2 {
    font-size: 18px;
  }
  .pdf-subtitle {
    font-size: 11px;
  }
  .pdf-stage {
    font-size: 10px;
    padding: 3px 6px;
  }
  .pdf-steps {
    gap: 20px;
    padding: 0 16px 12px;
  }
  .pdf-steps li {
    font-size: 11px;
    gap: 5px;
  }
  .pdf-preview-bar {
    padding: 10px 16px;
    gap: 10px;
  }
  .pdf-preview-bar .pdf-muted {
    font-size: 10px;
  }
  .pdf-filename {
    max-width: 230px;
    font-size: 12px;
  }
  .pdf-source-link {
    font-size: 11px;
  }
  .pdf-import-body {
    display: flex;
    flex-direction: column;
  }
  .pdf-directory {
    flex-shrink: 0;
    overflow: visible;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--neo-line);
  }
  .pdf-directory-heading {
    padding: 0 2px 6px;
  }
  .pdf-question-nav,
  .pdf-material-nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    max-width: 100%;
  }
  .pdf-nav-row {
    flex-shrink: 0;
    padding: 7px 9px;
    gap: 6px;
  }
  .pdf-nav-title {
    font-size: 12px;
  }
  .pdf-nav-description,
  .pdf-nav-meta {
    display: none;
  }
  .pdf-nav-row > input {
    margin-top: 2px;
  }
  .pdf-material-heading {
    display: none;
  }
  .pdf-material-nav {
    margin-top: 5px;
  }
  .pdf-material-nav > button {
    flex-shrink: 0;
    width: auto;
    padding: 4px 8px;
    font-size: 11px;
    gap: 10px;
  }
  .pdf-material-nav > button > .pdf-muted {
    font-size: 10px;
  }
  .pdf-editor {
    flex: 1;
    min-height: 0;
    padding: 18px 16px;
  }
  .pdf-editor fieldset {
    gap: 18px;
  }
  .pdf-field-grid {
    gap: 10px;
  }
  .pdf-label {
    font-size: 11px;
  }
  .pdf-editor-heading h3 {
    font-size: 16px;
  }
  .pdf-pager > button {
    width: 30px;
    height: 28px;
  }
  .pdf-import-footer {
    padding: 12px 14px;
  }
  .pdf-review-check {
    font-size: 10px;
    line-height: 1.6;
  }
  .pdf-footer-actions {
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .pdf-action-buttons {
    gap: 8px;
  }
  .pdf-footer-actions > p {
    font-size: 10px;
  }
  .pdf-primary,
  .pdf-secondary {
    padding: 8px 10px;
    font-size: 11px;
  }
  .pdf-reload-button {
    margin-right: 0;
    font-size: 10px;
  }
  .pdf-footer-actions .pdf-action-buttons {
    flex-wrap: wrap;
    justify-content: flex-end;
    flex: 1;
  }
  .pdf-upload-body {
    padding: 20px 16px;
  }
  .pdf-upload-zone {
    padding: 24px 16px;
  }
  .pdf-answer-details summary span {
    display: block;
    margin-left: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pdf-spinner {
    animation: none;
  }
}
</style>
