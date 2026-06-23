<script setup lang="ts">
// @AI-NOTE: RAG 问答侧栏 —— 调用本地 RAG-AIAgent 服务（默认 http://localhost:8000）。
// 仅 UI + HTTP 调用，无业务依赖。可在任意页面挂载。
import { ref, nextTick, watch, computed, onMounted } from 'vue'
import { useAiChat } from '../composables/useAiChat'
import { useAiSkills } from '../composables/useAiSkills'
import { useKnowledgeBases } from '../composables/useKnowledgeBases'
import type { NoteEntry } from '../types'

const props = withDefaults(
  defineProps<{
    baseUrl?: string
    title?: string
    entry?: NoteEntry | null
  }>(),
  {
    baseUrl: 'http://localhost:8000',
    title: 'AI 问答',
    entry: null,
  },
)

const { messages, loading, error, send, reset } = useAiChat()
const { enabledSkills, parseTrigger } = useAiSkills()
const { kbs, currentKbId, refresh: refreshKbs, select: selectKb } = useKnowledgeBases()
onMounted(refreshKbs)

const input = ref('')
const listRef = ref<HTMLDivElement | null>(null)

const scope = computed(() => (props.entry ? '当前错题' : '全库'))
const currentScope = computed<'entry' | 'global'>(() => (props.entry ? 'entry' : 'global'))

// 输入框实时检测 /xxx 触发预览
const triggerHit = computed(() => {
  const text = input.value.trim()
  if (!text.startsWith('/')) return null
  return parseTrigger(text, currentScope.value)
})

// 当前 scope 下可用的 skill 列表，展示给用户参考
const availableSkills = computed(() =>
  enabledSkills.value.filter((s) => s.scope === 'both' || s.scope === currentScope.value),
)

// 切换错题时清空对话，避免上下文串题
watch(
  () => props.entry?.id ?? null,
  () => {
    reset()
  },
)

async function onSend() {
  const text = input.value.trim()
  if (!text || loading.value) return
  input.value = ''

  // skill 触发解析
  const hit = parseTrigger(text, currentScope.value)
  const realQuestion = hit ? hit.question : text
  const skillPrompt = hit ? hit.skill.systemPrompt : null

  // entry 模式下把当前错题作为锁定上下文传给后端
  const entryPayload = props.entry
    ? {
        id: props.entry.id,
        question: props.entry.question ?? '',
        correctAnswer: props.entry.correctAnswer ?? '',
        wrongAnswer: props.entry.wrongAnswer ?? '',
        subject: props.entry.subject ?? '',
        tags: Array.isArray(props.entry.tags) ? props.entry.tags : [],
        title: props.entry.title ?? '',
        source: props.entry.source ?? '',
      }
    : null
  await send(realQuestion, entryPayload, skillPrompt, currentKbId.value)
}

function onKbPick(e: Event) {
  selectKb((e.target as HTMLSelectElement).value)
  reset()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSend()
  }
}

watch(
  () =>
    messages.value.length +
    (messages.value.length ? messages.value[messages.value.length - 1].content.length : 0),
  async () => {
    await nextTick()
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  },
)
</script>

