import { computed, ref, type Ref } from 'vue'
import type { NoteEntry } from '@/types'
import type { ReviewOptions } from '@/composables/useReview'

interface ReviewSetupFeatureOptions {
  entries: Ref<NoteEntry[]>
  startReview: (options?: ReviewOptions | boolean) => boolean
  showToast: (message: string) => void
  runAfterDirtyCheck: (action: () => void) => void
}

export function useReviewSetupFeature(options: ReviewSetupFeatureOptions) {
  const pendingForceReview = ref(false)
  const showReviewSetup = ref(false)
  const reviewScope = ref<'due' | 'all'>('due')
  const reviewTags = ref<string[]>([])
  const reviewSubjects = ref<string[]>([])
  const reviewRandom = ref(true)
  const reviewLimit = ref<number | null>(null)

  const reviewCandidateCount = computed(() => {
    let pool =
      reviewScope.value === 'all'
        ? options.entries.value
        : options.entries.value.filter(
            (entry) => !entry.nextReviewDate || entry.nextReviewDate <= Date.now(),
          )
    if (reviewTags.value.length) {
      pool = pool.filter((entry) => reviewTags.value.some((tag) => entry.tags.includes(tag)))
    }
    if (reviewSubjects.value.length) {
      pool = pool.filter((entry) => reviewSubjects.value.includes(entry.subject))
    }
    return reviewLimit.value && reviewLimit.value > 0
      ? Math.min(pool.length, reviewLimit.value)
      : pool.length
  })

  function openReviewSetup(force = false) {
    reviewScope.value = force ? 'all' : 'due'
    reviewTags.value = []
    reviewSubjects.value = []
    reviewRandom.value = true
    reviewLimit.value = null
    showReviewSetup.value = true
  }

  function handleStartReview(force = false) {
    pendingForceReview.value = force
    options.runAfterDirtyCheck(() => openReviewSetup(force))
  }

  function doStartReview() {
    openReviewSetup(pendingForceReview.value)
  }

  function toggleReviewTag(tag: string) {
    reviewTags.value = reviewTags.value.includes(tag)
      ? reviewTags.value.filter((item) => item !== tag)
      : [...reviewTags.value, tag]
  }

  function toggleReviewSubject(subject: string) {
    reviewSubjects.value = reviewSubjects.value.includes(subject)
      ? reviewSubjects.value.filter((item) => item !== subject)
      : [...reviewSubjects.value, subject]
  }

  function beginConfiguredReview() {
    const reviewOptions: ReviewOptions = {
      scope: reviewScope.value,
      tags: reviewTags.value,
      subjects: reviewSubjects.value,
      random: reviewRandom.value,
      limit: reviewLimit.value || undefined,
    }
    if (!options.startReview(reviewOptions)) {
      options.showToast('当前筛选条件下没有可复习的题目')
      return
    }
    showReviewSetup.value = false
  }

  return {
    showReviewSetup,
    reviewScope,
    reviewTags,
    reviewSubjects,
    reviewRandom,
    reviewLimit,
    reviewCandidateCount,
    handleStartReview,
    doStartReview,
    toggleReviewTag,
    toggleReviewSubject,
    beginConfiguredReview,
  }
}
