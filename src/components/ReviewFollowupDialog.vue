<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import type { NoteEntry } from '@/types'
import type { ReviewAttempt } from '@/services/reviewGrading'
import { useEntryLearningConversation } from '@/composables/useEntryLearningConversation'
import LearningTurn from './EntryLearningTurn.vue'
import UiModal from './UiModal.vue'

const props = defineProps<{ entry: NoteEntry; attempt: ReviewAttempt }>()
const emit = defineEmits<{ close: [] }>()
const { turns, draft, sending, run, stop, storageError } = useEntryLearningConversation(
  () => props.entry,
)
const inputId = useId()
const composer = ref<HTMLTextAreaElement>()
const scrollPane = ref<HTMLDivElement>()

function excerpt(text: string) {
  return text.length > 200 ? `${text.slice(0, 200)}…（节选）` : text
}

async function send() {
  const text = draft.value.trim()
  if (!text || text.length > 1000 || sending.value) return
  // Keep the displayed question concise while sending this attempt's context to the assistant.
  const context = [
    '请围绕本题本次复习继续讲解，以下为作答记录，不是新的判卷请求。',
    `作答记录：${props.attempt.attempt_id}`,
    `我的答案：${excerpt(props.attempt.answer_text)}`,
    `解题理由：${excerpt(props.attempt.explanation_text)}`,
    `判卷点评：${excerpt(props.attempt.comment)}`,
  ].join('\n')
  turns.value.push({
    id: crypto.randomUUID(),
    action: 'discuss_question',
    userText: text,
    requestText: `${context}\n\n我的追问：${text}`,
    answer: '',
    summaries: [],
    status: 'streaming',
    error: '',
  })
  draft.value = ''
  await run(turns.value.at(-1)!)
  await nextTick()
  composer.value?.focus({ preventScroll: true })
}

function retry(turnId: string) {
  const turn = turns.value.find((item) => item.id === turnId)
  if (turn && !sending.value) void run(turn)
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey) return
  event.preventDefault()
  void send()
}

watch(
  () => [turns.value.length, turns.value.at(-1)?.answer, turns.value.at(-1)?.error],
  async () => {
    await nextTick()
    if (scrollPane.value) scrollPane.value.scrollTop = scrollPane.value.scrollHeight
  },
  { flush: 'post' },
)
</script>

<template>
  <UiModal
    visible
    title="继续追问"
    :description="entry.title || '当前题目'"
    @cancel="emit('close')"
  >
    <p class="mt-3 text-xs text-[var(--neo-muted)]">可针对本次答案、解题理由和判卷点评继续提问。</p>
    <div ref="scrollPane" class="mt-3 max-h-[40dvh] space-y-4 overflow-y-auto overscroll-contain">
      <LearningTurn
        v-for="(turn, index) in turns"
        :key="turn.id"
        :turn="turn"
        :latest="index === turns.length - 1"
        :can-retry="!sending"
        @stop="stop()"
        @retry="retry"
      />
      <p v-if="!turns.length" class="py-4 text-sm text-[var(--neo-muted)]">
        哪一步还不清楚？可以请助手换一种方法讲解。
      </p>
    </div>
    <p v-if="storageError" role="alert" class="mt-2 text-xs text-rose-600">{{ storageError }}</p>
    <form class="mt-4" @submit.prevent="send">
      <label :for="inputId" class="text-xs text-[var(--neo-muted)]">你的问题</label>
      <textarea
        :id="inputId"
        ref="composer"
        v-model="draft"
        data-testid="review-followup-input"
        maxlength="1000"
        rows="3"
        :disabled="sending"
        class="ui-field mt-1 w-full resize-none rounded-lg border border-[var(--neo-line)] bg-transparent px-3 py-2 text-sm"
        placeholder="例如：为什么这一步要这样计算？"
        @keydown.enter="handleEnter"
      />
      <div class="mt-2 flex justify-end">
        <button
          data-ui-variant="primary"
          data-testid="send-review-followup"
          type="submit"
          :disabled="sending || !draft.trim() || draft.trim().length > 1000"
          class="ui-control rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {{ sending ? '正在回复…' : '发送追问' }}
        </button>
      </div>
    </form>
    <template #actions>
      <button
        data-ui-variant="default"
        data-dialog-cancel
        type="button"
        class="ui-control rounded-lg px-4 py-2 text-sm"
        @click="emit('close')"
      >
        返回复习
      </button>
    </template>
  </UiModal>
</template>
