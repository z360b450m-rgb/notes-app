import { ref, watch } from 'vue'

export interface ReviewSettings {
  firstReviewDays: number
  unmasteredDays: number
  masteredDays: number
  growthFactor: number
  maxInterval: number
}

const STORAGE_KEY = 'cuoti-review-settings'

const DEFAULTS: ReviewSettings = {
  firstReviewDays: 1,
  unmasteredDays: 1,
  masteredDays: 3,
  growthFactor: 2.5,
  maxInterval: 180,
}

function load(): ReviewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      firstReviewDays:
        typeof parsed.firstReviewDays === 'number'
          ? parsed.firstReviewDays
          : DEFAULTS.firstReviewDays,
      unmasteredDays:
        typeof parsed.unmasteredDays === 'number' ? parsed.unmasteredDays : DEFAULTS.unmasteredDays,
      masteredDays:
        typeof parsed.masteredDays === 'number' ? parsed.masteredDays : DEFAULTS.masteredDays,
      growthFactor:
        typeof parsed.growthFactor === 'number' ? parsed.growthFactor : DEFAULTS.growthFactor,
      maxInterval:
        typeof parsed.maxInterval === 'number' ? parsed.maxInterval : DEFAULTS.maxInterval,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const settings = ref<ReviewSettings>(load())

// Persist on change
watch(
  settings,
  (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  },
  { deep: true },
)

// ===================================================================
// @AI-GUIDE: 复习参数配置管理层
// 纯业务逻辑。SRS 参数 (间隔天数/增长系数等) 的持久化读写、
// 默认值重置均在此实现。设置变更通过 localStorage 自动同步。
// ReviewSettings 接口必须向后兼容。
// ===================================================================
export function useReviewSettings() {
  function resetToDefaults() {
    settings.value = { ...DEFAULTS }
  }

  return {
    settings,
    defaults: DEFAULTS,
    resetToDefaults,
  }
}
