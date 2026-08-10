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

describe("HeartbeatConfig — custom MD cron truth", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      heartbeatSchedule: {
        frequency: "custom",
        time: "08:00",
        customWindowCount: 2,
      },
    })
  })

  it("shows Custom (N windows) and drift banner — not Off", () => {
    render(<HeartbeatConfig />)
    expect(screen.getByText("Custom (2 windows)")).toBeTruthy()
    expect(screen.getByText(/Armed via MD cron windows/)).toBeTruthy()
    const freq = screen.getByTestId("select-freq")
    expect(freq.getAttribute("data-value")).toBe("custom")
    expect(freq.getAttribute("data-value")).not.toBe("off")
  })

  it("changing away from custom requires confirm; cancel keeps custom", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<HeartbeatConfig />)
    fireEvent.click(screen.getByRole("button", { name: "Daily" }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(String(confirmSpy.mock.calls[0][0])).toMatch(/custom cron schedule/i)
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
