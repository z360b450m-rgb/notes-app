<script setup lang="ts">
// @AI-NOTE: 设置面板组件 —— 设置读写通过 useReviewSettings/
// useDarkMode Hook。禁止直接操作 localStorage 或存储。
import { reactive, ref, watch } from 'vue'
import { useReviewSettings } from '@/composables/useReviewSettings'
// import AiSkillsEditor from './AiSkillsEditor.vue'
// import KnowledgeBaseManager from './KnowledgeBaseManager.vue'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const aiSkillsExpanded = ref(false)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const kbExpanded = ref(false)

defineProps<{
  isDark: boolean
  isElectron: boolean
}>()

const emit = defineEmits<{
  close: []
  toggleDark: []
  changeDataDir: []
}>()

const { settings, defaults } = useReviewSettings()

const draft = reactive({ ...settings.value })
const reviewExpanded = ref(false)

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
    <!-- Backdrop -->
    <div class="fixed inset-0 z-40 bg-black/15" @click="emit('close')" />

    <!-- Panel -->
    <div
      class="fixed right-0 top-0 bottom-0 z-50 w-[320px] bg-white dark:bg-[#141413] shadow-xl border-l border-gray-100 dark:border-[#2e2e2c] overflow-y-auto"
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
          class="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c] text-gray-400 dark:text-brand-mid hover:text-gray-600 dark:text-brand-light-gray transition-all duration-200 ease-out active:scale-95"
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
        <!-- Dark mode -->
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">
              护眼模式
            </div>
            <div class="text-[11px] text-gray-400 dark:text-brand-mid mt-0.5">切换界面颜色主题</div>
          </div>
          <button
            class="relative w-10 h-5 rounded-full transition-colors duration-200"
            :class="isDark ? 'bg-accent' : 'bg-gray-300 dark:bg-[#2e2e2c]'"
            @click="emit('toggleDark')"
          >
            <span
              class="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
              :class="isDark ? 'left-[22px]' : 'left-0.5'"
            />
          </button>
        </div>

        <!-- Review settings -->
        <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
          <button
            class="w-full flex items-center justify-between text-[13px] font-medium text-gray-700 dark:text-brand-light-gray hover:text-accent transition-colors"
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
                  :value="draft.firstReviewDays"
                  @input="
                    (e: Event) => {
                      const v = parseInt((e.target as HTMLInputElement).value)
                      if (v >= 0) draft.firstReviewDays = v
                    }
                  "
                  class="w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
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
                  class="w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
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
                  class="w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
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
                  class="w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
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
                  class="w-16 px-2.5 py-1.5 text-[13px] rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light-gray focus:outline-none focus:border-accent/40 transition-colors"
                />
                <span class="text-[12px] text-gray-400 dark:text-brand-mid">天</span>
                <span class="text-[11px] text-accent/70 ml-auto"
                  >建议 {{ defaults.maxInterval }} 天</span
                >
              </div>
            </div>

            <button
              class="w-full mt-3 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:brightness-110 transition-all active:scale-[0.98]"
              @click="save"
            >
              保存复习设置
            </button>
          </div>
        </div>

        <!-- Data directory -->
        <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
          <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray mb-1.5">
            数据目录
          </div>
          <div class="text-[11px] text-gray-400 dark:text-brand-mid mb-3">
            更改错题数据的本地保存位置
          </div>
          <button
            class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-[13px] text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-[0.98]"
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

        <!-- 知识库（已关闭）
        <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
          <button
            class="w-full flex items-center justify-between text-left"
            @click="kbExpanded = !kbExpanded"
          >
            <div>
              <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">
                知识库
              </div>
              <div class="text-[11px] text-gray-400 dark:text-brand-mid mt-0.5">
                多个独立知识库 · 各自检索
              </div>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              :class="['transition-transform', kbExpanded ? 'rotate-180' : '']"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="kbExpanded" class="mt-3">
            <KnowledgeBaseManager />
          </div>
        </div>

        <div class="pt-4 border-t border-gray-100 dark:border-[#2e2e2c]">
          <button
            class="w-full flex items-center justify-between text-left"
            @click="aiSkillsExpanded = !aiSkillsExpanded"
          >
            <div>
              <div class="text-[13px] font-medium text-gray-700 dark:text-brand-light-gray">
                AI 指令库
              </div>
              <div class="text-[11px] text-gray-400 dark:text-brand-mid mt-0.5">
                调教 AI 回答风格 · 输入 / 触发
              </div>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              :class="['transition-transform', aiSkillsExpanded ? 'rotate-180' : '']"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="aiSkillsExpanded" class="mt-3">
            <AiSkillsEditor />
          </div>
        </div>
        -->
      </div>
    </div>
  </div>
</template>
