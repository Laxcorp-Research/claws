// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { serializeSchedule } from "@/lib/schedule/persist"
import { useBuilderStore } from "@/stores/builder-store"

/**
 * Pin the BROWSER timezone to Asia/Dubai (GST, UTC+4, no DST) without touching
 * real tz math: only Intl.DateTimeFormat constructions that do NOT pass an
 * explicit timeZone (i.e. "what zone is this browser in?" probes) get their
 * resolvedOptions().timeZone spoofed. Conversions that pass an explicit zone
 * run against the real ICU database.
 */
function pinBrowserTz(tz: string) {
  const RealDTF = Intl.DateTimeFormat
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    const inst = new RealDTF(...args)
    if (!args[1]?.timeZone) {
      const orig = inst.resolvedOptions.bind(inst)
      inst.resolvedOptions = () => ({ ...orig(), timeZone: tz })
    }
    return inst
  } as never)
}

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

describe("HeartbeatConfig - custom times are typed in the browser's local tz, stored in UTC (D6)", () => {
  function seedTimes(slotHour: number, slotMinute = 0) {
    const ser = serializeSchedule({
      mode: "times",
      tz: "UTC",
      slots: [{ hour: slotHour, minute: slotMinute, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
    })
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: {
        frequency: ser.heartbeatFrequency ?? "times",
        time: ser.heartbeatTime ?? "{}",
      },
    })
  }

  function storedTimes(): { slots: Array<{ hour: number; minute: number; weekdays: number[] }>; tz: string } {
    return JSON.parse(useBuilderStore.getState().heartbeatSchedule.time)
  }

  it("stores hour:15 UTC when a Dubai (+04) browser types 19:00 (local→UTC on save)", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimes(12)
    render(<HeartbeatConfig />)

    fireEvent.change(screen.getByLabelText("Custom time 1"), { target: { value: "19:00" } })

    const stored = storedTimes()
    expect(stored.tz).toBe("UTC")
    expect(stored.slots[0].hour).toBe(15)
    expect(stored.slots[0].minute).toBe(0)
    // 19:00 Dubai = 15:00Z same calendar day: the weekday set must not rotate.
    expect(stored.slots[0].weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("renders a stored hour:15 UTC slot as 19:00 for a Dubai (+04) browser (UTC→local on render)", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimes(15)
    render(<HeartbeatConfig />)

    const input = screen.getByLabelText("Custom time 1") as HTMLInputElement
    expect(input.value).toBe("19:00")
  })

  it("round-trips: after typing 19:00 the re-rendered input still reads 19:00", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimes(12)
    render(<HeartbeatConfig />)

    fireEvent.change(screen.getByLabelText("Custom time 1"), { target: { value: "19:00" } })

    const input = screen.getByLabelText("Custom time 1") as HTMLInputElement
    expect(input.value).toBe("19:00")
    expect(storedTimes().slots[0].hour).toBe(15)
  })
})
