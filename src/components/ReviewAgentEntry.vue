<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useReviewAgentChats } from '@/composables/useReviewAgentChats'
import { useKnowledgeLibraries } from '@/composables/useKnowledgeLibraries'
import { renderLearningAnswer } from '@/utils/learningAnswer'
import { parseAgentEntryLink, type AgentEntryTarget } from '@/utils/agentEntryLinks'
import AgentChatHistoryItem from './AgentChatHistoryItem.vue'
import AgentChatActionDialog from './AgentChatActionDialog.vue'

defineProps<{ entryLinkError?: string; historyTarget: HTMLElement | null }>()
const emit = defineEmits<{ 'open-entry': [target: AgentEntryTarget] }>()

function openAnswerLink(event: MouseEvent) {
  if (!(event.target instanceof Element)) return
  const link = event.target.closest('a')
  const target = parseAgentEntryLink(link?.getAttribute('href') ?? '')
  if (!target) return
  event.preventDefault()
  emit('open-entry', target)
}

const { available, libraryMode, selectedLibraries, selectionInitialized } = useKnowledgeLibraries()
const attachedLibraries = computed(() =>
  available.value.filter((x) => selectedLibraries.value.includes(x.id)),
)

const {
  draft: prompt,
  messages,
  history,
  activeId,
  storageError,
  sending,
  deleting,
  append,
  retry,
  renameChat,
  deleteChat,
} = useReviewAgentChats()
const busy = computed(() => sending.value || deleting.value)
const thinkingClock = ref(Date.now())
watch(
  sending,
  (pending, _previous, onCleanup) => {
    if (!pending) return
    thinkingClock.value = Date.now()
    const timer = window.setInterval(() => {
      thinkingClock.value = Date.now()
    }, 1000)
    onCleanup(() => window.clearInterval(timer))
  },
  { immediate: true },
)
function thinkingLabel(message: { pending?: boolean; startedAt?: number; thinkingMs?: number }) {
  if (message.thinkingMs === undefined && (!message.pending || message.startedAt === undefined))
    return ''
  const elapsed = message.thinkingMs ?? Math.max(0, thinkingClock.value - message.startedAt!)
  const seconds = Math.max(1, Math.round(elapsed / 1000))
  const duration =
    seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return `${message.thinkingMs === undefined ? '思考中 ·' : '思考用时'} ${duration}`
}
const expandedChatId = ref<string | null>(null)
const chatAction = ref<{ id: string; title: string; mode: 'rename' | 'delete' } | null>(null)
const chatActionError = ref('')
function openChatAction(chat: { id: string; title: string }, mode: 'rename' | 'delete') {
  if (busy.value) return
  chatActionError.value = ''
  chatAction.value = { id: chat.id, title: chat.title, mode }
}
async function confirmChatAction(title: string) {
  const action = chatAction.value
  if (!action || busy.value) return
  chatActionError.value = ''
  if (action.mode === 'rename') {
    if (!renameChat(action.id, title)) return
  } else {
    const wasActive = activeId.value === action.id
    try {
      if (!(await deleteChat(action.id))) return
    } catch (cause) {
      chatActionError.value = cause instanceof Error ? cause.message : '聊天记录删除失败，请重试'
      return
    }
    if (wasActive) selectChat(null)
  }
  chatAction.value = null
  expandedChatId.value = null
}
if (!selectionInitialized.value) {
  selectedLibraries.value =
    messages.value
      .filter((m) => m.role === 'user')
      .at(-1)
      ?.knowledgeBases?.map((x) => x.id) ?? []
  selectionInitialized.value = true
}
function selectChat(id: string | null) {
  if (deleting.value) return
  expandedChatId.value = null
  activeId.value = id
  selectedLibraries.value =
    messages.value
      .filter((m) => m.role === 'user')
      .at(-1)
      ?.knowledgeBases?.map((x) => x.id) ?? []
  nextTick(() => conversation.value?.scrollTo({ top: conversation.value.scrollHeight }))
}
function chatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(timestamp)
}
const conversation = ref<HTMLElement | null>(null)
onMounted(() => {
  nextTick(() => conversation.value?.scrollTo({ top: conversation.value.scrollHeight }))
})
watch(
  () => messages.value.at(-1)?.text,
  () => {
    const log = conversation.value
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 80) {
      nextTick(() => log.scrollTo({ top: log.scrollHeight }))
    }
  },
)
const lightAngle = ref(0)
let glowAnimation: Animation | undefined
let edgeAnimation: Animation | undefined

