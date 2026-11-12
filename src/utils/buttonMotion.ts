/** Delegation also covers dialogs and plugin buttons mounted later. */
export function installButtonMotion() {
  const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>()
  const active = new Set<HTMLButtonElement>()
  function target(event: Event) {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    return button instanceof HTMLButtonElement &&
      !button.disabled &&
      !button.classList.contains('ui-switch') &&
      !button.style.background &&
      !button.style.backgroundColor
      ? button
      : null
  }
  function press(button: HTMLButtonElement) {
    clearTimeout(timers.get(button))
    active.add(button)
    button.classList.add('ui-pressing')
  }
  function release() {
    active.forEach((button) => {
      timers.set(
        button,
        setTimeout(() => button.classList.remove('ui-pressing'), 90),
      )
    })
    active.clear()
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = target(event)
      if (button && event.button === 0) press(button)
    },
    true,
  )
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
  window.addEventListener('blur', release)
  document.addEventListener(
    'keydown',
    (event) => {
      const button = target(event)
      if (button && !event.repeat && (event.key === ' ' || event.key === 'Enter')) press(button)
    },
    true,
  )
  document.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') release()
  })
  document.addEventListener('focusout', release, true)
}
