import { animate, hover } from 'motion'
import type { ObjectDirective } from 'vue'

const cleanups = new WeakMap<HTMLElement, () => void>()

/** Motion filters synthetic touch hover and smoothly interrupts rapid pointer changes. */
function attachMenuMotion(element: HTMLElement) {
  if (cleanups.has(element)) return
  element.classList.add('ui-menu-item')
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  let hovered = false
  let focused = false
  let animation: ReturnType<typeof animate> | undefined
  function update() {
    animation?.stop()
    if (media.matches) {
      element.style.transform = ''
      return
    }
    animation = animate(
      element,
      { x: hovered || focused ? 3 : 0 },
      { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
    )
  }
  const stopHover = hover(element, () => {
    if (element.matches(':disabled, [data-disabled]')) return
    hovered = true
    update()
    return () => {
      hovered = false
      update()
    }
  })
  function onFocus() {
    focused = element.matches(':focus-visible')
    update()
  }
  function onBlur() {
    focused = false
    update()
  }
  element.addEventListener('focus', onFocus)
  element.addEventListener('blur', onBlur)
  media.addEventListener('change', update)
  cleanups.set(element, () => {
    stopHover()
    animation?.stop()
    element.removeEventListener('focus', onFocus)
    element.removeEventListener('blur', onBlur)
    media.removeEventListener('change', update)
  })
}
function detachMenuMotion(element: HTMLElement) {
  cleanups.get(element)?.()
  cleanups.delete(element)
}

export const vMenuMotion: ObjectDirective<HTMLElement> = {
  mounted: attachMenuMotion,
  beforeUnmount: detachMenuMotion,
}

/** One entry point also covers menus created later, including plugin panels. */
export function installMenuMotion(root: HTMLElement) {
  const selector = '[data-ui-menu] > button, .soft-menu-item, .toolbar-more-menu > button'
  const managed = new Set<HTMLElement>()
  function visit(node: Node, action: (element: HTMLElement) => void) {
    if (!(node instanceof HTMLElement)) return
    if (node.matches(selector)) action(node)
    node.querySelectorAll<HTMLElement>(selector).forEach(action)
  }
  function attach(element: HTMLElement) {
    attachMenuMotion(element)
    managed.add(element)
  }
  visit(root, attach)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach((node) =>
        visit(node, (element) => {
          if (root.contains(element)) return
          detachMenuMotion(element)
          managed.delete(element)
        }),
      )
      record.addedNodes.forEach((node) => visit(node, attach))
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    managed.forEach(detachMenuMotion)
    managed.clear()
  }
}
