import { inject, ref, type InjectionKey } from 'vue'

export type BackgroundTask = {
  id: string
  title: string
  detail: string
  state: 'running' | 'completed' | 'warning' | 'failed'
  progress?: number
  actionLabel?: string
  open: () => void | Promise<void>
}

export function createBackgroundTasks() {
  const tasks = ref<BackgroundTask[]>([])
  function update(task: BackgroundTask) {
    const previous = tasks.value.find((item) => item.id === task.id)
    if (previous) Object.assign(previous, task)
    else tasks.value.push(task)
  }
  function dismiss(id: string) {
    tasks.value = tasks.value.filter((item) => item.id !== id || item.state === 'running')
  }
  async function open(task: BackgroundTask) {
    try {
      await task.open()
      if (task.state !== 'running') dismiss(task.id)
    } catch (cause) {
      task.detail = cause instanceof Error ? cause.message : '暂时无法打开结果，请重试'
    }
  }
  return { tasks, update, dismiss, open }
}

export const backgroundTasksKey: InjectionKey<ReturnType<typeof createBackgroundTasks>> =
  Symbol('backgroundTasks')

export function useBackgroundTasks() {
  return inject(backgroundTasksKey, null)
}
