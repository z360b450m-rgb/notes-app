import gsap from 'gsap'

function safeDone(done: () => void): () => void {
  let called = false
  return () => {
    if (!called) {
      called = true
      done()
    }
  }
}

function resolveOverlay(el: Element): HTMLElement | null {
  if (el.matches('.modal-overlay')) return el as HTMLElement
  return el.querySelector('.modal-overlay') as HTMLElement | null
}

export function useModalAnimations() {
  const running = new WeakMap<Element, gsap.core.Timeline>()
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function enterModal(el: Element, done: () => void) {
    const overlay = resolveOverlay(el)
    const dialog = el.querySelector('.modal-dialog') as HTMLElement | null
    running.get(el)?.kill()
    if (reducedMotion()) {
      if (overlay) gsap.set(overlay, { opacity: 1 })
      if (dialog) gsap.set(dialog, { opacity: 1, scale: 1, y: 0 })
      done()
      return
    }

    const finish = safeDone(done)
    const timeout = setTimeout(finish, 1000)

    if (!overlay && !dialog) {
      clearTimeout(timeout)
      finish()
      return
    }

    try {
      const tl = gsap.timeline({
        onComplete: () => {
          clearTimeout(timeout)
          finish()
        },
      })
      running.set(el, tl)

      if (overlay) {
        tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out' }, 0)
      }

      if (dialog) {
        tl.fromTo(
          dialog,
          { opacity: 0, scale: 0.98, y: 8 },
          { opacity: 1, scale: 1, y: 0, duration: 0.22, ease: 'power2.out' },
          0,
        )
      }
    } catch {
      clearTimeout(timeout)
      finish()
    }
  }

  function leaveModal(el: Element, done: () => void) {
    const overlay = resolveOverlay(el)
    const dialog = el.querySelector('.modal-dialog') as HTMLElement | null
    running.get(el)?.kill()
    if (reducedMotion()) {
      done()
      return
    }

    const finish = safeDone(done)
    const timeout = setTimeout(finish, 500)

    if (!overlay && !dialog) {
      clearTimeout(timeout)
      finish()
      return
    }

    try {
      const tl = gsap.timeline({
        onComplete: () => {
          clearTimeout(timeout)
          finish()
        },
      })
      running.set(el, tl)

      if (dialog) {
        tl.to(dialog, { opacity: 0, scale: 0.98, y: 8, duration: 0.14, ease: 'power2.in' }, 0)
      }
      if (overlay) {
        tl.to(overlay, { opacity: 0, duration: 0.18, ease: 'power2.in' }, 0)
      }
    } catch {
      clearTimeout(timeout)
      finish()
    }
  }

  return { enterModal, leaveModal }
}
