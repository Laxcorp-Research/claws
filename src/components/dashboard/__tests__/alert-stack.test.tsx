// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AlertStack, type AlertStackItem } from "@/components/dashboard/alert-stack"

afterEach(() => cleanup())

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
  it("orders all eight cockpit alerts by priority with container-down first", () => {
    render(
      <AlertStack
        alerts={[
          item("version-update", 7),
          item("drift", 6),
          item("session-dead", 5),
          item("connection-expired", 4),
          item("sync-stale", 3),
          item("near-cap", 2),
          item("silence", 1),
          item("container-down", 0),
        ]}
      />,
    )

    expect(screen.getByText("container-down message")).toBeDefined()
    expect(screen.queryByText("version-update message")).toBeNull()
    expect(screen.getByRole("button", { name: "7 more alerts" })).toBeDefined()
  })

  it("reveals remaining alerts and keeps each CTA wired", () => {
    const second = vi.fn()
    render(<AlertStack alerts={[item("container-down", 0), item("silence", 1, second)]} />)

    fireEvent.click(screen.getByRole("button", { name: "1 more alert" }))
    fireEvent.click(screen.getByRole("button", { name: "silence CTA" }))

    expect(screen.getByText("silence message")).toBeDefined()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("renders no expander for a single alert", () => {
    render(<AlertStack alerts={[item("container-down", 0)]} />)

    expect(screen.queryByRole("button", { name: /more alert/ })).toBeNull()
  })
})
