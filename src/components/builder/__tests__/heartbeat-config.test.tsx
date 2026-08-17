// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { useBuilderStore } from "@/stores/builder-store"

vi.mock("@/components/builder/custom-select", () => ({
  CustomSelect: ({
    value,
    onChange,
    options,
  }: {
    value: string
    onChange: (v: string) => void
    options: Array<{ value: string; label: string }>
  }) => (
    <div
      data-testid={`select-${options[0]?.value === "06:00" ? "time" : "freq"}`}
      data-value={value}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("HeartbeatConfig — template schedule copy", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      heartbeatSchedule: {
        frequency: "custom",
        time: "08:00",
        customWindowCount: 2,
      },
    })
  })

  it("shows Runs on its template schedule (N windows/day) — not Off", () => {
    render(<HeartbeatConfig />)
    expect(screen.getAllByText("Runs on its template schedule (2 windows/day)").length).toBeGreaterThan(0)
    expect(screen.queryByText(/HEARTBEAT\.md/)).toBeNull()
    expect(screen.queryByText(/MD cron/)).toBeNull()
    const freq = screen.getByTestId("select-freq")
    expect(freq.getAttribute("data-value")).toBe("custom")
    expect(freq.getAttribute("data-value")).not.toBe("off")
  })

  it("changing away from custom requires confirm; cancel keeps custom", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<HeartbeatConfig />)
    fireEvent.click(screen.getByRole("button", { name: "Daily" }))
    expect(confirmSpy).toHaveBeenCalledWith("Replace the template schedule with Daily?")
    expect(useBuilderStore.getState().heartbeatSchedule.frequency).toBe("custom")
  })

  it("confirming frequency change leaves custom", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<HeartbeatConfig />)
    fireEvent.click(screen.getByRole("button", { name: "Daily" }))
    expect(useBuilderStore.getState().heartbeatSchedule.frequency).toBe("daily")
    expect(useBuilderStore.getState().heartbeatSchedule.customWindowCount).toBeNull()
  })
})
