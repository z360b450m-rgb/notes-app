<script setup lang="ts">
import { ref } from 'vue'
import { changePassword } from '@/services/auth'

const emit = defineEmits<{ changed: [] }>()
const expanded = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (loading.value) return
  error.value = ''
  if (newPassword.value.length < 8 || newPassword.value.length > 128) {
    error.value = '新密码需要 8–128 位。'
    return
  }
  if (newPassword.value !== confirmation.value) {
    error.value = '两次输入的新密码不一致。'
    return
  }
  loading.value = true
  try {
    await changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = newPassword.value = confirmation.value = ''
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '修改密码失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mb-3 text-[13px]">
    <button
      data-ui-variant="default"
      type="button"
      class="ui-control w-full rounded-lg border border-gray-200 px-3 py-2 dark:border-[#2e2e2c]"
      :aria-expanded="expanded"
      :disabled="loading"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起修改密码' : '修改密码' }}
    </button>
    <form v-if="expanded" class="mt-3 space-y-3" @submit.prevent="submit">
      <label class="block" for="account-current-password">当前密码</label>
      <input
        id="account-current-password"
        v-model="currentPassword"
        class="ui-field w-full rounded-lg border p-2 dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
        type="password"
        autocomplete="current-password"
        maxlength="128"
        required
        :disabled="loading"
      />
      <label class="block" for="account-new-password">新密码</label>
      <input
        id="account-new-password"
        v-model="newPassword"
        class="ui-field w-full rounded-lg border p-2 dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
        type="password"
        autocomplete="new-password"
        minlength="8"
        maxlength="128"
        placeholder="8–128 位"
        required
        :disabled="loading"
      />
      <label class="block" for="account-confirm-password">确认新密码</label>
      <input
        id="account-confirm-password"
        v-model="confirmation"
        class="ui-field w-full rounded-lg border p-2 dark:border-[#2e2e2c] dark:bg-[#1e1e1c]"
        type="password"
        autocomplete="new-password"
        minlength="8"
        maxlength="128"
        required
        :disabled="loading"
      />
      <p class="text-[11px] text-gray-500 dark:text-brand-mid">
        修改成功后，所有设备都需要重新登录。
      </p>
      <p v-if="error" role="alert" class="text-red-600 dark:text-red-300">{{ error }}</p>
      <button
        data-ui-variant="primary"
        type="submit"
        class="ui-control w-full rounded-lg bg-accent px-3 py-2 disabled:opacity-50"
        :disabled="loading"
      >
        {{ loading ? '修改中…' : '确认修改并重新登录' }}
      </button>
    </form>
  </div>
</template>
