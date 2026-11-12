/** Native dialogs also receive clicks on their padding and ::backdrop. */
export function useDialogBackdropClose(close: () => void) {
  let startedOnBackdrop = false

  function isBackdrop(event: MouseEvent): boolean {
    const dialog = event.currentTarget
    if (!(dialog instanceof HTMLDialogElement) || event.target !== dialog) return false
    const bounds = dialog.getBoundingClientRect()
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
  }

  function onBackdropPointerDown(event: PointerEvent) {
    startedOnBackdrop = event.isPrimary && event.button === 0 && isBackdrop(event)
  }

  function onBackdropPointerCancel() {
    startedOnBackdrop = false
  }

  function onBackdropClick(event: MouseEvent) {
    const shouldClose = startedOnBackdrop && event.detail > 0 && isBackdrop(event)
    startedOnBackdrop = false
    if (shouldClose) close()
  }

  return { onBackdropPointerDown, onBackdropPointerCancel, onBackdropClick }
}
