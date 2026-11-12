<script setup lang="ts">
import type { EntryLearningTurn } from '@/composables/useEntryLearningConversation'
import { renderLearningAnswer } from '@/utils/learningAnswer'

defineProps<{ turn: EntryLearningTurn; latest: boolean; canRetry: boolean; history?: boolean }>()
const emit = defineEmits<{ stop: []; retry: [turnId: string] }>()
</script>

<template>
  <article
    :data-testid="history ? 'entry-learning-history-turn' : 'entry-learning-turn'"
    class="space-y-2 text-sm"
  >
    <div class="ml-auto max-w-[92%] rounded-xl bg-[var(--neo-surface)] px-3 py-2.5">
      <p class="mb-1 text-xs text-[var(--neo-muted)]">你</p>
      <p data-testid="entry-learning-user-message" class="whitespace-pre-wrap break-words">
        {{ turn.userText }}
      </p>
    </div>
    <div class="rounded-xl border border-[var(--neo-line)] p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="text-xs font-medium text-[var(--neo-muted)]">AI 学习助手</p>
        <button
          data-ui-variant="text"
          v-if="turn.status === 'streaming'"
          type="button"
          class="ui-control rounded px-2 py-1 text-xs text-[var(--neo-muted)]"
          @click="emit('stop')"
        >
          停止生成
        </button>
      </div>
      <details
        v-if="turn.summaries.length"
        class="mb-2 text-xs leading-5 text-[var(--neo-muted)]"
        :open="turn.status === 'streaming'"
      >
        <summary class="cursor-pointer">处理说明</summary>
        <p v-for="(summary, index) in turn.summaries" :key="index">{{ summary }}</p>
      </details>
      <p
        v-if="turn.status === 'streaming' && !turn.answer"
        role="status"
        class="text-xs text-[var(--neo-muted)]"
      >
        助手正在思考…
      </p>
      <div
        v-if="turn.answer"
        :data-testid="history ? 'entry-learning-history-answer' : 'entry-review-assistant-answer'"
        class="learning-answer break-words text-sm leading-6"
        v-html="renderLearningAnswer(turn.answer, turn.status === 'streaming')"
      />
      <div v-if="turn.error" role="alert" class="mt-2 text-xs text-red-700 dark:text-red-300">
        {{ turn.error }}
        <button
          data-ui-variant="text"
          v-if="latest"
          type="button"
          class="ui-control ml-2 rounded px-2 py-1 underline"
          :disabled="!canRetry"
          @click="emit('retry', turn.id)"
        >
          重试回复
        </button>
      </div>
      <details
        v-if="turn.previous"
        class="mt-3 rounded-lg border border-[var(--neo-line)] p-2 text-xs"
      >
        <summary class="cursor-pointer text-[var(--neo-muted)]">上次回复快照</summary>
        <div
          class="learning-answer mt-2 break-words leading-6"
          v-html="renderLearningAnswer(turn.previous.answer)"
        />
        <p class="mt-2 text-[var(--neo-muted)]">{{ turn.previous.error }}</p>
      </details>
    </div>
  </article>
</template>
