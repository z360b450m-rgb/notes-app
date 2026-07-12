import { onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

interface KeyboardActions {
  onCreate: (subject?: string) => void
  onSave: () => void
  onToggleReveal: () => void
  onPrev: () => void
  onNext: () => void
  mode?: Ref<'edit' | 'review'>
  isReviewing?: ComputedRef<boolean>
  answered?: Ref<boolean>
  revealAnswer?: () => void
  rateCard?: (rating: number | string) => Promise<void>
  drawingEnabled?: Ref<boolean>
  onUndo?: () => void
  onRedo?: () => void
}

// ===================================================================
// @AI-GUIDE: 键盘快捷键绑定层
// 例外模块 —— 本 composable 绑定 window keydown 事件, 是唯一的
// 全局键盘交互入口。新增/修改快捷键必须在 KeyboardActions 接口
// 中声明, 并在 handler 中实现。快捷键的启用/禁用逻辑由调用方控制。
// ===================================================================
export function useKeyboard(actions: KeyboardActions) {
  function handler(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && e.key === 'n') {
      e.preventDefault()
      actions.onCreate()
      return
    }
    if (ctrl && e.key === 's') {
      e.preventDefault()
      actions.onSave()
      return
    }
    if (ctrl && e.key === 'r') {
      e.preventDefault()
      actions.onToggleReveal()
      return
    }
    if (ctrl && e.key === 'ArrowLeft') {
      const el = document.activeElement
      if (!el || !(el as HTMLElement).isContentEditable) {
        e.preventDefault()
        actions.onPrev()
      }
      return
    }
    if (ctrl && e.key === 'ArrowRight') {
      const el = document.activeElement
      if (!el || !(el as HTMLElement).isContentEditable) {
        e.preventDefault()
        actions.onNext()
      }
      return
    }

    // Drawing undo/redo
    if (actions.drawingEnabled?.value) {
      if (ctrl && e.key === 'z') {
        e.preventDefault()
        actions.onUndo?.()
        return
      }
      if (ctrl && e.key === 'y') {
        e.preventDefault()
        actions.onRedo?.()
        return
      }
    }

    // S/D to navigate prev/next (edit mode, not typing)
    if (actions.mode?.value === 'edit' && !actions.drawingEnabled?.value) {
      if (e.key === 's' && !ctrl) {
        const el = document.activeElement
        if (!el || !(el as HTMLElement).isContentEditable) {
          const tag = (el as HTMLElement)?.tagName
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
            e.preventDefault()
            actions.onPrev()
            return
          }
        }
      }
      if (e.key === 'd' && !ctrl) {
        const el = document.activeElement
        if (!el || !(el as HTMLElement).isContentEditable) {
          const tag = (el as HTMLElement)?.tagName
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
            e.preventDefault()
            actions.onNext()
            return
          }
        }
      }
    }

    // Review mode shortcuts
    if (actions.mode?.value === 'review') {
      // Space to reveal answer
      if (e.key === ' ' && !e.ctrlKey && !e.metaKey) {
        const el = document.activeElement
        if (
          !el ||
          (el as HTMLElement).tagName === 'BODY' ||
          (el as HTMLElement).tagName === 'DIV'
        ) {
          e.preventDefault()
          if (!actions.answered?.value) {
            actions.revealAnswer?.()
          }
        }
      }
      // Number keys to rate
      if (!e.ctrlKey && !e.metaKey && actions.answered?.value) {
        if (e.key === '1') {
          e.preventDefault()
          actions.rateCard?.('forgot')
        } else if (e.key === '2') {
          e.preventDefault()
          actions.rateCard?.('unfamiliar')
        } else if (e.key === '3') {
          e.preventDefault()
          actions.rateCard?.('mastered')
        }
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', handler))
  onUnmounted(() => document.removeEventListener('keydown', handler))
}
