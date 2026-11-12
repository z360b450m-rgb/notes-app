import { onBeforeUnmount, ref } from 'vue'

const WIDTH_KEY = 'cuotiben:sidebar-width:v1'
const DEFAULT_WIDTH = 280

export function useSidebarWidth() {
  const sidebarWidth = ref(DEFAULT_WIDTH)
  const resizingSidebar = ref(false)
  let handle: HTMLElement | null = null
  let pointerId = -1
  let startX = 0
  let startWidth = DEFAULT_WIDTH
  let previousCursor = ''
  let previousUserSelect = ''

  function clamp(width: number) {
    return Math.max(220, Math.min(width, 480, Math.max(220, window.innerWidth - 420)))
  }

  try {
    const stored = localStorage.getItem(WIDTH_KEY)
    if (stored && Number.isFinite(Number(stored))) sidebarWidth.value = clamp(Number(stored))
  } catch {
    /* Layout remains usable when storage is unavailable. */
  }

  function saveWidth() {
    try {
      localStorage.setItem(WIDTH_KEY, String(sidebarWidth.value))
    } catch {
      /* Optional preference. */
    }
  }

  function stopSidebarResize() {
    if (!resizingSidebar.value) return
    resizingSidebar.value = false
    window.removeEventListener('blur', stopSidebarResize)
    if (handle?.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    handle = null
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    saveWidth()
  }

  function startSidebarResize(event: PointerEvent) {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return
    event.preventDefault()
    handle = event.currentTarget
    pointerId = event.pointerId
    startX = event.clientX
    startWidth = sidebarWidth.value
    previousCursor = document.body.style.cursor
    previousUserSelect = document.body.style.userSelect
    resizingSidebar.value = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    handle.setPointerCapture(pointerId)
    window.addEventListener('blur', stopSidebarResize)
  }

  function moveSidebarResize(event: PointerEvent) {
    if (resizingSidebar.value && event.pointerId === pointerId) {
      sidebarWidth.value = clamp(startWidth + event.clientX - startX)
    }
  }

  function resizeSidebarByKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    sidebarWidth.value = clamp(
      event.key === 'Home'
        ? DEFAULT_WIDTH
        : sidebarWidth.value + (event.key === 'ArrowRight' ? 10 : -10),
    )
    saveWidth()
  }

  onBeforeUnmount(stopSidebarResize)
  return {
    sidebarWidth,
    resizingSidebar,
    startSidebarResize,
    moveSidebarResize,
    stopSidebarResize,
    resizeSidebarByKey,
  }
}
