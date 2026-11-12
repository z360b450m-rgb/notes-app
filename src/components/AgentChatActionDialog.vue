<script setup lang="ts">
import { vDialogSurface } from '@/directives/dialogSurface'
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useDialogBackdropClose } from '@/composables/useDialogBackdropClose'

const props = defineProps<{
  mode: 'rename' | 'delete'
  title: string
  busy: boolean
  error: string
}>()
const emit = defineEmits<{ close: []; confirm: [title: string] }>()
const dialog = ref<HTMLDialogElement>()
const nameInput = ref<HTMLInputElement>()
const name = ref(props.title)
const headingId = useId()
const descriptionId = useId()
const { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick } =
  useDialogBackdropClose(close)
function close() {
  if (!props.busy) emit('close')
}

onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  nameInput.value?.select()
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <Teleport to="#app">
    <dialog
      v-dialog-surface="'聊天管理'"
      ref="dialog"
      :aria-labelledby="headingId"
      :aria-describedby="mode === 'delete' ? descriptionId : undefined"
      class="agent-chat-action-dialog m-auto w-[min(380px,calc(100vw-32px))] rounded-2xl border border-[var(--neo-line)] bg-[var(--neo-surface)] p-5 text-[var(--neo-ink)] shadow-xl"
      @cancel.prevent="close"
      @pointerdown="onBackdropPointerDown"
      @pointercancel="onBackdropPointerCancel"
      @click="onBackdropClick"
    >
      <form @submit.prevent="emit('confirm', name.trim())">
        <h2 :id="headingId" class="mb-4 text-base font-semibold">
          {{ mode === 'rename' ? '重命名聊天' : '删除聊天' }}
        </h2>
        <template v-if="mode === 'rename'">
          <label class="block text-sm">
            聊天名称
            <input
              ref="nameInput"
              v-model="name"
              autofocus
              required
              :disabled="busy"
              maxlength="80"
              class="ui-field mt-2 w-full rounded-lg border border-[var(--neo-line)] bg-transparent px-3 py-2"
            />
          </label>
          <p class="mt-2 text-xs text-[var(--neo-muted)]">最多 80 个字</p>
        </template>
        <p v-else :id="descriptionId" class="break-words text-sm leading-6">
          确定删除“{{ title }}”及其全部聊天记录吗？删除后无法恢复。
        </p>
        <p v-if="error" role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">
          {{ error }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            data-ui-variant="default"
            data-dialog-cancel
            type="button"
            :autofocus="mode === 'delete'"
            :disabled="busy"
            class="ui-control rounded-lg px-4 py-2 text-sm"
            @click="close"
          >
            取消
          </button>
          <button
            :data-ui-variant="mode === 'delete' ? 'danger' : 'primary'"
            type="submit"
            :disabled="busy || (mode === 'rename' && !name.trim())"
            class="ui-control agent-chat-confirm rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            :class="mode === 'delete' ? 'is-delete' : ''"
          >
            {{
              busy
                ? mode === 'rename'
                  ? '正在保存…'
                  : '正在删除…'
                : mode === 'rename'
                  ? '保存'
                  : '确认删除'
            }}
          </button>
        </div>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.agent-chat-action-dialog::backdrop {
  background: rgb(0 0 0 / 40%);
}
</style>
