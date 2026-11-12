<script setup lang="ts">
// @AI-NOTE: 设置面板组件 —— 设置读写通过 useReviewSettings/
// useDarkMode Hook。禁止直接操作 localStorage 或存储。
import { reactive, ref, watch } from 'vue'
import { useEditorPreferences } from '@/composables/useEditorPreferences'
import { useNotebooks } from '@/composables/useNotebooks'
import { useReviewSettings } from '@/composables/useReviewSettings'
import MetadataSelect from './MetadataSelect.vue'
import WebsiteLinks from './WebsiteLinks.vue'
import AccountPasswordForm from './AccountPasswordForm.vue'

defineProps<{
  isDark: boolean
  isElectron: boolean
  userEmail?: string
}>()

const emit = defineEmits<{
  close: []
  toggleDark: []
  changeDataDir: []
  logout: []
}>()

const { preferences } = useEditorPreferences()
const { notebooks } = useNotebooks()
const { settings, defaults } = useReviewSettings()

const draft = reactive({ ...settings.value })
const reviewExpanded = ref(false)
const shortcutsExpanded = ref(false)

const shortcuts = [
  { keys: ['Ctrl', 'N'], desc: '新建错题', mode: '全局' },
  { keys: ['Ctrl', 'S'], desc: '保存', mode: '全局' },
  { keys: ['Ctrl', 'R'], desc: '切换答案显示/隐藏', mode: '全局' },
  { keys: ['Ctrl', '←'], desc: '上一题', mode: '全局' },
  { keys: ['Ctrl', '→'], desc: '下一题', mode: '全局' },
  { keys: ['Ctrl', 'Z'], desc: '撤销绘图', mode: '画笔模式' },
  { keys: ['Ctrl', 'Y'], desc: '重做绘图', mode: '画笔模式' },
  { keys: ['W'], desc: '上一题', mode: '编辑模式' },
  { keys: ['S'], desc: '下一题', mode: '编辑模式' },
  { keys: ['Space'], desc: '显示答案', mode: '复习模式' },
  { keys: ['1'], desc: '评分：忘记了', mode: '复习模式' },
  { keys: ['2'], desc: '评分：不熟悉', mode: '复习模式' },
  { keys: ['3'], desc: '评分：已掌握', mode: '复习模式' },
]

// Reset draft when settings panel opens
watch(
  settings,
  (val) => {
    Object.assign(draft, val)
  },
  { immediate: true },
)

function save() {
  Object.assign(settings.value, { ...draft })
  emit('close')
}
</script>

