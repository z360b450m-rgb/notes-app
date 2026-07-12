import { ref } from 'vue'

const isDark = ref(false)

// ===================================================================
// @AI-GUIDE: 主题管理层
// 管理深色/亮色模式切换。通过 localStorage 持久化用户偏好,
// 默认跟随系统 prefers-color-scheme。主题 class 的切换是
// 本模块唯一允许的 DOM 操作 (document.documentElement.classList)。
// ===================================================================
export function useDarkMode() {
  function apply(val: boolean) {
    document.documentElement.classList.toggle('dark', val)
    document.body.classList.toggle('dark', val)
    localStorage.setItem('cuoti-dark', String(val))
  }

  const saved = localStorage.getItem('cuoti-dark')
  if (saved !== null) {
    isDark.value = saved === 'true'
  } else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  apply(isDark.value)

  function toggleDark() {
    isDark.value = !isDark.value
    apply(isDark.value)
  }

  return { isDark, toggleDark }
}