function animateComposer(event: MouseEvent) {
  const composer = event.currentTarget as HTMLElement
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  lightAngle.value += 90
  glowAnimation?.cancel()
  edgeAnimation?.cancel()
  glowAnimation = composer.animate(
    [
      { boxShadow: '0 0 10px rgba(217,119,87,0.025), 0 0 6px rgba(177,145,207,0.015)' },
      {
        boxShadow: '0 0 30px rgba(217,119,87,0.12), 0 -4px 22px rgba(177,145,207,0.075)',
        offset: 0.35,
      },
      {
        boxShadow: '0 0 20px rgba(217,119,87,0.065), 0 -2px 14px rgba(177,145,207,0.035)',
        offset: 0.7,
      },
      { boxShadow: '0 0 16px rgba(217,119,87,0.045), 0 -2px 10px rgba(177,145,207,0.025)' },
    ],
    { duration: 1500, easing: 'ease-in-out' },
  )
  edgeAnimation = composer.animate(
    [
      { opacity: 0.14 },
      { opacity: 0.46, offset: 0.35 },
      { opacity: 0.3, offset: 0.7 },
      { opacity: 0.24 },
    ],
    { duration: 1500, easing: 'ease-in-out', pseudoElement: '::before' },
  )
}
const suggestions = [
  { label: '安排今天的复习', prompt: '帮我安排今天的复习，我有 20 分钟。' },
  { label: '攻克薄弱知识点', prompt: '我想集中练习薄弱知识点，一步一步带我复习。' },
  { label: '考前快速回顾', prompt: '帮我做一次考前快速回顾，先梳理重点。' },
]

async function send() {
  const text = prompt.value.trim()
  if (!text || busy.value) return
  const response = append(
    text,
    attachedLibraries.value.map((x) => ({ id: x.id, name: x.name })),
  )
  prompt.value = ''
  await nextTick()
  conversation.value?.scrollTo({ top: conversation.value.scrollHeight, behavior: 'smooth' })
  await response
  await nextTick()
  conversation.value?.scrollTo({ top: conversation.value.scrollHeight, behavior: 'smooth' })
}

function choose(text: string) {
  prompt.value = text
}

function executeChoice(text: string) {
  if (busy.value) return
  prompt.value = text
  void send()
}
</script>

