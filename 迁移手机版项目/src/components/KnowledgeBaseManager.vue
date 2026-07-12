<script setup lang="ts">
// 知识库管理：列表 / 新建 / 重命名 / 删除 / 复制 data 目录路径 / 重建索引
import { onMounted, ref } from 'vue'
import { useKnowledgeBases } from '../composables/useKnowledgeBases'

const { kbs, loading, lastError, refresh, create, rename, remove, reindex, dataDir } =
  useKnowledgeBases()

onMounted(refresh)

const showCreate = ref(false)
const newId = ref('')
const newName = ref('')
const newDesc = ref('')
const busyMsg = ref<string | null>(null)
const renamingId = ref<string | null>(null)
const renameDraft = ref('')

function startRename(kb: { id: string; name: string }) {
  renamingId.value = kb.id
  renameDraft.value = kb.name
}

async function doCreate() {
  const id = newId.value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
    alert('ID 只能用小写字母/数字/-/_，1-32 字符')
    return
  }
  try {
    await create({ id, name: newName.value.trim() || id, description: newDesc.value })
    showCreate.value = false
    newId.value = ''
    newName.value = ''
    newDesc.value = ''
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function doRename(id: string) {
  if (!renameDraft.value.trim()) return
  try {
    await rename(id, { name: renameDraft.value.trim() })
    renamingId.value = null
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function doRemove(id: string, name: string) {
  if (
    !window.confirm(
      `删除知识库「${name}」？\n会同时删除其所有索引数据（不删除 data/${id}/ 文件夹）`,
    )
  )
    return
  try {
    await remove(id)
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function copyDataDir(id: string) {
  try {
    const path = await dataDir(id)
    await navigator.clipboard.writeText(path)
    busyMsg.value = `已复制路径：${path}`
    setTimeout(() => (busyMsg.value = null), 3000)
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function doReindex(id: string, name: string) {
  if (!window.confirm(`重建「${name}」索引？\n会清空该库已有 chunk，然后扫描 data/${id}/ 重新入库`))
    return
  busyMsg.value = `正在重建 ${name}…`
  try {
    const r = await reindex(id, true)
    busyMsg.value = `重建完成：${JSON.stringify(r)}`
    setTimeout(() => (busyMsg.value = null), 4000)
  } catch (e) {
    busyMsg.value = null
    alert(e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="lastError" class="text-[11px] text-red-500">连接 RAG 服务失败：{{ lastError }}</div>
    <div v-if="busyMsg" class="text-[11px] text-accent break-all">{{ busyMsg }}</div>

    <div
      v-for="k in kbs"
      :key="k.id"
      class="rounded-lg border border-gray-200 dark:border-[#2e2e2c] bg-gray-50 dark:bg-[#1e1e1c] p-2"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-gray-800 dark:text-brand-light flex-1 truncate">
          <template v-if="renamingId === k.id">
            <input
              v-model="renameDraft"
              type="text"
              class="w-full text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] outline-none focus:border-accent"
              @keydown.enter="doRename(k.id)"
              @keydown.escape="renamingId = null"
            />
          </template>
          <template v-else>
            📚 {{ k.name }}
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono ml-1">{{
              k.id
            }}</span>
            <span v-if="k.is_default" class="text-[10px] text-accent ml-1">默认</span>
          </template>
        </span>

        <template v-if="renamingId === k.id">
          <button class="text-[11px] px-1.5 py-0.5 text-accent" @click="doRename(k.id)">
            保存
          </button>
          <button class="text-[11px] px-1.5 py-0.5 text-gray-500" @click="renamingId = null">
            取消
          </button>
        </template>
        <template v-else>
          <button
            class="text-[11px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
            title="复制 data/ 路径"
            @click="copyDataDir(k.id)"
          >
            路径
          </button>
          <button
            class="text-[11px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
            title="清空并重建索引（扫描 data/<id>/）"
            @click="doReindex(k.id, k.name)"
          >
            重建
          </button>
          <button
            class="text-[11px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-800 dark:hover:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
            @click="startRename(k)"
          >
            改名
          </button>
          <button
            v-if="!k.is_default"
            class="text-[11px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            @click="doRemove(k.id, k.name)"
          >
            删
          </button>
        </template>
      </div>
      <div
        v-if="k.description && renamingId !== k.id"
        class="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-snug"
      >
        {{ k.description }}
      </div>
    </div>

    <div class="flex gap-2 pt-1">
      <button
        class="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90"
        @click="showCreate = !showCreate"
      >
        + 新建知识库
      </button>
      <button
        class="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] text-gray-700 dark:text-brand-light hover:bg-gray-100 dark:hover:bg-[#2a2a28]"
        :disabled="loading"
        @click="refresh"
      >
        刷新
      </button>
    </div>

    <div
      v-if="showCreate"
      class="space-y-2 rounded-lg border border-gray-200 dark:border-[#2e2e2c] p-3 bg-gray-50 dark:bg-[#1e1e1c]"
    >
      <label class="block text-[11px] text-gray-500 dark:text-gray-400">
        ID（小写英文，建库后不可改）
        <input
          v-model="newId"
          type="text"
          placeholder="例如：gaokao"
          class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light font-mono outline-none focus:border-accent"
        />
      </label>
      <label class="block text-[11px] text-gray-500 dark:text-gray-400">
        名称
        <input
          v-model="newName"
          type="text"
          placeholder="例如：高考真题库"
          class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light outline-none focus:border-accent"
        />
      </label>
      <label class="block text-[11px] text-gray-500 dark:text-gray-400">
        描述（可选）
        <input
          v-model="newDesc"
          type="text"
          class="mt-1 w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-800 dark:text-brand-light outline-none focus:border-accent"
        />
      </label>
      <button
        class="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90"
        @click="doCreate"
      >
        确认
      </button>
    </div>

    <div class="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed pt-1">
      用法：① 新建库后点「路径」拿到 data/&lt;id&gt;/ 目录 ② 把 PDF/MD/TXT 拷进去 ③
      点「重建」生成索引 ④ 聊天侧栏切换库即可问答
    </div>
  </div>
</template>
