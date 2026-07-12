<script setup lang="ts">
import { ref } from 'vue'
import { useModalAnimations } from '@/composables/useModalAnimations'

defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  keep: []
  reset: []
  cancel: []
}>()

const importMode = ref<'default' | 'sequential'>('default')
const startNum = ref<number>(1)
const endNum = ref<number>(120)

const { enterModal, leaveModal } = useModalAnimations()
</script>

<template>
  <Transition :css="false" @enter="enterModal" @leave="leaveModal">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="modal-overlay absolute inset-0 bg-black/30" @click="emit('cancel')" />

      <div
        class="modal-dialog relative bg-white dark:bg-[#141413] rounded-xl shadow-2xl border border-gray-100 dark:border-[#2e2e2c] p-6 w-[400px] max-w-[90vw]"
      >
        <div class="flex items-start gap-3 mb-4">
          <div
            class="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4a90d9"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </div>
          <div>
            <h3 class="text-[15px] font-bold text-gray-800 dark:text-brand-light">导入归档</h3>
            <p class="text-[13px] text-gray-500 dark:text-brand-mid mt-1 leading-relaxed">
              请选择导入策略。导入时遇到相同 ID
              的错题将直接覆盖。你可以保留原有的复习进度，或将其重置为全新的未复习错题。
            </p>
          </div>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >导入模式</label
          >
          <div class="flex gap-2">
            <button
              type="button"
              :class="[
                importMode === 'default'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
              ]"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              @click="importMode = 'default'"
            >
              自动盲切 (旧模式)
            </button>
            <button
              type="button"
              :class="[
                importMode === 'sequential'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
              ]"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              @click="importMode = 'sequential'"
            >
              整套按序导入
            </button>
          </div>
        </div>

        <div v-if="importMode === 'sequential'" class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >开始题号</label
            >
            <input
              v-model.number="startNum"
              type="number"
              min="1"
              class="w-full px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 focus:outline-none focus:border-indigo-400"
              placeholder="1"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >结束题号</label
            >
            <input
              v-model.number="endNum"
              type="number"
              min="1"
              class="w-full px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 focus:outline-none focus:border-indigo-400"
              placeholder="120"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-5">
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-100 dark:border-[#2e2e2c] bg-white dark:bg-[#141413] text-gray-600 dark:text-brand-light-gray hover:bg-gray-50 dark:hover:bg-[#2a2a28] transition-all duration-200 ease-out active:scale-95"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium text-gray-600 dark:text-brand-light-gray hover:bg-gray-100 dark:hover:bg-[#2a2a28] dark:bg-[#1e1e1c] transition-all duration-200 ease-out active:scale-95"
            @click="emit('reset')"
          >
            重置为未复习
          </button>
          <button
            class="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-white hover:brightness-110 transition-all duration-200 ease-out active:scale-95"
            @click="emit('keep')"
          >
            保留复习进度
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