<template>
  <section
    aria-label="复习 Agent"
    class="review-agent flex h-full min-h-0 w-full min-w-0 flex-col gap-4"
  >
    <Teleport v-if="historyTarget" :to="historyTarget">
      <aside aria-label="聊天记录" class="agent-history flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          type="button"
          class="ui-choice agent-history-button mb-2 inline-flex w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm"
          :disabled="deleting"
          @click="selectChat(null)"
        >
          <span aria-hidden="true">＋</span> 新对话
        </button>
        <div class="mb-2 px-3 text-xs font-medium text-brand-mid">聊天记录</div>
        <p v-if="!history.length" class="px-3 text-xs leading-6 text-brand-mid">
          发送第一条消息后，对话会保存在这里。
        </p>
        <div class="agent-history-list flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          <AgentChatHistoryItem
            v-for="chat in history"
            :key="chat.id"
            :title="chat.title"
            :detail="`${chatDate(chat.updatedAt)} · ${chat.messages.filter((m) => m.role === 'user').length} 条消息`"
            :active="activeId === chat.id"
            :expanded="expandedChatId === chat.id"
            :disabled="deleting"
            @select="selectChat(chat.id)"
            @expand="expandedChatId = $event ? chat.id : null"
            @rename="openChatAction(chat, 'rename')"
            @delete="openChatAction(chat, 'delete')"
          />
        </div>
        <p class="mt-4 hidden px-3 text-xs text-brand-mid md:block">记录保存在当前浏览器</p>
        <button
          type="button"
          class="ui-choice agent-history-button mt-2 inline-flex w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
          @click="libraryMode = 'manage'"
        >
          知识库管理 <span class="text-xs text-brand-mid">{{ available.length }}</span>
        </button>
      </aside>
    </Teleport>
    <div
      class="agent-chat-column flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3"
      :class="{ 'agent-new-chat': !messages.length }"
    >
      <p v-if="storageError" role="alert" class="mb-4 text-xs text-red-500">{{ storageError }}</p>
      <p v-if="entryLinkError" role="alert" class="text-sm text-red-700 dark:text-red-300">
        {{ entryLinkError }}
      </p>
      <div v-if="!messages.length" class="shrink-0 px-4 pb-5 text-center">
        <h2
          class="text-[28px] font-medium tracking-tight text-brand-dark dark:text-brand-light sm:text-[36px]"
        >
          今天，从哪里开始？
        </h2>
        <p class="mt-3 text-sm text-brand-mid">一起理清思路，把不会的变成会的。</p>
      </div>

      <div
        v-if="messages.length"
        ref="conversation"
        role="log"
        aria-label="复习目标对话"
        aria-live="polite"
        class="agent-conversation min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain rounded-2xl border border-black/10 p-3 sm:space-y-10 sm:p-5 dark:border-white/15"
      >
        <div
          v-for="(message, index) in messages"
          :key="index"
          class="mx-auto flex w-full"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="min-w-0 text-sm"
            :class="message.role === 'user' ? 'max-w-[85%]' : 'w-full md:w-3/4'"
          >
            <details
              v-if="message.role === 'assistant' && message.summaries?.length"
              :open="message.pending"
              class="agent-processing mb-3 rounded-lg border px-3 py-2 text-xs leading-6 text-brand-mid"
            >
              <summary class="cursor-pointer font-medium">
                {{ thinkingLabel(message) || '处理说明' }}
              </summary>
              <ul class="mt-1 space-y-1">
                <li v-for="(summary, summaryIndex) in message.summaries" :key="summaryIndex">
                  {{ summary }}
                </li>
              </ul>
            </details>
            <p
              v-else-if="message.role === 'assistant' && thinkingLabel(message)"
              class="mb-3 text-xs text-brand-mid"
            >
              {{ thinkingLabel(message) }}
            </p>
            <div
              class="agent-message min-w-0 max-w-full break-words rounded-2xl border px-4 py-3 text-sm leading-7 sm:px-5"
              :class="message.role === 'user' ? 'agent-message-user' : 'agent-message-assistant'"
            >
              <span class="mb-2 block text-xs font-semibold text-brand-mid">{{
                message.role === 'assistant' ? '复习助手' : '你'
              }}</span>
              <span v-if="message.pending && !message.text" role="status" class="text-brand-mid"
                >正在处理，请稍候……</span
              >
              <span v-else-if="message.role === 'user'" class="whitespace-pre-wrap">{{
                message.text
              }}</span>
              <div
                v-else
                class="learning-answer whitespace-normal"
                @click="openAnswerLink"
                v-html="renderLearningAnswer(message.text, message.pending)"
              />
              <p
                v-if="message.error"
                role="alert"
                class="mt-2 text-xs text-red-700 dark:text-red-300"
              >
                <span>{{ message.error }}</span
                ><span v-if="!storageError"> · 已保存回复快照</span>
              </p>
              <details
                v-if="message.previous"
                class="mt-3 rounded-lg border border-current/10 p-2 text-xs"
              >
                <summary class="cursor-pointer text-brand-mid">上次回复快照</summary>
                <div
                  class="learning-answer mt-2 leading-6"
                  v-html="renderLearningAnswer(message.previous.text)"
                />
                <p class="mt-2 text-brand-mid">{{ message.previous.error }}</p>
              </details>
              <button
                data-ui-variant="text"
                v-if="message.failed && index === messages.length - 1"
                type="button"
                class="ui-control ml-3 text-xs text-accent underline disabled:opacity-40"
                :disabled="sending"
                @click="retry"
              >
                重试
              </button>
              <div
                v-if="
                  message.role === 'assistant' &&
                  !message.pending &&
                  !message.failed &&
                  message.choices?.length &&
                  index === messages.length - 1
                "
                class="mt-4 flex flex-col items-start gap-2 whitespace-normal"
                aria-label="可执行回答"
              >
                <span class="text-xs text-brand-mid">点击回答，或输入序号继续</span>
                <button
                  v-for="(choice, choiceIndex) in message.choices"
                  :key="choice.id"
                  type="button"
                  class="ui-choice rounded-xl border border-accent/20 px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                  :disabled="sending"
                  @click="executeChoice(choice.text)"
                >
                  {{ choiceIndex + 1 }}. {{ choice.label }}
                </button>
              </div>
              <p
                v-if="message.knowledgeBases?.length"
                class="mt-3 border-t border-current/10 pt-2 text-xs text-brand-mid"
              >
                提问范围：{{ message.knowledgeBases.map((library) => library.name).join('、') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="attachedLibraries.length"
        aria-label="本次提问的参考知识库"
        class="agent-reference-scope flex max-h-24 shrink-0 flex-wrap items-center gap-2 overflow-y-auto px-1"
      >
        <span class="text-xs font-medium text-brand-mid">提问范围</span>
        <span
          v-for="library in attachedLibraries"
          :key="library.id"
          class="agent-library-chip inline-flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs"
        >
          <span class="min-w-0 truncate">{{ library.name }}</span>
          <button
            data-ui-variant="default"
            type="button"
            :aria-label="`移除知识库 ${library.name}`"
            :disabled="busy"
            class="ui-control agent-chip-remove shrink-0 rounded px-1"
            @click="selectedLibraries = selectedLibraries.filter((id) => id !== library.id)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      </div>
      <form
        class="agent-composer rounded-[22px] border border-black/10 bg-[#faf9f5] p-4 shadow-sm transition-colors focus-within:border-accent/40 dark:border-white/10 dark:bg-[#252320] sm:p-5"
        :style="{ '--agent-angle': `${lightAngle}deg` }"
        @click="animateComposer"
        @submit.prevent="send()"
      >
        <label for="review-agent-prompt" class="sr-only">你的复习目标</label>
        <textarea
          id="review-agent-prompt"
          v-model="prompt"
          rows="2"
          maxlength="2000"
          placeholder="告诉我你想复习什么……"
          class="ui-field w-full resize-none bg-transparent text-[15px] leading-7 text-brand-dark outline-none placeholder:text-brand-mid dark:text-brand-light-gray"
          @keydown.enter.exact.prevent="!$event.isComposing && send()"
        />
        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <button
              type="button"
              class="ui-choice agent-library-trigger agent-suggestion flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-sm"
              :disabled="busy"
              @click.stop="libraryMode = 'insert'"
            >
              ▤ 选择知识库
            </button>
            <span class="hidden text-xs text-brand-mid sm:inline" role="status">{{
              sending ? '正在回复…' : 'Enter 发送 · Shift+Enter 换行'
            }}</span>
          </div>
          <button
            data-ui-variant="primary"
            type="submit"
            :disabled="busy || !prompt.trim()"
            aria-label="发送复习目标"
            class="ui-control agent-send flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:cursor-not-allowed"
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
          </button>
        </div>
      </form>

      <div v-if="!messages.length" class="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <button
          v-for="suggestion in suggestions"
          :key="suggestion.label"
          type="button"
          class="ui-choice agent-suggestion flex items-center gap-1.5 px-2 py-2 text-sm text-brand-mid transition-colors hover:text-accent"
          @click="choose(suggestion.prompt)"
        >
          <span class="text-accent/70" aria-hidden="true">↗</span>{{ suggestion.label }}
        </button>
      </div>
    </div>
  </section>
  <AgentChatActionDialog
    v-if="chatAction"
    :mode="chatAction.mode"
    :title="chatAction.title"
    :busy="deleting"
    :error="chatActionError"
    @close="chatAction = null"
    @confirm="confirmChatAction"
  />
</template>

<style scoped>
.learning-answer :deep(p) {
  margin: 0.6em 0;
}
.learning-answer :deep(p:first-child) {
  margin-top: 0;
}
.learning-answer :deep(h1),
.learning-answer :deep(h2),
.learning-answer :deep(h3),
.learning-answer :deep(h4) {
  margin: 1em 0 0.5em;
  font-size: 1.05em;
  font-weight: 600;
}
.learning-answer :deep(ul),
.learning-answer :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.5em;
}
.learning-answer :deep(ul) {
  list-style: disc;
}
.learning-answer :deep(ol) {
  list-style: decimal;
}
.learning-answer :deep(li) {
  margin: 0.25em 0;
}
.learning-answer :deep(hr) {
  margin: 1.2em 0;
  opacity: 0.3;
}
.learning-answer :deep(.katex-display),
.learning-answer :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}
.learning-answer :deep(pre) {
  margin: 0.8em 0;
  padding: 0.75em;
  border-radius: 8px;
  background: rgb(128 128 128 / 8%);
  white-space: pre;
}
.learning-answer :deep(.formula-pending) {
  opacity: 0.6;
  font-size: 0.85em;
}
.learning-answer :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
.learning-answer :deep(th),
.learning-answer :deep(td) {
  padding: 0.4em 0.7em;
  border: 1px solid rgb(128 128 128 / 25%);
}
.review-agent .agent-history-button {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--neo-ink) !important;
}
.review-agent .agent-history-button::after {
  content: none !important;
}
.review-agent .agent-history-button:hover,
.review-agent .agent-history-button[aria-current='true'] {
  background: var(--neo-selected) !important;
  color: var(--neo-accent) !important;
}
@property --agent-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: true;
}
.agent-composer {
  position: relative;
  isolation: isolate;
  transition:
    box-shadow 450ms ease,
    border-color 450ms ease;
}
.agent-composer::before {
  content: '';
  position: absolute;
  inset: -2px;
  padding: 2px;
  border-radius: 24px;
  background: conic-gradient(
    from var(--agent-angle),
    transparent 0%,
    rgba(217, 119, 87, 0.12) 15%,
    #eda17d 25%,
    #d97757 32%,
    transparent 43%,
    transparent 55%,
    #cab0dc 68%,
    #edc6a2 77%,
    transparent 90%
  );
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
  opacity: 0.14;
  transition:
    --agent-angle 1500ms cubic-bezier(0.16, 0.65, 0.2, 1),
    opacity 400ms ease;
}
.agent-composer:focus-within::before {
  opacity: 0.24;
}
.agent-composer:focus-within {
  border-color: transparent;
  box-shadow:
    0 0 16px rgba(217, 119, 87, 0.045),
    0 -2px 10px rgba(177, 145, 207, 0.025);
}
@media (prefers-reduced-motion: reduce) {
  .agent-composer::before,
  .review-agent .agent-send:not(:disabled) {
    animation: none;
  }
}
/* Reuse the search field's inset surface and animated focus gradient.
   Keep the text away from its inset edges, and keep suggestions flat. */
