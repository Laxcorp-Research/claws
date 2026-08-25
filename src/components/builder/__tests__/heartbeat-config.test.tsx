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

type StoredTimesPayload = {
  slots: Array<{ hour: number; minute: number; weekdays: number[] }>
  tz: string
  authoredTz?: string
}

function seedTimesJson(payload: StoredTimesPayload) {
  useBuilderStore.setState({
    workspaceTimezone: "UTC",
    heartbeatSchedule: { frequency: "times", time: JSON.stringify(payload) },
  })
}

function storedTimesJson(): StoredTimesPayload {
  return JSON.parse(useBuilderStore.getState().heartbeatSchedule.time)
}

describe("HeartbeatConfig - local-time matrix (browser in, UTC stored, local out)", () => {
  it("UTC browser: typed 19:00 stores hour:19 tz UTC authoredTz UTC and re-renders 19:00", () => {
    pinBrowserTz("UTC")
    seedTimesJson({ slots: [{ hour: 12, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }], tz: "UTC" })
    render(<HeartbeatConfig />)

    fireEvent.change(screen.getByLabelText("Custom time 1"), { target: { value: "19:00" } })

    const stored = storedTimesJson()
    expect(stored.tz).toBe("UTC")
    expect(stored.authoredTz).toBe("UTC")
    expect(stored.slots[0].hour).toBe(19)
    expect((screen.getByLabelText("Custom time 1") as HTMLInputElement).value).toBe("19:00")
  })

  it("America/Los_Angeles (PDT, Aug): typed 19:00 stores hour:2 UTC next day and re-renders 19:00", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-08-23T12:00:00Z") })
    try {
      pinBrowserTz("America/Los_Angeles")
      seedTimesJson({ slots: [{ hour: 12, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }], tz: "UTC" })
      render(<HeartbeatConfig />)

      fireEvent.change(screen.getByLabelText("Custom time 1"), { target: { value: "19:00" } })

      const stored = storedTimesJson()
      expect(stored.tz).toBe("UTC")
      expect(stored.authoredTz).toBe("America/Los_Angeles")
      // 19:00 PDT = 02:00Z the NEXT day; all-days weekday set is rotation-invariant.
      expect(stored.slots[0].hour).toBe(2)
      expect(stored.slots[0].weekdays).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect((screen.getByLabelText("Custom time 1") as HTMLInputElement).value).toBe("19:00")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("HeartbeatConfig - inline slot receipts (local · UTC pair)", () => {
  it("Dubai: slot receipt reads '19:00 GMT+4 · 15:00 UTC'", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimesJson({
      slots: [{ hour: 15, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
      tz: "UTC",
      authoredTz: "Asia/Dubai",
    })
    render(<HeartbeatConfig />)
    expect(screen.getByTestId("slot-receipt-0").textContent).toBe("19:00 GMT+4 · 15:00 UTC")
  })

  it("UTC browser: receipt collapses to '19:00 UTC' (no duplicate pair)", () => {
    pinBrowserTz("UTC")
    seedTimesJson({
      slots: [{ hour: 19, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
      tz: "UTC",
      authoredTz: "UTC",
    })
    render(<HeartbeatConfig />)
    expect(screen.getByTestId("slot-receipt-0").textContent).toBe("19:00 UTC")
  })
})

describe("HeartbeatConfig - authored-tz pinning (a traveling user's claw never silently shifts)", () => {
  const dubaiAuthored: StoredTimesPayload = {
    slots: [{ hour: 15, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
    tz: "UTC",
    authoredTz: "Asia/Dubai",
  }

  it("Dubai-authored schedule opened in LA still speaks Dubai: input 19:00, chip 'Daily at 19:00 GMT+4'", () => {
    pinBrowserTz("America/Los_Angeles")
    seedTimesJson(dubaiAuthored)
    render(<HeartbeatConfig />)

    expect((screen.getByLabelText("Custom time 1") as HTMLInputElement).value).toBe("19:00")
    expect(screen.getByTestId("schedule-chip").textContent).toBe("Daily at 19:00 GMT+4")
    expect(screen.getByText(/Times are in Asia\/Dubai/)).toBeTruthy()
  })

  it("editing while traveling keeps the authored tz: typing 20:00 in LA stores 16:00Z with authoredTz Asia/Dubai", () => {
    pinBrowserTz("America/Los_Angeles")
    seedTimesJson(dubaiAuthored)
    render(<HeartbeatConfig />)

    fireEvent.change(screen.getByLabelText("Custom time 1"), { target: { value: "20:00" } })

    const stored = storedTimesJson()
    expect(stored.authoredTz).toBe("Asia/Dubai")
    expect(stored.tz).toBe("UTC")
    expect(stored.slots[0].hour).toBe(16)
    expect((screen.getByLabelText("Custom time 1") as HTMLInputElement).value).toBe("20:00")
  })
})

describe("HeartbeatConfig - schedule chip wording", () => {
  it("Mon-Fri slot reads 'Weekdays at 09:00 GMT+4'", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimesJson({
      slots: [{ hour: 5, minute: 0, weekdays: [1, 2, 3, 4, 5] }],
      tz: "UTC",
      authoredTz: "Asia/Dubai",
    })
    render(<HeartbeatConfig />)
    expect(screen.getByTestId("schedule-chip").textContent).toBe("Weekdays at 09:00 GMT+4")
  })

  it("multi-slot schedules list the times: 'At 09:00, 19:00 GMT+4'", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimesJson({
      slots: [
        { hour: 5, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] },
        { hour: 15, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ],
      tz: "UTC",
      authoredTz: "Asia/Dubai",
    })
    render(<HeartbeatConfig />)
    expect(screen.getByTestId("schedule-chip").textContent).toBe("At 09:00, 19:00 GMT+4")
  })
})

describe("HeartbeatConfig - monthly pins the authoring tz (exact day-of-month semantics)", () => {
  it("switching to Monthly in Dubai pins tz Asia/Dubai; typed 09:30 stays 09:30 in that tz with a UTC receipt", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: { frequency: "off", time: "08:00" },
    })
    render(<HeartbeatConfig />)

    fireEvent.click(screen.getByText("Monthly"))
    let stored = JSON.parse(useBuilderStore.getState().heartbeatSchedule.time)
    expect(stored.tz).toBe("Asia/Dubai")

    fireEvent.change(screen.getByLabelText("Monthly time"), { target: { value: "09:30" } })
    stored = JSON.parse(useBuilderStore.getState().heartbeatSchedule.time)
    expect(stored.tz).toBe("Asia/Dubai")
    expect(stored.hour).toBe(9)
    expect(stored.minute).toBe(30)
    expect(screen.getByTestId("monthly-receipt").textContent).toBe("09:30 GMT+4 · 05:30 UTC")
  })
})

describe("HeartbeatConfig - raw cron speaks UTC", () => {
  it("new Raw cron values pin tz UTC and the editor says expressions run in UTC", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "Asia/Dubai",
      heartbeatSchedule: { frequency: "off", time: "08:00" },
    })
    render(<HeartbeatConfig />)

    fireEvent.click(screen.getByText("Raw cron"))
    const stored = JSON.parse(useBuilderStore.getState().heartbeatSchedule.time)
    expect(stored.tz).toBe("UTC")
    expect(screen.getByText(/Expressions run in UTC/)).toBeTruthy()
  })

  it("times-mode advanced extras caption names the schedule tz (UTC post-fix)", () => {
    pinBrowserTz("Asia/Dubai")
    seedTimesJson({
      slots: [{ hour: 15, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
      tz: "UTC",
      authoredTz: "Asia/Dubai",
      extraExpressions: ["30 6 * * *"],
    } as StoredTimesPayload & { extraExpressions: string[] })
    render(<HeartbeatConfig />)
    expect(screen.getByText(/Expressions run in UTC/)).toBeTruthy()
  })
})

// #454 follow-up: daily/weekday presets adopt authored-tz local-input
// semantics for NEW input while legacy rows stay untouched.
describe("HeartbeatConfig - daily/weekday presets stamp the authored tz", () => {
  function storedPreset(): { frequency: string; time: string } {
    return useBuilderStore.getState().heartbeatSchedule
  }

  it("fresh Daily selection in a Dubai browser stamps tz Asia/Dubai", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: { frequency: "off", time: "08:00" },
    })
    render(<HeartbeatConfig />)

    fireEvent.click(screen.getByText("Daily"))

    const stored = storedPreset()
    expect(stored.frequency).toBe("daily")
    expect(JSON.parse(stored.time)).toEqual({ time: "08:00", tz: "Asia/Dubai" })
  })

  it("typing a time on a LEGACY daily row stamps the browser tz (authoring = local input)", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: { frequency: "daily", time: "19:00" },
    })
    render(<HeartbeatConfig />)

    fireEvent.change(screen.getByLabelText("Heartbeat time"), { target: { value: "19:05" } })

    expect(JSON.parse(storedPreset().time)).toEqual({ time: "19:05", tz: "Asia/Dubai" })
  })

  it("LEGACY LOCK: toggling daily->weekday without typing keeps the plain string unstamped", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: { frequency: "daily", time: "19:00" },
    })
    render(<HeartbeatConfig />)

    fireEvent.click(screen.getByText("Weekdays only"))

    const stored = storedPreset()
    expect(stored.frequency).toBe("weekday")
    // Still the legacy plain format - the mere toggle must not reinterpret
    // the 19:00 from workspace tz to browser tz.
    expect(stored.time).toBe("19:00")
  })

  it("receipt names the zone that applies: workspace tz for legacy, GMT+4 pair for stamped", () => {
    pinBrowserTz("Asia/Dubai")
    useBuilderStore.setState({
      workspaceTimezone: "UTC",
      heartbeatSchedule: { frequency: "daily", time: "19:00" },
    })
    render(<HeartbeatConfig />)

    expect(screen.getByTestId("preset-time-receipt").textContent).toBe(
      "19:00 UTC · workspace timezone",
    )

    // Type a DIFFERENT time (React dedupes same-value change events).
    fireEvent.change(screen.getByLabelText("Heartbeat time"), { target: { value: "19:30" } })
    expect(screen.getByTestId("preset-time-receipt").textContent).toBe("19:30 GMT+4 · 15:30 UTC")
  })
})
