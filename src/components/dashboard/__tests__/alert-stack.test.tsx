// @vitest-environment jsdom
/**
 * Batch E — AlertStack total order + N-more expander.
 * MUTATION: swap any two adjacent priorities in TOTAL_ORDER → fail.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AlertStack, type AlertStackItem } from "@/components/dashboard/alert-stack"

afterEach(() => cleanup())

/** Batch E unique total order (must match dashboard page priorities). */
const TOTAL_ORDER: Array<{ id: string; priority: number }> = [
  { id: "container-down", priority: 0 },
  { id: "credits-exhausted", priority: 1 },
  { id: "spend-limit", priority: 2 },
  { id: "trial-expired", priority: 3 },
  { id: "silence", priority: 4 },
  { id: "near-cap", priority: 5 },
  { id: "sync-stale", priority: 6 },
  { id: "connection-expired", priority: 7 },
  { id: "session-dead", priority: 8 },
  { id: "spend-warning", priority: 9 },
  { id: "trial-active", priority: 10 },
  { id: "lifecycle", priority: 11 },
  { id: "drift", priority: 12 },
  { id: "version-update", priority: 13 },
]

function item(id: string, priority: number, cta = vi.fn()): AlertStackItem {
  return {
    id,
    priority,
    variant: priority === 0 ? "error" : "warning",
    message: `${id} message`,
    cta: <button onClick={cta}>{id} CTA</button>,
  }
}

describe("AlertStack", () => {
  it("TOTAL_ORDER is unique and strictly increasing (adjacent-swap mutation)", () => {
    const priorities = TOTAL_ORDER.map((e) => e.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
    for (let i = 0; i < priorities.length - 1; i++) {
      expect(
        priorities[i],
        `adjacent swap would break: ${TOTAL_ORDER[i].id} (${priorities[i]}) vs ${TOTAL_ORDER[i + 1].id} (${priorities[i + 1]})`,
      ).toBeLessThan(priorities[i + 1])
    }
  })

  it("orders cockpit alerts by Batch E priorities with container-down first", () => {
    // K1 eight + money insertions — shuffled input, container-down primary.
    render(
      <AlertStack
        alerts={[
          item("version-update", 13),
          item("drift", 12),
          item("trial-active", 10),
          item("spend-warning", 9),
          item("session-dead", 8),
          item("connection-expired", 7),
          item("sync-stale", 6),
          item("near-cap", 5),
          item("silence", 4),
          item("container-down", 0),
        ]}
      />,
    )

    expect(screen.getByText("container-down message")).toBeDefined()
    expect(screen.queryByText("version-update message")).toBeNull()
    expect(screen.getByRole("button", { name: "9 more alerts" })).toBeDefined()
  })

  it("spend-limit (money) outranks silence (informational) as primary", () => {
    render(
      <AlertStack
        alerts={[
          item("silence", 4),
          item("spend-limit", 2),
        ]}
      />,
    )
    expect(screen.getByText("spend-limit message")).toBeDefined()
    expect(screen.queryByText("silence message")).toBeNull()
    expect(screen.getByRole("button", { name: "1 more alert" })).toBeDefined()
  })

  it("reveals remaining alerts and keeps each CTA wired", () => {
    const second = vi.fn()
    render(<AlertStack alerts={[item("container-down", 0), item("silence", 4, second)]} />)

    fireEvent.click(screen.getByRole("button", { name: "1 more alert" }))
    fireEvent.click(screen.getByRole("button", { name: "silence CTA" }))

    expect(screen.getByText("silence message")).toBeDefined()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("collapsed expander shows N more alerts; expanded shows Show less (never stale N-more)", () => {
    render(
      <AlertStack
        alerts={[item("container-down", 0), item("silence", 4), item("near-cap", 5)]}
      />,
    )

    const expander = screen.getByRole("button", { name: "2 more alerts" })
    expect(expander.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(expander)

    const collapse = screen.getByRole("button", { name: "Show less" })
    expect(collapse.getAttribute("aria-expanded")).toBe("true")
    expect(screen.queryByRole("button", { name: /more alert/ })).toBeNull()
    expect(screen.getByText("silence message")).toBeDefined()
    expect(screen.getByText("near-cap message")).toBeDefined()

    fireEvent.click(collapse)
    expect(screen.getByRole("button", { name: "2 more alerts" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull()
  })

  it("renders no expander for a single alert", () => {
    render(<AlertStack alerts={[item("container-down", 0)]} />)

    expect(screen.queryByRole("button", { name: /more alert/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull()
  })
})
