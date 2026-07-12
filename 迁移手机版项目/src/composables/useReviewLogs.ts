import { ref } from 'vue'
import type { ReviewLog } from '@/types'
import { db } from '@/services/db'

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
      reviewLogs.value = await db.getAllReviewLogs(getNotebookId())
    } catch {
      reviewLogs.value = []
    }
  }

  async function addLog(entryId: string, quality: number | string) {
    const log: ReviewLog = {
      id: genId(),
      entryId,
      timestamp: Date.now(),
      quality,
    }
    try {
      await db.addReviewLog(getNotebookId(), log)
    } catch (err) {
      console.error('Failed to save review log', err)
    }
    reviewLogs.value.push(log)
  }

  async function deleteLogsByEntry(entryId: string) {
    try {
      await db.deleteReviewLogsByEntry(getNotebookId(), entryId)
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
