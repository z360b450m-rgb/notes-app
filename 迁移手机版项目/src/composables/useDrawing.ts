import { ref, onUnmounted, type Ref } from 'vue'

export type DrawTool = 'pen' | 'eraser'

export const PEN_COLORS = [
  { code: '#ef4444', name: '红' },
  { code: '#f97316', name: '橙' },
  { code: '#eab308', name: '黄' },
  { code: '#22c55e', name: '绿' },
  { code: '#3b82f6', name: '蓝' },
  { code: '#a855f7', name: '紫' },
]

interface CanvasState {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  container: HTMLElement
  undoStack: string[]
  redoStack: string[]
  ro: ResizeObserver | null
  _resizeHandler?: () => void
}

export interface DrawingState {
  drawingEnabled: Ref<boolean>
  activeTool: Ref<DrawTool>
  penColor: Ref<string>
  penSize: Ref<number>
  eraserSize: Ref<number>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  currentEntryId: Ref<string | null>
  toggleDrawing: () => void
  setTool: (t: DrawTool) => void
  setColor: (c: string) => void
  setPenSize: (s: number) => void
  setEraserSize: (s: number) => void
  clearCanvas: () => void
  undo: () => void
  redo: () => void
  resizeCanvas: () => void
  loadDrawing: (entryId: string, field: string) => void
  mountCanvas: (container: HTMLElement, field: string) => void
  captureDrawing: (field: string) => string | null
  captureAllDrawings: () => Record<string, string>
  setStoredDrawing: (entryId: string, field: string, dataUrl: string) => void
  setCanvasParent: (el: HTMLElement | null) => void
}