<template>
  <!-- @AI-VIEW: DOM 可自由重构。样式仅限 Tailwind CSS 工具类。严禁内联 style 或自定义 CSS。 -->
  <div>
    <!-- Panel -->
    <div
      class="settings-page settings-drawer fixed right-0 top-0 bottom-0 z-50 w-[320px] bg-white dark:bg-[#141413] shadow-xl border-l border-gray-100 dark:border-[#2e2e2c] overflow-y-auto"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#2e2e2c]"
      >
        <h2
          class="text-[15px] font-bold text-gray-800 dark:text-brand-light flex items-center gap-2"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          设置
        </h2>
        <button
          data-ui-variant="text"
          type="button"
          aria-label="关闭"
          data-dialog-cancel
          class="ui-control p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c] text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray transition-all duration-200 ease-out active:scale-95"
          @click="emit('close')"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="p-5 space-y-5">
        <div class="settings-column">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="mb-4 text-base font-semibold">外观与编辑</h3>
              <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">
                深色模式
              </div>
              <div class="text-[11px] text-gray-400 dark:text-brand-mid mt-0.5">
                切换界面颜色主题
              </div>
            </div>
            <button
              role="switch"
              class="ui-switch relative w-10 h-5 rounded-full"
              :aria-checked="isDark"
              aria-label="切换深色模式"
              :class="isDark ? 'bg-accent' : 'bg-gray-300 dark:bg-[#2e2e2c]'"
              @click="emit('toggleDark')"
            >
              <span
                class="ui-switch-thumb absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
              />
            </button>
          </div>
          <div class="editor-preference-card">
            <h3 class="mb-4 text-base font-semibold">编辑偏好</h3>
            <div class="preference-row">
              <div>
                自动保存
                <p class="text-xs text-brand-mid">停止输入后自动保存；关闭后可用 Ctrl + S 保存</p>
              </div>
              <button
                role="switch"
                class="ui-switch relative w-10 h-5 rounded-full"
                :class="preferences.autoSave ? 'bg-accent' : 'bg-gray-300'"
                :aria-checked="preferences.autoSave"
                aria-label="自动保存"
                @click="preferences.autoSave = !preferences.autoSave"
              >
                <span class="ui-switch-thumb absolute top-0.5 left-0.5 w-4 h-4 rounded-full" />
              </button>
            </div>
            <div class="preference-row">
              <span>正文大小</span>
              <div class="w-28">
                <MetadataSelect
                  v-model="preferences.fontSize"
                  label="正文大小"
                  :options="
                    [12, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => ({
                      value: size,
                      label: `${size} px`,
                    }))
                  "
                  :clearable="false"
                />
              </div>
            </div>
            <div class="preference-row">
              <span>默认笔记本</span>
              <div class="min-w-0 max-w-[200px] flex-1">
                <MetadataSelect
                  v-model="preferences.defaultNotebookId"
                  label="默认笔记本"
                  :options="[
                    { value: '', label: '恢复上次打开的笔记本' },
                    ...notebooks.map((notebook) => ({ value: notebook.id, label: notebook.name })),
                  ]"
                  :clearable="false"
                />
              </div>
            </div>
            <p class="mt-3 text-xs text-brand-mid">
              设置即时保存，默认笔记本在下次进入应用时生效。
            </p>
          </div>
          <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
            <button
              data-ui-variant="text"
              type="button"
              class="ui-control w-full flex items-center justify-between text-[13px] font-medium text-gray-700 dark:text-brand-light-gray hover:text-accent transition-colors"
              data-testid="review-settings-toggle"
              @click="reviewExpanded = !reviewExpanded"
            >
              <span>复习设置</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="transition-transform duration-200"
                :class="reviewExpanded ? 'rotate-180' : ''"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-if="reviewExpanded" class="mt-3 space-y-3">
              <div class="text-[11px] text-gray-400 dark:text-brand-mid">
                基于艾宾浩斯遗忘曲线设置复习间隔：1天 → 3天 → 7天 → 放大……
              </div>

              <div>
                <label class="text-[12px] font-medium text-gray-600 dark:text-brand-light-gray"
                  >首次复习</label
                >
                <div class="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min="0"
                    max="365"
                    data-testid="first-review-days"
                    :value="draft.firstReviewDays"
                    @input="
                      (e: Event) => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        if (v >= 0) draft.firstReviewDays = v
                      }
                    "
                    class="ui-field w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                  />
                  <span class="text-[12px] text-gray-400 dark:text-brand-mid">天后复习</span>
                  <span class="text-[11px] text-accent/70 ml-auto"
                    >建议 {{ defaults.firstReviewDays }} 天</span
                  >
                </div>
              </div>

              <div>
                <label class="text-[12px] font-medium text-gray-600 dark:text-brand-light-gray"
                  >未掌握知识点</label
                >
                <div class="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    :value="draft.unmasteredDays"
                    @input="
                      (e: Event) => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        if (v > 0) draft.unmasteredDays = v
                      }
                    "
                    class="ui-field w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                  />
                  <span class="text-[12px] text-gray-400 dark:text-brand-mid">天后复习</span>
                  <span class="text-[11px] text-accent/70 ml-auto"
                    >建议 {{ defaults.unmasteredDays }} 天</span
                  >
                </div>
              </div>

              <div>
                <label class="text-[12px] font-medium text-gray-600 dark:text-brand-light-gray"
                  >已掌握知识点</label
                >
                <div class="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    :value="draft.masteredDays"
                    @input="
                      (e: Event) => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        if (v > 0) draft.masteredDays = v
                      }
                    "
                    class="ui-field w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                  />
                  <span class="text-[12px] text-gray-400 dark:text-brand-mid">天后复习</span>
                  <span class="text-[11px] text-accent/70 ml-auto"
                    >建议 {{ defaults.masteredDays }} 天</span
                  >
                </div>
              </div>

              <div>
                <label class="text-[12px] font-medium text-gray-600 dark:text-brand-light-gray"
                  >增长系数</label
                >
                <div class="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min="1.1"
                    max="5"
                    step="0.1"
                    :value="draft.growthFactor"
                    @input="
                      (e: Event) => {
                        const v = parseFloat((e.target as HTMLInputElement).value)
                        if (v >= 1.1) draft.growthFactor = v
                      }
                    "
                    class="ui-field w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                  />
                  <span class="text-[12px] text-gray-400 dark:text-brand-mid">倍</span>
                  <span class="text-[11px] text-accent/70 ml-auto"
                    >建议 {{ defaults.growthFactor }}x</span
                  >
                </div>
              </div>

              <div>
                <label class="text-[12px] font-medium text-gray-600 dark:text-brand-light-gray"
                  >最大间隔</label
                >
                <div class="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min="7"
                    max="730"
                    :value="draft.maxInterval"
                    @input="
                      (e: Event) => {
                        const v = parseInt((e.target as HTMLInputElement).value)
                        if (v > 0) draft.maxInterval = v
                      }
                    "
                    class="ui-field w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                  />
                  <span class="text-[12px] text-gray-400 dark:text-brand-mid">天</span>
                  <span class="text-[11px] text-accent/70 ml-auto"
                    >建议 {{ defaults.maxInterval }} 天</span
                  >
                </div>
              </div>

              <button
                data-ui-variant="primary"
                type="button"
                class="ui-control w-full mt-3 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:brightness-110 transition-all active:scale-[0.98]"
                data-testid="save-review-settings"
                @click="save"
              >
                保存复习设置
              </button>
            </div>
          </div>
          <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
            <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray mb-1.5">
              数据目录
            </div>
            <div class="text-[11px] text-gray-400 dark:text-brand-mid mb-3">
              更改错题数据的本地保存位置
            </div>
            <button
              data-ui-variant="default"
              type="button"
              class="ui-control w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-[13px] text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-[0.98]"
              :class="{ 'opacity-50 pointer-events-none': !isElectron }"
              :disabled="!isElectron"
              @click="emit('changeDataDir')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                />
              </svg>
              {{ isElectron ? '更改保存目录' : '仅桌面端可用' }}
            </button>
          </div>
          <div v-if="userEmail" class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
            <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray mb-1.5">
              账号
            </div>
            <div class="truncate text-[11px] text-gray-400 dark:text-brand-mid mb-3">
              {{ userEmail }}
            </div>
            <AccountPasswordForm @changed="emit('logout')" />
            <button
              data-ui-variant="danger-text"
              type="button"
              class="ui-control w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 dark:hover:bg-red-950/40"
              @click="emit('logout')"
            >
              退出登录
            </button>
          </div>
        </div>
        <div class="settings-column settings-shortcuts-column">
          <section
            v-if="!isElectron"
            class="mb-5 border-t border-gray-100 pt-4 dark:border-[#2e2e2c]"
            aria-labelledby="settings-help-heading"
          >
            <h3
              id="settings-help-heading"
              class="mb-3 text-[13px] font-medium text-gray-700 dark:text-brand-light-gray"
            >
              帮助与关于
            </h3>
            <WebsiteLinks />
          </section>
          <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
            <button
              data-ui-variant="text"
              type="button"
              class="ui-control w-full flex items-center justify-between text-[13px] font-medium text-gray-700 dark:text-brand-light-gray hover:text-accent transition-colors"
              @click="shortcutsExpanded = !shortcutsExpanded"
            >
              <span>快捷键</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="transition-transform duration-200"
                :class="shortcutsExpanded ? 'rotate-180' : ''"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-if="shortcutsExpanded" class="mt-3 space-y-1.5">
              <div
                v-for="sc in shortcuts"
                :key="sc.keys.join('+')"
                class="flex items-center justify-between py-1.5"
              >
                <span class="text-[12px] text-gray-600 dark:text-brand-light-gray">{{
                  sc.desc
                }}</span>
                <span class="flex items-center gap-1">
                  <span
                    v-for="k in sc.keys"
                    :key="k"
                    class="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono rounded border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-500 dark:text-brand-mid min-w-[22px] justify-center"
                    >{{ k }}</span
                  >
                  <span
                    class="text-[10px] text-gray-400 dark:text-brand-mid ml-1.5 w-14 text-right"
                    >{{ sc.mode }}</span
                  >
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
