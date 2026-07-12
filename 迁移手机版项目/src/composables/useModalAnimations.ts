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
  function enterModal(el: Element, done: () => void) {
    const overlay = resolveOverlay(el)
    const dialog = el.querySelector('.modal-dialog') as HTMLElement | null

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

      if (overlay) {
        tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out' }, 0)
      }

      if (dialog) {
        tl.fromTo(
          dialog,
          { opacity: 0, scale: 0.92, y: 12 },
          { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: 'back.out(1.5)' },
          overlay ? 0.04 : 0,
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

      if (dialog) {
        tl.to(dialog, { opacity: 0, scale: 0.95, duration: 0.15, ease: 'power2.in' }, 0)
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