<template>
  <aside
    class="w-[340px] flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#181816] h-full"
  >
    <!-- 头部 -->
    <div class="border-b border-gray-200 dark:border-[#2e2e2c]">
      <div class="flex items-center justify-between px-3 py-2">
        <div class="flex items-baseline gap-2 min-w-0">
          <span class="text-sm font-medium text-gray-800 dark:text-brand-light">{{ title }}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent flex-shrink-0">{{
            scope
          }}</span>
        </div>
        <button
          class="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28] transition-colors"
          :disabled="loading"
          @click="reset"
        >
          清空
        </button>
      </div>
      <!-- 全库模式才显示 KB 选择器 -->
      <div v-if="!entry" class="px-3 pb-2">
        <select
          :value="currentKbId"
          class="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] text-gray-700 dark:text-brand-light outline-none focus:border-accent"
          @change="onKbPick($event)"
        >
          <option v-for="k in kbs" :key="k.id" :value="k.id">📚 {{ k.name }}</option>
        </select>
      </div>
    </div>

    <!-- 消息列表 -->
    <div ref="listRef" class="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
      <div
        v-if="messages.length === 0"
        class="text-xs text-gray-400 dark:text-gray-500 text-center mt-8 leading-relaxed px-2"
      >
        <template v-if="entry">
          针对当前错题问答<br />
          可问：这题怎么做 / 为什么我错了 / 再出一道类似题
        </template>
        <template v-else>
          基于本地知识库回答<br />
          输入问题后回车发送
        </template>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        :class="m.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
      >
        <div
          :class="[
            'rounded-lg px-3 py-2 max-w-[88%] whitespace-pre-wrap break-words leading-relaxed',
            m.role === 'user'
              ? 'bg-accent/10 text-gray-800 dark:text-brand-light'
              : 'bg-gray-50 dark:bg-[#222220] text-gray-800 dark:text-brand-light border border-gray-200 dark:border-[#2e2e2c]',
          ]"
        >
          <!-- 节点进度（流式中） -->
          <div
            v-if="m.role === 'assistant' && m.streaming && m.nodes && m.nodes.length"
            class="text-[11px] text-gray-400 dark:text-gray-500 mb-1"
          >
            {{ m.nodes.join(' → ') }} …
          </div>

          <!-- 正文 -->
          <div v-if="m.content">{{ m.content }}</div>
          <div v-else-if="m.streaming" class="text-xs text-gray-400 dark:text-gray-500">
            思考中…
          </div>

          <!-- 置信度 + 来源 -->
          <div
            v-if="m.role === 'assistant' && !m.streaming && m.confidence !== undefined"
            class="mt-2 pt-2 border-t border-gray-200 dark:border-[#2e2e2c] text-[11px] text-gray-500 dark:text-gray-400 space-y-1"
          >
            <div>置信度：{{ (m.confidence * 100).toFixed(0) }}%</div>
            <details v-if="m.sources && m.sources.length" class="cursor-pointer">
              <summary class="hover:text-gray-700 dark:hover:text-brand-light">
                来源（{{ m.sources.length }}）
              </summary>
              <ol class="mt-1 space-y-1 pl-3 list-decimal">
                <li
                  v-for="(s, i) in m.sources"
                  :key="i"
                  class="text-gray-500 dark:text-gray-400 leading-snug"
                >
                  {{ s.length > 160 ? s.slice(0, 160) + '…' : s }}
                </li>
              </ol>
            </details>
          </div>
        </div>
      </div>

      <div
        v-if="error"
        class="text-xs text-red-500 dark:text-red-400 px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded"
      >
        {{ error }}
      </div>
    </div>

    <!-- 输入区 -->
    <div class="border-t border-gray-200 dark:border-[#2e2e2c] p-2">
      <!-- skill 触发命中提示 -->
      <div v-if="triggerHit" class="text-[11px] text-accent mb-1 px-1">
        ✓ 已应用「{{ triggerHit.skill.name }}」
        <span class="text-gray-400 dark:text-gray-500"
          >— {{ triggerHit.skill.description || triggerHit.skill.systemPrompt.slice(0, 30) }}</span
        >
      </div>

      <!-- 可用 skill 速查（折叠在 details 里，不占位） -->
      <details
        v-if="availableSkills.length && !triggerHit"
        class="text-[10px] text-gray-400 dark:text-gray-500 mb-1 px-1"
      >
        <summary class="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
          可用指令（{{ availableSkills.length }}）
        </summary>
        <div class="mt-1 space-y-0.5">
          <div
            v-for="s in availableSkills"
            :key="s.id"
            class="cursor-pointer hover:text-accent"
            @click="input = '/' + s.trigger + ' '"
          >
            <span class="font-mono">/{{ s.trigger }}</span>
            <span class="ml-1">{{ s.name }}</span>
          </div>
        </div>
      </details>

      <div class="flex items-end gap-2">
        <textarea
          v-model="input"
          rows="2"
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
          class="flex-1 resize-none rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] px-2.5 py-1.5 text-xs outline-none text-gray-800 dark:text-brand-light focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
          :disabled="loading"
          @keydown="onKeydown"
        ></textarea>
        <button
          class="px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-50 hover:bg-accent/90 transition-colors"
          :disabled="loading || !input.trim()"
          @click="onSend"
        >
          {{ loading ? '…' : '发送' }}
        </button>
      </div>
    </div>
  </aside>
</template>
