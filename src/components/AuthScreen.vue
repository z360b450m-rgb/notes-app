<script setup lang="ts">
import SegmentedControl from './SegmentedControl.vue'
import { computed, onUnmounted, reactive, ref } from 'vue'
import { login, resetPassword, sendEmailCode, signup, type AuthUser } from '@/services/auth'
import AmbientBackdrop from './AmbientBackdrop.vue'

const emit = defineEmits<{ authenticated: [user: AuthUser] }>()
const isDesktop = !!window.electronAPI || window.location.protocol === 'file:'
const mode = ref<'login' | 'signup' | 'reset'>('login')
const fullName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const code = ref('')
const notice = ref('')
const sendingCode = ref(false)
const now = ref(Date.now())
const deadlines = reactive<Record<string, number>>({})
const codePurpose = computed(() => (mode.value === 'signup' ? 'signup' : 'reset_password'))
const cooldownKey = computed(() => `${codePurpose.value}:${email.value.trim().toLowerCase()}`)
const cooldown = computed(() =>
  Math.max(0, Math.ceil(((deadlines[cooldownKey.value] || 0) - now.value) / 1000)),
)
const clock = setInterval(() => {
  now.value = Date.now()
}, 1000)
onUnmounted(() => clearInterval(clock))
const title = computed(
  () => ({ login: '欢迎回来', signup: '创建你的账号', reset: '重置密码' })[mode.value],
)

function switchMode(next: 'login' | 'signup' | 'reset') {
  if (loading.value || sendingCode.value) return
  mode.value = next
  error.value = ''
  notice.value = ''
  password.value = ''
  confirmPassword.value = ''
  code.value = ''
}

