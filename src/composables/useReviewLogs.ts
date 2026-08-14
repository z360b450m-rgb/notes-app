import { ref } from 'vue'
import type { ReviewLog } from '@/types'
import { reviewLogRepository } from '@/services/db'

function genId(): string {
  return 'rvlog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// Module-scoped singleton — shared by useReview and useStats
const reviewLogs = ref<ReviewLog[]>([])

// ===================================================================
// @AI-GUIDE: 复习日志管理模块
// 纯业务逻辑。模块级单例 ref (reviewLogs) 在 useReview 和 useStats
// 间共享。日志加载/添加/删除均通过 db 统一导出操作。
// 返回值类型签名必须向后兼容。
// ===================================================================
export function useReviewLogs(getNotebookId: () => string) {
  async function loadLogs() {
    try {
      const notebookId = getNotebookId()
      reviewLogs.value = notebookId ? await reviewLogRepository.getAll(notebookId) : []
    } catch {
      reviewLogs.value = []
    }
  }

  async function addLog(
    entryId: string,
    quality: number | string,
    context?: Pick<
      ReviewLog,
      | 'selectedChoice'
      | 'correctChoice'
      | 'isCorrect'
      | 'sessionId'
      | 'reviewScope'
      | 'sessionSize'
      | 'sessionCompleted'
      | 'elapsedMs'
      | 'reviewNote'
    >,
  ) {
    const log: ReviewLog = {
      id: genId(),
      entryId,
      timestamp: Date.now(),
      quality,
      ...context,
    }
    try {
      await reviewLogRepository.add(getNotebookId(), log)
    } catch (err) {
      console.error('Failed to save review log', err)
    }
    reviewLogs.value.push(log)
  }

  async function deleteLogsByEntry(entryId: string) {
    try {
      await reviewLogRepository.deleteByEntry(getNotebookId(), entryId)
    } catch (err) {
      console.error('Failed to delete review logs', err)
    }
    reviewLogs.value = reviewLogs.value.filter((l) => l.entryId !== entryId)
  }

  return {
    reviewLogs,
    loadLogs,
    addLog,
    deleteLogsByEntry,
  }
}
