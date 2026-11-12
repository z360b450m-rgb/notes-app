<script setup lang="ts">
import { computed, nextTick, ref, watch, useId } from 'vue'
import type { NoteEntry, ReviewLog } from '@/types'
import { useEntryReviewInsight } from '@/composables/useEntryReviewInsight'
import LearningTurn from './EntryLearningTurn.vue'
import EntryLearningHistoryDialog from './EntryLearningHistoryDialog.vue'
import type { ConfirmedReviewBundle } from '@/services/reviewBundles'

const props = defineProps<{
  entry: NoteEntry
  logs: ReviewLog[]
  isDirty?: boolean
  starting?: boolean
  startError?: string
}>()
const emit = defineEmits<{ 'start-review-bundle': [bundle: ConfirmedReviewBundle] }>()
const expanded = ref(false)
const panelId = useId()
const scrollPane = ref<HTMLDivElement>()
const composer = ref<HTMLTextAreaElement>()
const followReply = ref(true)
const historyOpen = ref(false)
const visibleTurnId = ref<string | null>(null)
const {
  insight,
  counts,
  status,
  recommendation,
  evidence,
  loading,
  error,
  loggedIn,
  canAsk,
  refresh,
  ask,
  turns,
  draft,
  contextChanged,
  storageError,
  clearChat,
  sendMessage,
  retryTurn,
  assistantError,
  sending,
  lastAction,
  bundle,
  confirming,
  confirmBundle,
  stop,
} = useEntryReviewInsight(
  () => props.entry,
  () => props.logs,
)
const currentTurn = computed(() => turns.value.find((turn) => turn.id === visibleTurnId.value))
const canRetry = computed(
  () => canAsk.value && !sending.value && !confirming.value && !props.starting && !props.isDirty,
)
const canClear = computed(
  () =>
    !confirming.value &&
    !props.starting &&
    !(sending.value && lastAction.value === 'arrange_review'),
)

async function confirmAndStart() {
  if (props.isDirty || props.starting) return
  const result = await confirmBundle()
  if (result) emit('start-review-bundle', result)
}

async function send() {
  const message = draft.value.trim()
  if (
    !message ||
    message.length > 2000 ||
    !canAsk.value ||
    sending.value ||
    confirming.value ||
    props.isDirty ||
    props.starting
  )
    return
  const entryId = props.entry.id
  draft.value = ''
  followReply.value = true
  const request = sendMessage(message)
  visibleTurnId.value = turns.value.at(-1)?.id ?? null
  await request
  if (props.entry.id === entryId) {
    await nextTick()
    composer.value?.focus({ preventScroll: true })
  }
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey) return
  event.preventDefault()
  void send()
}

function updateScroll() {
  const pane = scrollPane.value
  if (pane) followReply.value = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 64
}

function askWithScroll(action: 'arrange_review' | 'learn_knowledge') {
  followReply.value = true
  void ask(action)
  if (action === 'learn_knowledge') visibleTurnId.value = turns.value.at(-1)?.id ?? null
}

function retryWithScroll(turnId: string) {
  historyOpen.value = false
  visibleTurnId.value = turnId
  followReply.value = true
  void retryTurn(turnId)
}

async function clearCurrentChat() {
  clearChat()
  historyOpen.value = false
  visibleTurnId.value = null
  await nextTick()
  composer.value?.focus({ preventScroll: true })
}

async function continueConversation() {
  historyOpen.value = false
  visibleTurnId.value = turns.value.at(-1)?.id ?? null
  followReply.value = true
  await nextTick()
  composer.value?.focus({ preventScroll: true })
}

watch(
  () => [
    expanded.value,
    historyOpen.value,
    props.entry.notebookId,
    props.entry.id,
    turns.value.length,
    turns.value.at(-1)?.answer,
    turns.value.at(-1)?.error,
    sending.value,
    bundle.value,
    visibleTurnId.value,
  ],
  async () => {
    await nextTick()
    if (followReply.value && scrollPane.value)
      scrollPane.value.scrollTop = scrollPane.value.scrollHeight
  },
  { flush: 'post' },
)
watch(
  () => [props.entry.notebookId, props.entry.id],
  () => {
    expanded.value = false
    followReply.value = true
    historyOpen.value = false
    visibleTurnId.value = turns.value.at(-1)?.id ?? null
  },
  { immediate: true },
)
</script>