.review-agent textarea {
  padding: 12px 14px;
  line-height: 1.9 !important;
  color: var(--neo-ink) !important;
  animation: none !important;
  border: 1px solid rgba(129, 112, 87, 0.23) !important;
  border-radius: 12px !important;
  background-color: rgba(211, 206, 195, 0.2) !important;
  box-shadow:
    inset 2px 3px 7px rgba(114, 101, 79, 0.14),
    inset -2px -2px 5px rgba(255, 253, 248, 0.8) !important;
}
.review-agent textarea:focus {
  border-color: transparent !important;
  background-color: var(--neo-surface) !important;
  outline: 1px solid rgba(255, 253, 248, 0.85);
  outline-offset: 2px;
  animation: agent-field-flow 1500ms ease-out forwards !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 253, 248, 0.8),
    var(--neo-inset),
    0 0 0 3px rgba(217, 119, 87, 0.06) !important;
}
:global(.dark) .review-agent textarea {
  border-color: rgba(180, 172, 158, 0.28) !important;
  background-color: rgba(0, 0, 0, 0.14) !important;
  box-shadow:
    inset 2px 3px 7px rgba(0, 0, 0, 0.3),
    inset -1px -1px 3px rgba(255, 255, 255, 0.045) !important;
}
:global(.dark) .review-agent textarea:focus {
  border-color: transparent !important;
  background-color: var(--neo-surface) !important;
  outline: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 211, 0.14),
    var(--neo-inset) !important;
}
@keyframes agent-field-flow {
  from {
    background-position: 0% 50%;
  }
  to {
    background-position: 25% 50%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .review-agent textarea:focus {
    animation: none !important;
  }
}
.review-agent textarea::placeholder {
  color: var(--neo-muted) !important;
  opacity: 1;
}
.review-agent .agent-suggestion {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  color: var(--neo-muted) !important;
  line-height: 1.75;
  filter: none !important;
}
.review-agent .agent-suggestion:hover {
  color: var(--neo-accent) !important;
}
.review-agent .agent-suggestion::after {
  content: none !important;
}
</style>