// ===================================================================
// @AI-GUIDE: 画笔批注引擎 (Canvas 操作层)
// 支持同时挂载多个画布 (question / wrongAnswer / correctAnswer)。
// 共享笔刷/橡皮/颜色，每个画布独立 undo/redo。
// 绘图数据通过 memory Map (key = entryId:field) 缓存。
// ===================================================================
export function useDrawing(onChange?: () => void): DrawingState {
  const drawingEnabled = ref(false)
  const activeTool = ref<DrawTool>('pen')
  const penColor = ref(PEN_COLORS[0].code)
  const penSize = ref(3)
  const eraserSize = ref(24)

  const canvases = new Map<string, CanvasState>()
  const dirtyFields = new Set<string>()
  let activeField = ''
  let drawing = false
  let lastPos = { x: 0, y: 0 }

  // Per-entry+field drawing store
  const drawingStore = new Map<string, string>()
  const currentEntryId = ref<string | null>(null)

  const MAX_HISTORY = 50
  const canUndo = ref(false)
  const canRedo = ref(false)

  function activeState(): CanvasState | undefined {
    return canvases.get(activeField)
  }

  function updateHistoryFlags() {
    const s = activeState()
    canUndo.value = s ? s.undoStack.length > 0 : false
    canRedo.value = s ? s.redoStack.length > 0 : false
  }

  function saveSnapshot(state: CanvasState) {
    state.undoStack.push(state.canvas.toDataURL())
    if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift()
    state.redoStack.length = 0
    updateHistoryFlags()
  }

  function restoreSnapshot(state: CanvasState, dataUrl: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        state.ctx.save()
        state.ctx.setTransform(1, 0, 0, 1, 0, 0)
        state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height)
        state.ctx.drawImage(img, 0, 0)
        state.ctx.restore()
        resolve()
      }
      img.onerror = () => resolve()
      img.src = dataUrl
    })
  }

  async function undo() {
    const s = activeState()
    if (!s || s.undoStack.length === 0) return
    s.redoStack.push(s.canvas.toDataURL())
    const prev = s.undoStack.pop()!
    await restoreSnapshot(s, prev)
    updateHistoryFlags()
    onChange?.()
  }

  async function redo() {
    const s = activeState()
    if (!s || s.redoStack.length === 0) return
    s.undoStack.push(s.canvas.toDataURL())
    const next = s.redoStack.pop()!
    await restoreSnapshot(s, next)
    updateHistoryFlags()
    onChange?.()
  }

  function resizeState(state: CanvasState) {
    const { canvas, ctx, container } = state
    const dpr = window.devicePixelRatio || 1
    const w = container.scrollWidth || container.clientWidth
    const h = container.scrollHeight || container.clientHeight
    if (w === 0 || h === 0) return
    const physicalWidth = w * dpr
    const physicalHeight = h * dpr
    if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = canvas.width
      tempCanvas.height = canvas.height
      const tempCtx = tempCanvas.getContext('2d')
      if (tempCtx) tempCtx.drawImage(canvas, 0, 0)

      canvas.width = physicalWidth
      canvas.height = physicalHeight
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(tempCanvas, 0, 0)
      ctx.restore()
    }
  }

  function getPos(state: CanvasState, e: MouseEvent | Touch): { x: number; y: number } {
    const r = state.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onStart(state: CanvasState, e: MouseEvent | Touch) {
    saveSnapshot(state)
    drawing = true
    for (const [k, v] of canvases) {
      if (v === state) {
        activeField = k
        dirtyFields.add(k)
        break
      }
    }
    updateHistoryFlags()
    const { x, y } = getPos(state, e)
    lastPos = { x, y }
    state.ctx.beginPath()
    state.ctx.moveTo(x, y)

    if (activeTool.value === 'pen') {
      state.ctx.strokeStyle = penColor.value
      state.ctx.lineWidth = penSize.value
      state.ctx.lineCap = 'round'
      state.ctx.lineJoin = 'round'
      state.ctx.globalCompositeOperation = 'source-over'
      state.ctx.shadowBlur = 1
      state.ctx.shadowColor = penColor.value
    } else {
      state.ctx.lineWidth = eraserSize.value
      state.ctx.lineCap = 'round'
      state.ctx.lineJoin = 'round'
      state.ctx.globalCompositeOperation = 'destination-out'
      state.ctx.shadowBlur = 0
    }
  }

  function onMove(state: CanvasState, e: MouseEvent | Touch) {
    if (!drawing) return
    const { x, y } = getPos(state, e)
    const midX = lastPos.x + (x - lastPos.x) / 2
    const midY = lastPos.y + (y - lastPos.y) / 2
    state.ctx.quadraticCurveTo(lastPos.x, lastPos.y, midX, midY)
    state.ctx.stroke()
    state.ctx.beginPath()
    state.ctx.moveTo(midX, midY)
    lastPos = { x, y }
  }

  function onEnd() {
    if (!drawing) return
    drawing = false
    const s = activeState()
    if (s) s.ctx.closePath()
    onChange?.()
  }

  function createEventHandlers(state: CanvasState) {
    return {
      onMouseDown(e: MouseEvent) {
        e.preventDefault()
        onStart(state, e)
      },
      onMouseMove(e: MouseEvent) {
        onMove(state, e)
      },
      onMouseUp() {
        onEnd()
      },
      onTouchStart(e: TouchEvent) {
        if (e.touches.length === 1) {
          e.preventDefault()
          onStart(state, e.touches[0])
        }
      },
      onTouchMove(e: TouchEvent) {
        if (e.touches.length === 1) {
          e.preventDefault()
          onMove(state, e.touches[0])
        }
      },
      onTouchEnd() {
        onEnd()
      },
    }
  }

  function mountCanvas(container: HTMLElement, field: string) {
    // Unmount existing canvas for this field if any
    unmountField(field)

    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.pointerEvents = drawingEnabled.value ? 'auto' : 'none'
    canvas.style.zIndex = '10'
    const ctx = canvas.getContext('2d')!

    container.classList.add('relative')
    container.appendChild(canvas)

    const state: CanvasState = {
      canvas,
      ctx,
      container,
      undoStack: [],
      redoStack: [],
      ro: null,
    }

    const h = createEventHandlers(state)
    canvas.addEventListener('mousedown', h.onMouseDown)
    canvas.addEventListener('mousemove', h.onMouseMove)
    canvas.addEventListener('mouseup', h.onMouseUp)
    canvas.addEventListener('mouseleave', h.onMouseUp)
    canvas.addEventListener('touchstart', h.onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', h.onTouchMove, { passive: false })
    canvas.addEventListener('touchend', h.onTouchEnd)

    resizeState(state)

    const handleResize = () => resizeState(state)
    state._resizeHandler = handleResize
    window.addEventListener('resize', handleResize)

    state.ro = new ResizeObserver(() => resizeState(state))
    state.ro.observe(container)

    canvases.set(field, state)
    if (!activeField) activeField = field
  }

  function unmountField(field: string) {
    const existing = canvases.get(field)
    if (existing) {
      existing.canvas.remove()
      if (existing._resizeHandler) {
        window.removeEventListener('resize', existing._resizeHandler)
      }
      if (existing.ro) existing.ro.disconnect()
    }
    canvases.delete(field)
    if (activeField === field) {
      activeField = canvases.keys().next().value || ''
    }
    updateHistoryFlags()
  }

  function setCanvasParent(_el: HTMLElement | null) {
    // no-op: multi-canvas mode doesn't reparent
  }

  function loadDrawing(entryId: string, field: string) {
    const state = canvases.get(field)
    if (!state) return

    if (currentEntryId.value !== entryId) {
      dirtyFields.clear()
    }
    currentEntryId.value = entryId

    const key = `${entryId}:${field}`

    // Reset undo/redo for this field
    state.undoStack.length = 0
    state.redoStack.length = 0
    if (activeField === field) updateHistoryFlags()

    // Clear canvas
    const dpr = window.devicePixelRatio || 1
    state.ctx.clearRect(0, 0, state.canvas.width / dpr, state.canvas.height / dpr)

    if (drawingStore.has(key)) {
      restoreSnapshot(state, drawingStore.get(key)!)
      dirtyFields.add(field)
    }
  }

  function resizeCanvas() {
    canvases.forEach((state) => resizeState(state))
  }

  function clearCanvas() {
    const s = activeState()
    if (!s) return
    saveSnapshot(s)
    const dpr = window.devicePixelRatio || 1
    s.ctx.clearRect(0, 0, s.canvas.width / dpr, s.canvas.height / dpr)
    dirtyFields.delete(activeField)
    onChange?.()
  }

  function captureDrawing(field: string): string | null {
    if (!dirtyFields.has(field)) return null
    const state = canvases.get(field)
    if (!state || state.canvas.width === 0 || state.canvas.height === 0) return null
    return state.canvas.toDataURL()
  }

  function captureAllDrawings(): Record<string, string> {
    const result: Record<string, string> = {}
    dirtyFields.forEach((field) => {
      const state = canvases.get(field)
      if (state && state.canvas.width > 0 && state.canvas.height > 0) {
        result[field] = state.canvas.toDataURL()
      }
    })
    return result
  }

  function setStoredDrawing(entryId: string, field: string, dataUrl: string) {
    drawingStore.set(`${entryId}:${field}`, dataUrl)
  }

  function toggleDrawing() {
    drawingEnabled.value = !drawingEnabled.value
    const ptr = drawingEnabled.value ? 'auto' : 'none'
    canvases.forEach((s) => {
      s.canvas.style.pointerEvents = ptr
      if (drawingEnabled.value) resizeState(s)
    })
    if (drawingEnabled.value) {
      activeTool.value = 'pen'
    }
  }

  function setTool(t: DrawTool) {
    activeTool.value = t
  }
  function setColor(c: string) {
    penColor.value = c
    activeTool.value = 'pen'
  }
  function setPenSize(s: number) {
    penSize.value = s
  }
  function setEraserSize(s: number) {
    eraserSize.value = s
  }

  onUnmounted(() => {
    canvases.forEach((state) => {
      state.canvas.remove()
      if (state._resizeHandler) {
        window.removeEventListener('resize', state._resizeHandler)
      }
      if (state.ro) state.ro.disconnect()
    })
    canvases.clear()
  })

  return {
    drawingEnabled,
    activeTool,
    penColor,
    penSize,
    eraserSize,
    canUndo,
    canRedo,
    currentEntryId,
    toggleDrawing,
    setTool,
    setColor,
    setPenSize,
    setEraserSize,
    clearCanvas,
    undo,
    redo,
    resizeCanvas,
    loadDrawing,
    mountCanvas,
    captureDrawing,
    captureAllDrawings,
    setStoredDrawing,
    setCanvasParent,
  }
}