async function requestCode() {
  if (sendingCode.value || cooldown.value > 0) return
  error.value = ''
  notice.value = ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    error.value = '请先填写有效的邮箱地址。'
    return
  }
  sendingCode.value = true
  const key = cooldownKey.value
  try {
    const response = await sendEmailCode(email.value, codePurpose.value)
    now.value = Date.now()
    deadlines[key] = now.value + response.retry_after * 1000
    notice.value = `${response.message}。验证码 10 分钟内有效。`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '验证码发送失败，请稍后重试。'
  } finally {
    sendingCode.value = false
  }
}
async function submit() {
  if (loading.value || sendingCode.value) return
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = '请填写邮箱和密码。'
    return
  }
  if (mode.value !== 'login' && (password.value.length < 8 || password.value.length > 128)) {
    error.value = '密码需要 8–128 位。'
    return
  }
  if (mode.value !== 'login' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致。'
    return
  }
  if (mode.value !== 'login' && !/^[0-9]{6}$/.test(code.value)) {
    error.value = '请输入 6 位邮箱验证码。'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'reset') {
      await resetPassword(email.value, code.value, password.value)
      mode.value = 'login'
      password.value = ''
      confirmPassword.value = ''
      code.value = ''
      notice.value = '密码已重置，请使用新密码登录。'
      return
    }
    const user =
      mode.value === 'login'
        ? await login(email.value, password.value)
        : await signup(email.value, password.value, fullName.value, code.value)
    emit('authenticated', user)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-atmosphere" aria-hidden="true">
      <AmbientBackdrop softened />
    </div>
    <div class="auth-shell">
      <a v-if="!isDesktop" class="auth-back-link" href="/">← 返回官网</a>
      <section class="auth-card auth-card-frosted rounded-[20px]" aria-label="账户登录与注册">
        <div class="auth-intro">
          <h1>让错题<br />成为进步的起点。</h1>
          <p>记录、整理、复习。<br />用适合自己的节奏，积累每一次收获。</p>
        </div>
        <form class="auth-form" @submit.prevent="submit">
          <SegmentedControl
            label="账户操作"
            :model-value="mode"
            :options="[
              { value: 'login', label: '登录' },
              { value: 'signup', label: '注册' },
            ]"
            :disabled="loading || sendingCode"
            @update:model-value="switchMode($event === 'signup' ? 'signup' : 'login')"
          />
          <h2>{{ title }}</h2>
          <label v-if="mode === 'signup'" for="auth-name">昵称 <span>（可选）</span></label>
          <input
            class="ui-field"
            v-if="mode === 'signup'"
            id="auth-name"
            v-model="fullName"
            autocomplete="name"
            placeholder="怎么称呼你"
          />
          <label for="auth-email">邮箱</label>
          <input
            class="ui-field"
            id="auth-email"
            v-model="email"
            :disabled="loading || sendingCode"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            required
          />
          <template v-if="mode !== 'login'">
            <label for="auth-code">邮箱验证码</label>
            <div class="auth-code-row">
              <input
                class="ui-field"
                id="auth-code"
                v-model="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxlength="6"
                placeholder="6 位验证码"
                required
              />
              <button
                class="ui-control"
                data-ui-variant="default"
                type="button"
                :disabled="loading || sendingCode || cooldown > 0"
                @click="requestCode"
              >
                {{ sendingCode ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后重发` : '发送验证码' }}
              </button>
            </div>
          </template>
          <label for="auth-password">{{ mode === 'reset' ? '新密码' : '密码' }}</label>
          <input
            class="ui-field"
            id="auth-password"
            v-model="password"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            :minlength="mode !== 'login' ? 8 : undefined"
            maxlength="128"
            placeholder="至少 8 位"
            required
          />
          <label v-if="mode !== 'login'" for="auth-confirm">确认密码</label>
          <input
            class="ui-field"
            v-if="mode !== 'login'"
            id="auth-confirm"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="再输入一次密码"
            required
          />
          <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
          <p v-if="notice" class="auth-notice" role="status">{{ notice }}</p>
          <button
            data-ui-variant="primary"
            type="submit"
            :disabled="loading || sendingCode"
            class="ui-control auth-submit bg-accent"
          >
            {{
              loading
                ? '请稍候…'
                : mode === 'login'
                  ? '登录'
                  : mode === 'signup'
                    ? '注册'
                    : '重置密码'
            }}
          </button>
          <button
            v-if="mode === 'login' || mode === 'reset'"
            type="button"
            class="ui-choice auth-forgot"
            :class="{ 'auth-forgot-link': mode === 'login' }"
            :disabled="loading || sendingCode"
            @click="switchMode(mode === 'login' ? 'reset' : 'login')"
          >
            {{ mode === 'login' ? '忘记密码？' : '返回登录' }}
          </button>
        </form>
      </section>
      <nav v-if="!isDesktop" aria-label="帮助与下载" class="auth-help-links">
        <a href="/docs/" target="_blank" rel="noopener">使用文档 ↗</a>
        <a href="/download/" target="_blank" rel="noopener">下载桌面版 ↗</a>
      </nav>
    </div>
  </main>
</template>

<style scoped>
.auth-page {
  --ambient-paper: var(--neo-surface);
  position: relative;
  isolation: isolate;
  height: 100svh;
  overflow-y: auto;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 76px 32px;
  background: var(--neo-surface);
  color: var(--neo-ink);
  font:
    14px/1.65 'Microsoft YaHei',
    system-ui,
    sans-serif;
}
.auth-atmosphere {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.auth-shell {
  display: grid;
  width: 100%;
  max-width: 820px;
  gap: 24px;
  margin-block: auto;
}
.auth-back-link,
.auth-help-links {
  color: var(--neo-muted);
  font-size: 12px;
}
.auth-back-link {
  justify-self: start;
}
.auth-help-links {
  display: flex;
  width: calc((100% - 83px) / 2);
  margin-left: 24px;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px 24px;
}
.auth-back-link:hover,
.auth-help-links a:hover {
  color: var(--neo-accent);
}
.auth-back-link:focus-visible,
.auth-help-links a:focus-visible {
  outline: 2px solid var(--neo-accent);
  outline-offset: 5px;
  border-radius: 2px;
}
:global(.dark .auth-page .auth-atmosphere) {
  opacity: 0.45;
}
:global(#app .auth-page .auth-card.auth-card-frosted) {
  background: var(--neo-surface);
  background: color-mix(in srgb, var(--neo-surface) 64%, transparent);
  border: 1px solid color-mix(in srgb, var(--neo-light) 62%, transparent);
  box-shadow: 0 14px 50px rgba(114, 101, 79, 0.12);
  -webkit-backdrop-filter: blur(22px);
  backdrop-filter: blur(22px);
}
.auth-card {
  width: 100%;
  max-width: 820px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 35px;
  padding: 24px;
}
.auth-intro {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
}
.auth-intro h1 {
  margin: 0;
  font-size: 27px;
  font-weight: 700;
  line-height: 1.65;
}
.auth-intro p {
  margin: 0;
  color: var(--neo-muted);
}
.auth-form {
  min-width: 0;
}
.auth-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.auth-tabs button {
  padding: 10px 16px;
  font-size: 14px;
}
.auth-form h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.65;
}
.auth-form label {
  display: block;
  margin: 16px 0 8px;
}
.auth-form label span {
  color: var(--neo-muted);
}
.auth-form input {
  width: 100%;
  padding: 12px;
  font: inherit;
}
.auth-submit {
  width: 100%;
  margin-top: 20px;
  padding: 10px 16px;
  font: inherit;
}
.auth-error {
  margin: 14px 0 0;
  color: #c44747;
  font-size: 13px;
}
.auth-code-row {
  display: flex;
  gap: 10px;
}
.auth-code-row input {
  min-width: 0;
  flex: 1;
}
.auth-code-row button {
  flex-shrink: 0;
  padding: 8px 12px;
  font: inherit;
}
.auth-notice {
  margin: 14px 0 0;
  color: var(--neo-muted);
  font-size: 13px;
}
.auth-forgot {
  display: block;
  margin: 14px auto 0;
  font: inherit;
  color: var(--neo-muted);
}
:global(#app .auth-page .auth-card .auth-form button.auth-forgot.auth-forgot-link) {
  padding: 0;
  border: 0 !important;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
  font: inherit;
  color: #c44747 !important;
  text-decoration: underline;
  text-underline-offset: 3px;
  transform: none !important;
  filter: none;
}
:global(#app .auth-page .auth-card .auth-form button.auth-forgot.auth-forgot-link::after) {
  content: none;
}
.auth-form button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 700px) {
  .auth-page {
    padding: 56px 20px;
  }
  .auth-shell {
    gap: 20px;
  }
  .auth-help-links {
    width: 100%;
    margin-left: 0;
  }
  .auth-card {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 18px;
  }
}
</style>
