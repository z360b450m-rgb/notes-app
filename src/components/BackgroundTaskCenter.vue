<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useBackgroundTasks } from '@/composables/useBackgroundTasks'
import TaskProgress from './TaskProgress.vue'

const feature = useBackgroundTasks()!
const { tasks } = feature
const panel = ref<HTMLElement | null>(null)
const collapsed = ref(true)
const hidden = ref(false)
function closeNotifications() {
  hidden.value = true
  panel.value?.hidePopover()
}
// Native modal dialogs make everything outside them inert. Keep the task popover
// inside the active dialog so its result links remain usable above that dialog.
const target = ref<HTMLElement | string>('#app')
const observer = new MutationObserver(() => {
  target.value = [...document.querySelectorAll<HTMLElement>('dialog:modal')].at(-1) || '#app'
})
onMounted(() => {
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
    childList: true,
  })
})
onUnmounted(() => observer.disconnect())
const running = computed(() => tasks.value.filter((task) => task.state === 'running').length)
watch(
  [() => tasks.value.map((task) => `${task.id}:${task.state}`).join(','), target],
  async ([state], [previousState]) => {
    if (state !== previousState) hidden.value = false
    collapsed.value = !tasks.value.some((task) => task.state !== 'running')
    await nextTick()
    if (tasks.value.length && !hidden.value) {
      panel.value?.hidePopover()
      panel.value?.showPopover()
    } else panel.value?.hidePopover()
  },
)
</script>

<template>
  <Teleport :to="target">
    <aside
      ref="panel"
      popover="manual"
      aria-label="后台任务"
      class="background-tasks rounded-2xl border border-black/10 bg-[#f8f7f3] p-4 text-brand-dark shadow-xl dark:border-white/15 dark:bg-[#2d2b28] dark:text-brand-light"
    >
      <header class="flex items-center justify-between gap-3">
        <strong class="text-sm">{{ running ? `后台处理中 · ${running} 项` : '任务通知' }}</strong>
        <div class="flex shrink-0 items-center gap-3">
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control text-xs text-brand-mid"
            :aria-expanded="!collapsed"
            @click="collapsed = !collapsed"
          >
            {{ collapsed ? '展开' : '收起' }}
          </button>
          <button
            data-ui-variant="text"
            type="button"
            class="ui-control flex h-6 w-6 items-center justify-center rounded-md text-brand-mid hover:text-brand-dark dark:hover:text-brand-light"
            aria-label="关闭任务通知面板"
            title="关闭通知"
            @click="closeNotifications"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>
      <TaskProgress
        v-if="collapsed && running"
        :value="
          running === 1 ? tasks.find((task) => task.state === 'running')?.progress : undefined
        "
        label="后台任务进度"
      />
      <div v-show="!collapsed" class="task-list mt-3 space-y-3">
        <article
          v-for="task in [...tasks].reverse()"
          :key="task.id"
          :data-task-state="task.state"
          class="rounded-xl border border-black/10 p-3 dark:border-white/10"
        >
          <div class="flex items-start justify-between gap-3">
            <p role="status" class="min-w-0 break-words text-sm font-medium">
              {{
                task.state === 'completed'
                  ? '✓ '
                  : task.state === 'failed' || task.state === 'warning'
                    ? '！'
                    : ''
              }}{{ task.title }}
            </p>
            <button
              data-ui-variant="default"
              v-if="task.state !== 'running'"
              type="button"
              aria-label="关闭任务通知"
              class="ui-control shrink-0 text-brand-mid"
              @click="feature.dismiss(task.id)"
            >
              ✕
            </button>
          </div>
          <p class="mt-1 break-words text-xs leading-5 text-brand-mid">{{ task.detail }}</p>
          <TaskProgress
            v-if="task.state === 'running'"
            :value="task.progress"
            :label="task.title"
          />
          <button
            data-ui-variant="default"
            type="button"
            class="ui-control mt-2 text-xs font-medium text-accent"
            @click="feature.open(task)"
          >
            {{ task.actionLabel || (task.state === 'running' ? '查看进度 ↗' : '查看结果 ↗') }}
          </button>
        </article>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.background-tasks {
  position: fixed;
  inset: auto 20px 20px auto;
  margin: 0;
  width: min(360px, calc(100vw - 24px));
  max-height: min(70dvh, 600px);
  overflow: auto;
  z-index: 10000;
}
.task-list {
  max-height: 55dvh;
  overflow: auto;
}
.background-tasks::backdrop {
  pointer-events: none;
}
@media (max-width: 480px) {
  .background-tasks {
    right: 12px;
    bottom: 12px;
  }
}
</style>