<template>
  <section
    data-testid="entry-review-insight"
    aria-label="复习建议"
    class="mx-1 min-w-0 shrink-0 overflow-hidden rounded-2xl border border-[var(--neo-line)] bg-[var(--neo-reading)] text-[var(--neo-ink)]"
  >
    <button
      data-ui-variant="default"
      type="button"
      data-testid="review-insight-toggle"
      class="ui-control flex w-full items-center justify-between gap-3 !rounded-none !border-0 !bg-transparent px-4 py-3 text-left !shadow-none sm:px-5"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="expanded = !expanded"
    >
      <span class="flex min-w-0 items-center gap-2 text-sm text-[var(--neo-muted)]">
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span data-testid="entry-learning-counts" class="whitespace-nowrap"
          >复习 {{ counts.reviewCount }} 次 · 答错 {{ counts.wrongCount }} 次</span
        >
      </span>
      <span class="flex shrink-0 items-center gap-3">
        <span
          data-testid="review-insight-status"
          class="rounded-md bg-[var(--neo-surface)] px-2.5 py-1 text-xs text-[var(--neo-muted)]"
          >{{ status }}</span
        >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="transition-transform"
          :class="{ 'rotate-180': !expanded }"
        >
          <polyline points="6 14 12 8 18 14" />
        </svg>
      </span>
    </button>

    <div
      v-show="expanded"
      :id="panelId"
      class="flex max-h-[56vh] flex-col border-t border-[var(--neo-line)]"
    >
      <div
        ref="scrollPane"
        class="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        @scroll="updateScroll"
      >
        <dl
          class="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm sm:grid-cols-[104px_minmax(0,1fr)]"
        >
          <dt class="text-[var(--neo-muted)]">复习建议</dt>
          <dd data-testid="review-insight-recommendation">{{ recommendation }}</dd>
          <dt class="text-[var(--neo-muted)]">教学重要性</dt>
          <dd>{{ insight?.importance.label ?? '尚未评估' }}</dd>
          <dt class="text-[var(--neo-muted)]">判断依据</dt>
          <dd
            data-testid="review-insight-evidence"
            class="text-xs leading-5 text-[var(--neo-muted)]"
          >
            {{ evidence }}
          </dd>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2.5">
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control inline-flex items-center gap-2 !rounded-lg !border-0 !bg-[#484c43] px-3.5 py-2.5 text-sm !text-white !shadow-none disabled:opacity-50"
            :disabled="!canAsk || sending || confirming || starting || isDirty"
            @click="askWithScroll('arrange_review')"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
              <path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" />
            </svg>
            让助手安排复习
          </button>
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control !rounded-lg !border !border-solid !border-[color:var(--neo-line)] !bg-transparent px-3.5 py-2.5 text-sm !shadow-none disabled:opacity-50"
            :disabled="!canAsk || sending || confirming || starting || isDirty"
            @click="askWithScroll('learn_knowledge')"
          >
            学习此题知识点
          </button>
        </div>
        <p v-if="isDirty" class="mt-2 text-xs text-[var(--neo-muted)]">
          请先保存题目，再使用学习助手或安排复习。
        </p>
        <p class="mt-3 text-xs leading-5 text-[var(--neo-muted)]">
          {{ insight?.review_hint ?? '复习安排提示：独立作答 → 核对关键步骤 → 复述方法。' }}
        </p>
        <p v-if="loading" role="status" class="mt-2 text-xs text-[var(--neo-muted)]">
          正在更新复习建议…
        </p>
        <p v-else-if="!loggedIn" class="mt-2 text-xs text-[var(--neo-muted)]">
          当前展示本地记录，登录后可使用复习助手。
        </p>
        <div
          v-else-if="error"
          role="alert"
          class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--neo-muted)]"
        >
          <span>当前展示本地记录。{{ error }}</span>
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control rounded px-2 py-1 text-accent underline"
            @click="refresh"
          >
            重试加载
          </button>
        </div>

        <section
          v-if="bundle || lastAction === 'arrange_review'"
          aria-label="关联复习题组"
          class="mt-4 rounded-xl border border-[var(--neo-line)] p-3 text-sm"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <h3 class="text-sm font-medium">关联复习题组</h3>
            <button
              data-ui-variant="text"
              data-dialog-cancel
              v-if="sending && lastAction === 'arrange_review'"
              type="button"
              class="ui-control rounded px-2 py-1 text-xs text-[var(--neo-muted)]"
              @click="stop"
            >
              停止生成
            </button>
          </div>
          <p
            v-if="sending && lastAction === 'arrange_review'"
            role="status"
            class="text-xs text-[var(--neo-muted)]"
          >
            助手正在处理，请稍候…
          </p>
          <div v-if="bundle" data-testid="review-bundle-preview">
            <p class="text-xs text-[var(--neo-muted)]">
              共 {{ bundle.items.length }} 题 · 预计
              {{ Math.ceil(bundle.estimated_seconds / 60) }} 分钟 · 来自当前错题本
            </p>
            <p class="mt-1 text-xs text-[var(--neo-muted)]">
              原题 + 至少 3 道召回题，再追加关联题，最多 10 道；题量不足时按实际数量安排。
            </p>
            <p
              v-if="bundle.retrieval?.channels.length"
              class="mt-1 text-xs text-[var(--neo-muted)]"
            >
              召回线索：{{
                bundle.retrieval.channels
                  .map(
                    (channel) =>
                      ({ stem: '题意相似', structure: '解题结构', graph: '知识与材料关联' })[
                        channel
                      ],
                  )
                  .join('、')
              }}。
            </p>
            <ol class="mt-3 space-y-3">
              <li
                v-for="(item, index) in bundle.items"
                :key="item.entry_id"
                class="rounded-lg border border-[var(--neo-line)] p-2.5"
              >
                <p class="font-medium">
                  {{ index + 1 }}. {{ item.title || item.question_preview || '未命名题目' }}
                </p>
                <p
                  v-if="item.question_preview && item.question_preview !== item.title"
                  class="mt-1 break-words text-xs text-[var(--neo-muted)]"
                >
                  {{ item.question_preview }}
                </p>
                <p class="mt-1 text-xs text-[var(--neo-muted)]">{{ item.relation.reason }}</p>
                <p class="mt-1 text-xs text-[var(--neo-muted)]">
                  复习 {{ item.review_count }} 次 · 答错 {{ item.wrong_count }} 次 · 预计
                  {{ Math.ceil(item.estimated_seconds / 60) }} 分钟
                </p>
                <details
                  v-if="item.relation.anchor_evidence.length"
                  class="mt-1 text-xs text-[var(--neo-muted)]"
                >
                  <summary class="cursor-pointer">关联依据（AI 建议）</summary>
                  <p>当前题：{{ item.relation.anchor_evidence.join('；') }}</p>
                  <p>关联题：{{ item.relation.candidate_evidence.join('；') }}</p>
                </details>
              </li>
            </ol>
            <p
              v-for="notice in bundle.notices"
              :key="notice"
              class="mt-2 text-xs text-[var(--neo-muted)]"
            >
              {{ notice }}
            </p>
            <button
              data-ui-variant="primary"
              type="button"
              data-testid="confirm-review-bundle"
              class="ui-control mt-3 rounded-lg bg-accent px-4 py-2.5 text-sm text-white disabled:opacity-50"
              :disabled="confirming || starting || isDirty || sending"
              @click="confirmAndStart"
            >
              {{ confirming || starting ? '正在进入复习…' : '确认并进入复习' }}
            </button>
          </div>
          <p v-if="startError" role="alert" class="mt-2 text-xs text-red-700 dark:text-red-300">
            {{ startError }}
          </p>
          <div
            v-if="assistantError && lastAction === 'arrange_review'"
            role="alert"
            class="mt-2 text-xs text-red-700 dark:text-red-300"
          >
            {{ assistantError }}
            <button
              data-ui-variant="default"
              type="button"
              class="ui-control ml-2 rounded px-2 py-1 underline"
              :disabled="sending || !canAsk"
              @click="ask('arrange_review')"
            >
              重试回复
            </button>
          </div>
        </section>
        <section v-if="currentTurn && !historyOpen" aria-label="当前题目学习对话" class="mt-4">
          <LearningTurn
            :turn="currentTurn"
            :latest="currentTurn.id === turns.at(-1)?.id"
            :can-retry="canRetry"
            @stop="stop"
            @retry="retryWithScroll"
          />
        </section>
        <p
          v-if="assistantError && !lastAction"
          role="alert"
          class="mt-2 text-xs text-red-700 dark:text-red-300"
        >
          {{ assistantError }}
        </p>
        <slot />
      </div>
      <form
        class="shrink-0 border-t border-[var(--neo-line)] bg-[var(--neo-reading)] px-4 py-3 sm:px-5"
        @submit.prevent="send"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <label :for="`${panelId}-message`" class="text-xs font-medium text-[var(--neo-muted)]"
            >AI 学习助手 · 当前题目</label
          >
          <div class="flex items-center gap-1">
            <button
              data-ui-variant="default"
              type="button"
              data-testid="entry-learning-history-button"
              class="ui-control rounded px-2 py-1 text-xs text-[var(--neo-muted)] disabled:opacity-50"
              :disabled="!turns.length"
              aria-haspopup="dialog"
              @click="historyOpen = true"
            >
              对话历史（{{ turns.length }}）
            </button>
            <button
              data-ui-variant="default"
              v-if="turns.length || draft"
              type="button"
              data-testid="entry-learning-clear"
              class="ui-control rounded px-2 py-1 text-xs text-[var(--neo-muted)] disabled:opacity-50"
              :disabled="!canClear"
              @click="clearCurrentChat"
            >
              清空对话
            </button>
          </div>
        </div>
        <p v-if="contextChanged" class="mb-2 text-xs text-[var(--neo-muted)]">
          题目已修改，后续回复依据保存后的内容；之前的对话仍保留。
        </p>
        <p v-if="storageError" role="alert" class="mb-2 text-xs text-[var(--neo-muted)]">
          {{ storageError }}
        </p>
        <div class="flex items-end gap-2">
          <textarea
            :id="`${panelId}-message`"
            ref="composer"
            v-model="draft"
            data-testid="entry-learning-input"
            aria-label="与当前题目助手对话"
            rows="2"
            maxlength="2000"
            placeholder="回复引导问题，或问问这道题怎么理解…"
            class="ui-field min-w-0 flex-1 resize-none rounded-lg border border-[var(--neo-line)] bg-[var(--neo-surface)] px-3 py-2 text-sm leading-5 outline-none focus:border-[var(--neo-muted)] disabled:opacity-50"
            :disabled="!canAsk || sending || confirming || starting || isDirty"
            @keydown.enter="handleEnter"
          />
          <button
            data-ui-variant="primary"
            type="submit"
            data-testid="entry-learning-send"
            class="ui-control shrink-0 rounded-lg bg-[#484c43] px-3.5 py-2.5 text-sm !text-white disabled:opacity-50"
            :disabled="!draft.trim() || !canAsk || sending || confirming || starting || isDirty"
          >
            发送
          </button>
        </div>
        <p class="mt-1.5 text-[11px] text-[var(--neo-muted)]">
          Enter 发送 · Shift + Enter 换行 · 学习对话不计入复习次数
        </p>
      </form>
    </div>
  </section>
  <EntryLearningHistoryDialog
    v-if="historyOpen"
    :title="entry.title"
    :turns="turns"
    :can-retry="canRetry"
    :can-clear="canClear"
    @close="historyOpen = false"
    @continue="continueConversation"
    @clear="clearCurrentChat"
    @stop="stop"
    @retry="retryWithScroll"
  />
</template>
