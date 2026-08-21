// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { serializeSchedule } from "@/lib/schedule/persist"
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
    <div data-testid={`select-${options[0]?.value ?? "x"}`} data-value={value}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}>
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

describe("HeartbeatConfig - hydrated template is the selected value", () => {
  beforeEach(() => {
    const ser = serializeSchedule({
      mode: "times",
      tz: "UTC",
      slots: [
        { hour: 8, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] },
        { hour: 21, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ],
    })
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: {
        frequency: ser.heartbeatFrequency ?? "times",
        time: ser.heartbeatTime ?? "{}",
      },
    })
  })

  it("selects Custom times - not Off, no template-schedule banner", () => {
    render(<HeartbeatConfig />)
    expect(screen.queryByText(/Runs on its template schedule/)).toBeNull()
    expect(screen.queryByText(/HEARTBEAT\.md/)).toBeNull()
    expect(screen.getByText("Custom times")).toBeTruthy()
    const freq = screen.getByTestId("select-off")
    expect(freq.getAttribute("data-value")).toBe("times")
    expect(freq.getAttribute("data-value")).not.toBe("off")
  })

  it("renders native time inputs so odd minutes (:43) are authorable", () => {
    render(<HeartbeatConfig />)
    const times = screen.getAllByLabelText(/Custom time/)
    expect(times.length).toBe(2)
    expect(times[0].getAttribute("type")).toBe("time")
  })
})
