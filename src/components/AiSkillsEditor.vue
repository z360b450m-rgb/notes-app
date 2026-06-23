<script setup lang="ts">
// AI 指令库编辑器：用户自己写 system prompt 调教 AI 行为
import { ref, computed } from 'vue'
import { useAiSkills } from '../composables/useAiSkills'
import type { AiSkill } from '../types'

const { skills, create, update, remove, resetToDefaults, exportJson, importJson } = useAiSkills()

const editingId = ref<string | null>(null)
const importText = ref('')
const showImport = ref(false)

const editing = computed<AiSkill | null>(() =>
  editingId.value ? (skills.value.find((s) => s.id === editingId.value) ?? null) : null,
)

function startEdit(id: string) {
  editingId.value = id
}

function startCreate() {
  const s = create()
  editingId.value = s.id
}

function commitField<K extends keyof AiSkill>(key: K, value: AiSkill[K]) {
  if (!editing.value) return
  update(editing.value.id, { [key]: value } as Partial<AiSkill>)
}

function doExport() {
  const blob = new Blob([exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ai-skills-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function confirmAsk(msg: string): boolean {
  return window.confirm(msg)
}

function doImport() {
  if (!importText.value.trim()) return
  const ok = importJson(importText.value)
  if (ok) {
    importText.value = ''
    showImport.value = false
  } else {
    alert('导入失败：JSON 格式不正确')
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- 列表 -->
    <div class="space-y-2">
      <div
        v-for="s in skills"
        :key="s.id"
        class="rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] overflow-hidden"
      >
        <!-- 折叠行 -->
        <div class="flex items-center gap-2 px-3 py-2">
          <input
            type="checkbox"
            class="cursor-pointer"
            :checked="s.enabled"
            @change="update(s.id, { enabled: ($event.target as HTMLInputElement).checked })"
          />
          <span
            class="text-[11px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent flex-shrink-0"
            >/{{ s.trigger || '?' }}</span
          >
          <span class="text-xs text-gray-800 dark:text-brand-light truncate flex-1">
            {{ s.name }}
          </span>
          <span class="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{{
            s.scope === 'entry' ? '错题' : s.scope === 'global' ? '全库' : '通用'
          }}</span>
          <button
            class="text-[11px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-brand-light hover:bg-gray-200 dark:hover:bg-[#2a2a28]"
            @click="editingId === s.id ? (editingId = null) : startEdit(s.id)"
          >
            {{ editingId === s.id ? '收起' : '编辑' }}
          </button>
          <button
            class="text-[11px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            @click="confirmAsk(`删除「${s.name}」？`) && remove(s.id)"
          >
            删
          </button>
        </div>

        <!-- 展开编辑表单 -->
        <div
          v-if="editingId === s.id && editing"
          class="border-t border-gray-200 dark:border-[#2e2e2c] p-3 space-y-2"
        >
          <div class="flex gap-2">
            <label class="flex-1 text-[11px] text-gray-500 dark:text-gray-400">
              名称
              <input
                type="text"
                class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light outline-none focus:border-accent"
                :value="editing.name"
                @input="commitField('name', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="w-[100px] text-[11px] text-gray-500 dark:text-gray-400">
              触发词
              <input
                type="text"
                placeholder="讲解"
                class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light font-mono outline-none focus:border-accent"
                :value="editing.trigger"
                @input="commitField('trigger', ($event.target as HTMLInputElement).value.trim())"
              />
            </label>
          </div>

          <label class="block text-[11px] text-gray-500 dark:text-gray-400">
            描述（一句话）
            <input
              type="text"
              class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light outline-none focus:border-accent"
              :value="editing.description"
              @input="commitField('description', ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="block text-[11px] text-gray-500 dark:text-gray-400">
            适用范围
            <select
              class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light outline-none focus:border-accent"
              :value="editing.scope"
              @change="
                commitField('scope', ($event.target as HTMLSelectElement).value as AiSkill['scope'])
              "
            >
              <option value="both">通用（错题模式 + 全库模式都可用）</option>
              <option value="entry">仅错题模式</option>
              <option value="global">仅全库模式</option>
            </select>
          </label>

          <label class="block text-[11px] text-gray-500 dark:text-gray-400">
            System Prompt（你写的提示词，决定 AI 怎么答）
            <textarea
              rows="8"
              class="mt-1 w-full text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light font-mono leading-relaxed outline-none focus:border-accent resize-y"
              :value="editing.systemPrompt"
              placeholder="例如：你是 XX 老师，回答要 XX，禁止 XX..."
              @input="commitField('systemPrompt', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </label>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="flex flex-wrap gap-2 pt-1">
      <button
        class="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90"
        @click="startCreate"
      >
        + 新建指令
      </button>
      <button
        class="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-700 dark:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
        @click="doExport"
      >
        导出
      </button>
      <button
        class="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-700 dark:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
        @click="showImport = !showImport"
      >
        导入
      </button>
      <button
        class="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-500 hover:text-red-500 hover:border-red-300"
        @click="confirmAsk('重置为内置示例（会丢失自定义指令）？') && resetToDefaults()"
      >
        重置
      </button>
    </div>

    <!-- 导入面板 -->
    <div
      v-if="showImport"
      class="space-y-2 rounded-lg border border-gray-200 dark:border-[#2e2e2c] p-3 bg-gray-50 dark:bg-[#1e1e1c]"
    >
      <textarea
        v-model="importText"
        rows="5"
        placeholder="粘贴 JSON（导出文件内容）"
        class="w-full text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light font-mono outline-none focus:border-accent resize-y"
      ></textarea>
      <button
        class="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90"
        @click="doImport"
      >
        确认导入
      </button>
    </div>
  </div>
</template>
