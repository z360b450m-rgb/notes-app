<script setup lang="ts">
import { computed, ref } from 'vue'
import { notebookPlugins } from './registry'
import type { NotebookPluginInstallation, NotebookPluginManifest } from './types'

const props = defineProps<{
  notebookName: string
  installations: NotebookPluginInstallation[]
}>()

const emit = defineEmits<{
  close: []
  install: [pluginId: string]
  uninstall: [pluginId: string, deleteData: boolean]
}>()

const uninstallTarget = ref<NotebookPluginManifest | null>(null)
const deleteData = ref(false)
const installedIds = computed(() => new Set(props.installations.map((item) => item.pluginId)))

function requestUninstall(plugin: NotebookPluginManifest) {
  deleteData.value = false
  uninstallTarget.value = plugin
}

function confirmUninstall() {
  if (!uninstallTarget.value) return
  emit('uninstall', uninstallTarget.value.id, deleteData.value)
  uninstallTarget.value = null
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-[8px] bg-white shadow-xl dark:bg-[#1e1e1c]"
    >
      <header
        class="flex items-start justify-between border-b border-[#e8e6dc] px-6 py-5 dark:border-[#333]"
      >
        <div>
          <h2 class="text-lg font-semibold text-brand-dark dark:text-brand-light">添加功能</h2>
          <p class="mt-1 text-sm text-brand-mid">适用于当前错题本 · {{ notebookName }}</p>
        </div>
        <button
          class="flex h-8 w-8 items-center justify-center text-brand-mid"
          title="关闭"
          @click="emit('close')"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div class="overflow-y-auto px-6 py-5">
        <div
          class="divide-y divide-[#e8e6dc] border-y border-[#e8e6dc] dark:divide-[#333] dark:border-[#333]"
        >
          <div
            v-for="plugin in notebookPlugins"
            :key="plugin.id"
            class="flex items-start gap-4 py-5"
          >
            <div
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[8px] bg-[#fdf0e8] text-[#d97757] dark:bg-[#2e2018]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
              >
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
                <path d="M4 5.5v16M8 7h8M8 11h8" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <strong class="text-sm text-brand-dark dark:text-brand-light">{{
                  plugin.name
                }}</strong>
                <span v-if="installedIds.has(plugin.id)" class="text-xs text-[#788c5d]"
                  >已安装</span
                >
              </div>
              <p class="mt-1 text-sm text-brand-mid">{{ plugin.description }}</p>
              <p class="mt-2 text-xs text-brand-mid">需要：文件导入、本地存储、音频播放</p>
            </div>
            <button
              v-if="!installedIds.has(plugin.id)"
              class="rounded-[8px] bg-[#d97757] px-4 py-2 text-sm text-white"
              @click="emit('install', plugin.id)"
            >
              安装
            </button>
            <button
              v-else
              class="rounded-[8px] border border-[#ddd] px-4 py-2 text-sm text-brand-mid dark:border-[#444]"
              @click="requestUninstall(plugin)"
            >
              卸载
            </button>
          </div>
        </div>
        <div class="mt-6 text-sm text-brand-mid">
          <p class="font-medium text-brand-dark dark:text-brand-light">以后可加入</p>
          <div class="mt-3 flex items-center justify-between py-2">
            <span>语法训练</span><span class="text-xs">规划中</span>
          </div>
          <div class="flex items-center justify-between py-2">
            <span>作文训练</span><span class="text-xs">规划中</span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="uninstallTarget"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
    >
      <div class="w-full max-w-md rounded-[8px] bg-white p-6 shadow-xl dark:bg-[#1e1e1c]">
        <h3 class="text-lg font-semibold text-brand-dark dark:text-brand-light">
          卸载{{ uninstallTarget.name }}？
        </h3>
        <div class="mt-5 space-y-3 text-sm text-brand-dark dark:text-brand-light">
          <label class="flex cursor-pointer items-start gap-3">
            <input v-model="deleteData" type="radio" :value="false" class="mt-1" />
            <span
              ><strong class="block">仅卸载功能</strong
              ><span class="text-brand-mid">保留词库和学习进度，重新安装后可继续使用</span></span
            >
          </label>
          <label class="flex cursor-pointer items-start gap-3">
            <input v-model="deleteData" type="radio" :value="true" class="mt-1" />
            <span
              ><strong class="block">卸载并删除插件数据</strong
              ><span class="text-brand-mid">删除当前错题本中的词库和学习进度</span></span
            >
          </label>
        </div>
        <p
          v-if="deleteData"
          class="mt-4 rounded-[8px] bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300"
        >
          此操作不可恢复；已归档到错题本的错题不会删除。
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="rounded-[8px] px-4 py-2 text-sm text-brand-mid"
            @click="uninstallTarget = null"
          >
            取消
          </button>
          <button
            class="rounded-[8px] bg-red-600 px-4 py-2 text-sm text-white"
            @click="confirmUninstall"
          >
            卸载
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
