<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { EntryLearningTurn } from '@/composables/useEntryLearningConversation'
import { useDialogBackdropClose } from '@/composables/useDialogBackdropClose'
import LearningTurn from './EntryLearningTurn.vue'

defineProps<{ title: string; turns: EntryLearningTurn[]; canRetry: boolean; canClear: boolean }>()
const emit = defineEmits<{
  close: []
  continue: []
  clear: []
  stop: []
  retry: [turnId: string]
}>()
const dialog = ref<HTMLDialogElement>()
const { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick } = useDialogBackdropClose(
  () => emit('close'),
)
const scrollPane = ref<HTMLDivElement>()
const headingId = useId()

onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  if (scrollPane.value) scrollPane.value.scrollTop = scrollPane.value.scrollHeight
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="#app">
    <dialog
      v-dialog-surface="'学习对话历史'"
      ref="dialog"
      :aria-labelledby="headingId"
      data-testid="entry-learning-history-dialog"
      class="entry-learning-history-dialog m-auto w-[min(760px,calc(100vw-24px))] max-h-[calc(100dvh-32px)] overflow-hidden rounded-2xl border border-[var(--neo-line)] bg-[var(--neo-reading)] p-0 text-[var(--neo-ink)] shadow-xl"
      @cancel.prevent="emit('close')"
      @pointerdown="onBackdropPointerDown"
      @pointercancel="onBackdropPointerCancel"
      @click="onBackdropClick"
    >
      <div class="flex max-h-[calc(100dvh-32px)] flex-col">
        <header
          class="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--neo-line)] px-4 py-4 sm:px-5"
        >
          <div class="min-w-0">
            <h2 :id="headingId" class="font-medium">当前题目对话历史</h2>
            <p class="mt-1 truncate text-xs text-[var(--neo-muted)]">
              {{ title || '当前题目' }} · {{ turns.length }} 轮对话
            </p>
          </div>
          <button
            data-ui-variant="default"
            data-dialog-cancel
            type="button"
            autofocus
            aria-label="关闭对话历史"
            class="ui-control shrink-0 rounded-lg px-3 py-1.5 text-sm text-[var(--neo-muted)]"
            @click="emit('close')"
          >
            关闭
          </button>
        </header>
        <div
          ref="scrollPane"
          class="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        >
          <LearningTurn
            v-for="(turn, index) in turns"
            :key="turn.id"
            :turn="turn"
            :latest="index === turns.length - 1"
            :can-retry="canRetry"
            history
            @stop="emit('stop')"
            @retry="emit('retry', $event)"
          />
          <p v-if="!turns.length" class="py-8 text-center text-sm text-[var(--neo-muted)]">
            还没有学习对话。
          </p>
        </div>
        <footer
          class="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--neo-line)] px-4 py-3 sm:px-5"
        >
          <button
            data-ui-variant="default"
            type="button"
            data-testid="entry-learning-history-clear"
            class="ui-control rounded px-2 py-2 text-xs text-[var(--neo-muted)] disabled:opacity-50"
            :disabled="!canClear || !turns.length"
            @click="emit('clear')"
          >
            清空当前题目对话
          </button>
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control rounded-lg bg-[#484c43] px-4 py-2.5 text-sm !text-white"
            @click="emit('continue')"
          >
            继续对话
          </button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.entry-learning-history-dialog::backdrop {
  background: rgb(0 0 0 / 40%);
}
</style>
