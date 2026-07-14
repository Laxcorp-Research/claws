// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { Tooltip } from "@/components/ui/tooltip"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(() => {
  // Flush post-layout rAF synchronously so overflow state settles in unit tests.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0)
    return 1
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
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
    await act(async () => {
      render(<TruncatedText>Very long clipped agent name</TruncatedText>)
    })

    fireEvent.mouseEnter(screen.getByText("Very long clipped agent name"))
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Very long clipped agent name")
  })

  it("MUTATION-anchored: schedules post-layout remeasure via requestAnimationFrame", async () => {
    const rafSpy = window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>
    mockWidth(240, 80)
    await act(async () => {
      render(<TruncatedText>Post-layout clipped name that must ellipsize</TruncatedText>)
    })

    // MUTATION: remove rAF schedule in TruncatedText → this assertion fails.
    expect(rafSpy).toHaveBeenCalled()

    fireEvent.mouseEnter(screen.getByText("Post-layout clipped name that must ellipsize"))
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Post-layout clipped name that must ellipsize")
  })
})

describe("Tooltip measured-width positioning", () => {
  it("centers bubble on trigger via left=center + translateX(-50%)", async () => {
    const triggerRect = {
      left: 200,
      width: 40,
      top: 100,
      bottom: 120,
      right: 240,
      height: 20,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    }

    await act(async () => {
      render(
        <Tooltip content="hi" maxWidth={300} delay={0}>
          <span>trigger</span>
        </Tooltip>,
      )
    })

    const triggerWrap = screen.getByText("trigger").parentElement!
    vi.spyOn(triggerWrap, "getBoundingClientRect").mockReturnValue(triggerRect as DOMRect)

    fireEvent.mouseEnter(triggerWrap)
    const tip = await screen.findByRole("tooltip")
    const left = Number.parseFloat((tip as HTMLElement).style.left || "0")
    const transform = (tip as HTMLElement).style.transform
    // MUTATION: revert to left = triggerCenter - maxWidth/2 without translateX(-50%) → fails.
    expect(left).toBe(220) // trigger center
    expect(transform).toContain("translate(-50%")
  })
})
