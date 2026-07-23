import { fireEvent, screen } from "@testing-library/react"

/** jsdom lacks pointer-capture APIs that Radix DropdownMenu uses. */
export function installRadixPointerPolyfills() {
  const proto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (id: number) => boolean
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {}
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {}
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
}

/** Open a Radix dropdown via pointer events (click alone is flaky in jsdom). */
export function openWorkspaceOptionsMenu() {
  const trigger = screen.getByLabelText("Workspace options")
  fireEvent.pointerDown(trigger, { button: 0, ctrl: 0 })
  fireEvent.pointerUp(trigger, { button: 0, ctrl: 0 })
  fireEvent.click(trigger)
}
