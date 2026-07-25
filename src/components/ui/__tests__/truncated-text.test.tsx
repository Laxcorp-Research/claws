// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TruncatedText, measureTruncation } from "@/components/ui/truncate-with-tooltip"
import { Tooltip } from "@/components/ui/tooltip"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

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

/** Radix Tooltip opens on pointermove (mouse), not mouseenter. */
function openTip(el: Element) {
  fireEvent.pointerMove(el, { pointerType: "mouse" })
}

describe("measureTruncation", () => {
  it("returns true when natural width exceeds container content-box by >1px", () => {
    const measure = { offsetWidth: 120 } as HTMLElement
    const container = {
      clientWidth: 100,
      // getComputedStyle mocked below
    } as HTMLElement
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0px",
      paddingRight: "0px",
    } as CSSStyleDeclaration)
    expect(measureTruncation(measure, container)).toBe(true)
  })

  it("returns false when text fits (within 1px tolerance)", () => {
    const measure = { offsetWidth: 100 } as HTMLElement
    const container = { clientWidth: 100 } as HTMLElement
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0px",
      paddingRight: "0px",
    } as CSSStyleDeclaration)
    expect(measureTruncation(measure, container)).toBe(false)
  })
})

describe("TruncatedText policy (post-#293)", () => {
  it("tips when measuring span reports truncation", async () => {
    // Force measure: measuring span wider than wrap.
    const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")
    const origClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.getAttribute("aria-hidden") === "true" || this.closest?.("[aria-hidden='true']")) {
          return 200
        }
        // Inner measure span child
        if (this.parentElement?.getAttribute("aria-hidden") === "true") return 200
        return 80
      },
    })
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 80
      },
    })

    try {
      await act(async () => {
        render(
          <div style={{ width: 80 }}>
            <TruncatedText>Trend & Topic Scanner That Truncates</TruncatedText>
          </div>,
        )
      })

      await waitFor(() => {
        const el = document.querySelector("[data-truncated='true']")
        expect(el?.textContent).toContain("Trend & Topic Scanner That Truncates")
      })

      const trigger = document.querySelector("[data-tooltip-trigger]")
      expect(trigger).toBeTruthy()
      openTip(trigger!)
      await new Promise((resolve) => setTimeout(resolve, 360))
      expect((await screen.findByRole("tooltip")).textContent).toContain("Trend & Topic Scanner")
    } finally {
      if (origOffset) Object.defineProperty(HTMLElement.prototype, "offsetWidth", origOffset)
      else delete (HTMLElement.prototype as unknown as { offsetWidth?: unknown }).offsetWidth
      if (origClient) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClient)
    }
  })

  it("does NOT tip when text fits the container", async () => {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 40
      },
    })
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 200
      },
    })

    await act(async () => {
      render(<TruncatedText>Short name</TruncatedText>)
    })

    await waitFor(() => {
      const el = document.querySelector("[data-truncated='false']")
      expect(el?.textContent).toContain("Short name")
    })
    expect(document.querySelector("[data-tooltip-trigger]")).toBeNull()
    const visible = document.querySelector("[data-truncated='false']")
    expect(visible).toBeTruthy()
    openTip(visible!)
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("MUTATION-anchored: tip gated on measured truncation (no ALWAYS_TIP / disabled=false)", () => {
    const src = readFileSync(resolve(__dirname, "../truncate-with-tooltip.tsx"), "utf8")
    expect(src).toContain("measureTruncation")
    expect(src).toContain("showTip")
    expect(src).not.toContain("ALWAYS_TIP_ASSERT")
    expect(src).not.toContain("disabled={false}")
    // Trigger sizes to content, not unconditional w-full on the Tooltip wrapper default path.
    expect(src).toContain('triggerClassName="inline-block w-max max-w-full min-w-0"')
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
    expect(triggerWrap.contains(tip)).toBe(false)
  })

  it("does not kill an open tip when disabled() later flips true", async () => {
    let disabled = false
    const { rerender } = render(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )

    openTip(screen.getByText("Engagement Strat...").parentElement!)
    expect(await screen.findByRole("tooltip")).toBeTruthy()

    disabled = true
    rerender(
      <Tooltip content="Engagement Strategist" maxWidth={300} delay={0} disabled={() => disabled}>
        <span>Engagement Strat...</span>
      </Tooltip>,
    )
    expect(screen.getByRole("tooltip")).toBeTruthy()
  })

  it("engine source: sideOffset=0, no !visible, align default center", () => {
    const src = readFileSync(resolve(__dirname, "../tooltip.tsx"), "utf8")
    expect(src).toContain("sideOffset={0}")
    expect(src).not.toMatch(/className="[^"]*!visible[^"]*"/)
    expect(src).toMatch(/align\s*=\s*"center"/)
    expect(src).toMatch(/from\s+["']@radix-ui\/react-tooltip["']/)
  })
})
