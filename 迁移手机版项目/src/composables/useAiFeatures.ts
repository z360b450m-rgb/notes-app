import { ref } from 'vue'

const AI_FEATURES_KEY = 'ai_features_enabled'

// 默认关闭 AI 功能，用户需在设置中手动开启
const enabled = ref(localStorage.getItem(AI_FEATURES_KEY) === 'true')

export function useAiFeatures() {
  function enable() {
    enabled.value = true
    localStorage.setItem(AI_FEATURES_KEY, 'true')
  }

  function disable() {
    enabled.value = false
    localStorage.setItem(AI_FEATURES_KEY, 'false')
  }

  function toggle() {
    if (enabled.value) {
      disable()
    } else {
      enable()
    }
  }

  return { enabled, enable, disable, toggle }
}
