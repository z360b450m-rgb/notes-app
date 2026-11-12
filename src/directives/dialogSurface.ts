import type { Directive } from 'vue'

// Specialized dialogs keep their layouts while sharing DOM accessibility behavior.
const cleanups = new WeakMap<HTMLElement, () => void>()
let headingSequence = 0
function focusable(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert], [aria-hidden="true"]'),
  )
}

export const vDialogSurface: Directive<HTMLElement, string | undefined> = {
  mounted(element, binding) {
    const native = element instanceof HTMLDialogElement
    let opener: HTMLElement | null = null
    let openerDialog: HTMLElement | null = null
    let active = false
    element.classList.add('ui-dialog-surface')
    element.setAttribute('role', 'dialog')
    element.setAttribute('aria-modal', 'true')
    if (!element.hasAttribute('tabindex')) element.tabIndex = -1
    const heading = element.querySelector<HTMLElement>('h1, h2, h3')
    if (!element.hasAttribute('aria-labelledby') && heading) {
      if (!heading.id) heading.id = `ui-surface-heading-${++headingSequence}`
      element.setAttribute('aria-labelledby', heading.id)
    } else if (!heading && !element.hasAttribute('aria-label')) {
      element.setAttribute('aria-label', binding.value || '对话框')
    }
    function activate() {
      if (active || (native && !(element as HTMLDialogElement).open)) return
      active = true
      if (native) return // The existing native controller owns opening and return focus.
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      openerDialog = opener?.closest<HTMLElement>('[role="dialog"], dialog[open]') ?? null
      queueMicrotask(() => {
        if (!active || !element.isConnected || element.contains(document.activeElement)) return
        const items = focusable(element)
        const cancel = element.querySelector<HTMLElement>('[data-dialog-cancel]:not(:disabled)')
        const input = items.find(
          (item) =>
            item instanceof HTMLTextAreaElement ||
            (item instanceof HTMLInputElement &&
              !['radio', 'checkbox', 'file', 'hidden'].includes(item.type)),
        )
        const destructive = /删除|卸载|清空/.test(heading?.textContent || '')
        ;(destructive
          ? cancel || items[0] || element
          : input || cancel || items[0] || element
        ).focus()
      })
    }
    function keydown(event: KeyboardEvent) {
      if (!active || event.defaultPrevented) return
      const nestedDialog =
        event.target instanceof Element
          ? event.target.closest('[role="dialog"], dialog[open]')
          : null
      if (nestedDialog && nestedDialog !== element) return
      if (event.key === 'Escape' && !native) {
        const cancel = element.querySelector<HTMLButtonElement>(
          'button[data-dialog-cancel]:not(:disabled)',
        )
        if (cancel) {
          event.preventDefault()
          event.stopPropagation()
          cancel.click()
        }
      } else if (event.key === 'Tab') {
        const items = focusable(element),
          first = items[0],
          last = items.at(-1)
        if (!first || !last) {
          event.preventDefault()
          element.focus()
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === element)
        ) {
          event.preventDefault()
          last.focus()
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === element)
        ) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    const observer = native
      ? new MutationObserver(() => {
          if ((element as HTMLDialogElement).open) activate()
          else active = false
        })
      : null
    observer?.observe(element, { attributes: true, attributeFilter: ['open'] })
    element.addEventListener('keydown', keydown)
    activate()
    cleanups.set(element, () => {
      active = false
      observer?.disconnect()
      element.removeEventListener('keydown', keydown)
      if (
        !native &&
        (element.contains(document.activeElement) || document.activeElement === document.body)
      ) {
        const target = opener?.isConnected
          ? opener
          : openerDialog?.isConnected
            ? focusable(openerDialog)[0] || openerDialog
            : null
        target?.focus({ preventScroll: true })
      }
    })
  },
  beforeUnmount(element) {
    cleanups.get(element)?.()
    cleanups.delete(element)
  },
}
