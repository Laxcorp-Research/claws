// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mockWidth(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => clientWidth })
}

describe("TruncatedText", () => {
  it("does not attach tooltip semantics when text is not truncated", async () => {
    mockWidth(80, 120)
    render(<TruncatedText>Short name</TruncatedText>)

    fireEvent.mouseEnter(screen.getByText("Short name"))
    await new Promise((resolve) => setTimeout(resolve, 360))
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
  })

  it("attaches tooltip only when text is actually truncated", async () => {
    mockWidth(240, 80)
    render(<TruncatedText>Very long clipped agent name</TruncatedText>)

    fireEvent.mouseEnter(screen.getByText("Very long clipped agent name"))
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Very long clipped agent name")
  })
})
