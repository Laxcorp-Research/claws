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
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0)
    return 1
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
})

function mockWidth(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => clientWidth })
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => clientWidth })
}

describe("TruncatedText", () => {
  it("ALWAYS tips on hover — even when scrollWidth false-negatives (SS2)", async () => {
    // Chromium ellipsis with scrollWidth === clientWidth must still tip.
    mockWidth(80, 80)
    await act(async () => {
      render(<TruncatedText>Trend & Topic Scanner</TruncatedText>)
    })

    fireEvent.mouseEnter(screen.getByText("Trend & Topic Scanner").parentElement!)
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Trend & Topic Scanner")
  })

  it("tips for short names too (always-on TruncatedText contract)", async () => {
    mockWidth(80, 120)
    render(<TruncatedText>Short name</TruncatedText>)

    fireEvent.mouseEnter(screen.getByText("Short name").parentElement!)
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Short name")
  })

  it("MUTATION-anchored: ALWAYS_TIP_ASSERT present; disabled={false} on Tooltip", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const src = readFileSync(resolve(__dirname, "../truncate-with-tooltip.tsx"), "utf8")
    expect(src).toContain("ALWAYS_TIP_ASSERT")
    expect(src).toContain("disabled={false}")
    // MUTATION: reintroduce overflow-gated disabled={...} → this fails.
    expect(src).not.toMatch(/disabled=\{[^}]*isOverflowing/)
    expect(src).not.toMatch(/disabled=\{isDisabledForTooltip\}/)
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
    expect(left).toBe(220)
    expect(transform).toContain("translate(-50%")
  })

  it("does not kill an open tip when disabled() later false-negatives", async () => {
    let disabled = false
    const { rerender } = render(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )

    fireEvent.mouseEnter(screen.getByText("Engagement Strat...").parentElement!)
    expect(await screen.findByRole("tooltip")).toBeTruthy()

    // Simulate Chromium remasure flipping to "not truncated" after open.
    disabled = true
    rerender(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )
    // Tip must stay — useLayoutEffect must not re-gate on disabled().
    expect(screen.getByRole("tooltip")).toBeTruthy()
  })
})
