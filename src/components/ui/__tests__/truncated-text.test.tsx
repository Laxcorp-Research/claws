// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

/** Radix Tooltip opens on pointermove (mouse), not mouseenter. */
function openTip(el: Element) {
  fireEvent.pointerMove(el, { pointerType: "mouse" })
}

describe("TruncatedText", () => {
  it("ALWAYS tips on hover — even when scrollWidth false-negatives (SS2)", async () => {
    // Chromium ellipsis with scrollWidth === clientWidth must still tip.
    mockWidth(80, 80)
    await act(async () => {
      render(<TruncatedText>Trend & Topic Scanner</TruncatedText>)
    })

    openTip(screen.getByText("Trend & Topic Scanner").parentElement!)
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Trend & Topic Scanner")
  })

  it("tips for short names too (always-on TruncatedText contract)", async () => {
    mockWidth(80, 120)
    render(<TruncatedText>Short name</TruncatedText>)

    openTip(screen.getByText("Short name").parentElement!)
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

describe("Tooltip Radix engine", () => {
  it("portals tip with role=tooltip on hover", async () => {
    await act(async () => {
      render(
        <Tooltip content="hi" maxWidth={300} delay={0}>
          <span>trigger</span>
        </Tooltip>,
      )
    })

    const triggerWrap = screen.getByText("trigger").parentElement!
    openTip(triggerWrap)
    const tip = await screen.findByRole("tooltip")
    expect(tip.textContent).toContain("hi")
    // Portal: tip is not inside the trigger wrapper.
    expect(triggerWrap.contains(tip)).toBe(false)
  })

  it("does not kill an open tip when disabled() later false-negatives", async () => {
    let disabled = false
    const { rerender } = render(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )

    openTip(screen.getByText("Engagement Strat...").parentElement!)
    expect(await screen.findByRole("tooltip")).toBeTruthy()

    // Simulate Chromium remasure flipping to "not truncated" after open.
    disabled = true
    rerender(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )
    // Tip must stay — open state must not re-gate on disabled() after open.
    expect(screen.getByRole("tooltip")).toBeTruthy()
  })

  it("engine source uses align default start (wide TruncatedText anchors)", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const src = readFileSync(resolve(__dirname, "../tooltip.tsx"), "utf8")
    expect(src).toMatch(/align\s*=\s*"start"/)
    expect(src).toMatch(/from\s+["']@radix-ui\/react-tooltip["']/)
  })
})
