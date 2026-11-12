import gsap from 'gsap'

export function useInlineReveal(getHeight?: () => number) {
  function clearReveal(el: Element) {
    gsap.killTweensOf(el)
    gsap.set(el, { clearProps: 'height,opacity,transform,overflow,marginBottom' })
    if (getHeight) gsap.set(el, { height: getHeight() })
  }

  function enterReveal(el: Element, done: () => void) {
    gsap.killTweensOf(el)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clearReveal(el)
      done()
      return
    }
    const height = getHeight ? getHeight() : (el as HTMLElement).scrollHeight
    const marginBottom = getComputedStyle(el).marginBottom
    gsap.fromTo(el, { height: 0, opacity: 0, y: -4, marginBottom: 0, overflow: 'hidden' }, {
      height, opacity: 1, y: 0, marginBottom,
      duration: 0.22, ease: 'power2.out',
      onComplete: () => { clearReveal(el); done() },
    })
  }

  function leaveReveal(el: Element, done: () => void) {
    gsap.killTweensOf(el)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done()
      return
    }
    gsap.set(el, { height: (el as HTMLElement).getBoundingClientRect().height, overflow: 'hidden' })
    gsap.to(el, { height: 0, opacity: 0, y: -4, marginBottom: 0, duration: 0.16,
      ease: 'power2.inOut', onComplete: done })
  }

  return { enterReveal, leaveReveal, clearReveal }
}
