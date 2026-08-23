"use client"

import { useMemo, useState } from "react"
import { useBuilderStore } from "@/stores/builder-store"
import { CustomSelect } from "./custom-select"
import { HelpTooltip } from "@/components/ui/help-tooltip"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  computeNextOccurrences,
  deserializeSchedule,
  serializeSchedule,
  validateSchedule,
} from "@/lib/schedule"
import { convertSlotWall, convertWallTime, tzShortLabel } from "@/lib/schedule/wall-time"
import type { ScheduleMode, ScheduleValue, TimeSlot, Weekday } from "@/lib/schedule/types"

const FREQUENCY_OPTIONS: Array<{ value: ScheduleMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "hourly", label: "Every hour" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "every_12h", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekday", label: "Weekdays only" },
  { value: "times", label: "Custom times" },
  { value: "interval", label: "Interval" },
  { value: "monthly", label: "Monthly" },
  { value: "cron", label: "Raw cron" },
]

const DOW: Array<{ d: Weekday; label: string }> = [
  { d: 0, label: "Su" },
  { d: 1, label: "Mo" },
  { d: 2, label: "Tu" },
  { d: 3, label: "We" },
  { d: 4, label: "Th" },
  { d: 5, label: "Fr" },
  { d: 6, label: "Sa" },
]

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5]

function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function parseTimeInput(raw: string): { hour: number; minute: number } | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function defaultValue(
  mode: ScheduleMode,
  tz: string,
  prev: ScheduleValue,
  browserTz: string,
): ScheduleValue {
  switch (mode) {
    case "off":
      return { mode: "off" }
    case "hourly":
      return { mode: "hourly" }
    case "every_6h":
      return { mode: "every_6h" }
    case "every_12h":
      return { mode: "every_12h" }
    case "daily":
      return { mode: "daily", time: prev.mode === "daily" || prev.mode === "weekday" ? prev.time : "08:00" }
    case "weekday":
      return { mode: "weekday", time: prev.mode === "daily" || prev.mode === "weekday" ? prev.time : "08:00" }
    case "times": {
      const extras =
        prev.mode === "times"
          ? prev.extraExpressions
          : prev.mode === "cron"
            ? prev.expressions
            : undefined
      if (prev.mode === "times") return prev
      if (prev.mode === "daily" || prev.mode === "weekday") {
        // Daily/weekday times are wall-clock in the workspace tz; carry the
        // instant over by converting that wall time to UTC storage.
        const t = parseTimeInput(prev.time) ?? { hour: 8, minute: 0 }
        const carried = convertSlotWall(
          { ...t, weekdays: prev.mode === "weekday" ? [...WEEKDAYS] : [...ALL_DAYS] },
          tz,
          "UTC",
        )
        return { mode: "times", tz: "UTC", authoredTz: browserTz, slots: [carried], extraExpressions: extras }
      }
      return {
        mode: "times",
        tz: "UTC",
        authoredTz: browserTz,
        slots: [convertSlotWall({ hour: 8, minute: 0, weekdays: [...WEEKDAYS] }, browserTz, "UTC")],
        extraExpressions: extras,
      }
    }
    case "interval":
      return { mode: "interval", everyMinutes: 60 }
    case "monthly":
      // Pinned to the authoring (browser) tz: converting a monthly wall time
      // to UTC can cross midnight and shift the day-of-month ("last day at
      // 01:00" has no UTC cron equivalent), so monthly stores the local wall
      // time and fires in that zone. The receipt shows the UTC pair.
      return { mode: "monthly", day: 1, hour: 9, minute: 0, tz: browserTz }
    case "cron":
      return {
        mode: "cron",
        tz: "UTC",
        expressions: prev.mode === "cron" ? prev.expressions : prev.mode === "times" ? (prev.extraExpressions ?? [""]) : [""],
      }
    case "test_5min":
      return { mode: "test_5min" }
  }
}

function extrasOf(value: ScheduleValue): string[] {
  if (value.mode === "times" || value.mode === "interval" || value.mode === "monthly") {
    return value.extraExpressions ?? []
  }
  if (value.mode === "cron") return value.expressions
  return []
}

function withExtras(value: ScheduleValue, extras: string[]): ScheduleValue {
  const cleaned = extras.map((e) => e.trim()).filter((e) => e.length > 0)
  if (value.mode === "times") return { ...value, extraExpressions: cleaned.length ? cleaned : undefined }
  if (value.mode === "interval") return { ...value, extraExpressions: cleaned.length ? cleaned : undefined }
  if (value.mode === "monthly") return { ...value, extraExpressions: cleaned.length ? cleaned : undefined }
  if (value.mode === "cron") return { ...value, expressions: cleaned }
  return value
}

export function HeartbeatConfig() {
  const { heartbeatSchedule, setHeartbeatSchedule, workspaceTimezone } = useBuilderStore()
  const tz = workspaceTimezone || "UTC"
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const displayTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz

  const value: ScheduleValue =
    deserializeSchedule(heartbeatSchedule.frequency, heartbeatSchedule.time) ?? { mode: "off" }

  const commit = (next: ScheduleValue) => {
    const ser = serializeSchedule(next)
    setHeartbeatSchedule({
      frequency: ser.heartbeatFrequency ?? "off",
      time: ser.heartbeatTime ?? "08:00",
    })
  }

  const gate = useMemo(() => validateSchedule(value, tz), [value, tz])
  const preview = useMemo(() => {
    if (value.mode === "off" || !gate.ok) return []
    return computeNextOccurrences({
      value,
      timezone: tz,
      n: 5,
      displayTimeZone: displayTz,
    })
  }, [value, tz, displayTz, gate.ok])

  const freqOptions =
    value.mode === "test_5min"
      ? [...FREQUENCY_OPTIONS, { value: "test_5min" as const, label: "Test (every 5 min)" }]
      : FREQUENCY_OPTIONS

  const extras = extrasOf(value)
  const showAdvanced = value.mode !== "off"
  const advancedExpanded = advancedOpen || value.mode === "cron" || extras.length > 0

  return (
    <div>
      <div className="flex items-center gap-[4px] mb-[6px]">
        <div className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Heartbeat</div>
        <HelpTooltip text="How often the Orchestrator wakes up and runs its task checklist. Times are stored in UTC and shown in your local timezone. Daily at 8 AM is a good default for most business Claws." />
      </div>
      <div className="flex flex-col gap-[6px]">
        <CustomSelect
          value={value.mode}
          onChange={(val) => commit(defaultValue(val as ScheduleMode, tz, value, displayTz))}
          options={freqOptions}
        />

        {(value.mode === "daily" || value.mode === "weekday") && (
          <Input
            type="time"
            step={60}
            variant="compact"
            value={value.time.length === 5 ? value.time : "08:00"}
            onChange={(e) => commit({ mode: value.mode, time: e.target.value || "08:00" })}
            aria-label="Heartbeat time"
          />
        )}

        {value.mode === "times" && (
          <TimesEditor value={value} onChange={commit} browserTz={displayTz} />
        )}

        {value.mode === "interval" && (
          <IntervalEditor value={value} onChange={commit} />
        )}

        {value.mode === "monthly" && (
          <MonthlyEditor value={value} onChange={commit} />
        )}

        {showAdvanced && (
          <div className="border border-[var(--bd)] rounded-[8px] px-[8px] py-[6px]">
            <button
              type="button"
              className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider w-full text-left"
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              {advancedExpanded ? "▾" : "▸"} Advanced (raw cron)
            </button>
            {advancedExpanded && (
              <CronExprsEditor
                expressions={extras.length > 0 ? extras : [""]}
                onChange={(next) => commit(withExtras(value, next))}
                runTz={
                  value.mode === "times" || value.mode === "monthly" || value.mode === "cron"
                    ? value.tz
                    : tz
                }
              />
            )}
          </div>
        )}

        {gate.errors.map((err) => (
          <p key={err} className="text-[10px] text-[var(--err)] leading-[1.4]" role="alert">
            {err}
          </p>
        ))}

        {gate.creditWarning && (
          <AlertBanner variant="warning">
            <p className="font-medium text-[11px]">{gate.creditWarning}</p>
          </AlertBanner>
        )}

        {value.mode !== "off" && preview.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-[var(--tx3)] uppercase tracking-[0.04em] mb-[4px]">
              Next 5 fires
            </div>
            <ul className="flex flex-col gap-[3px]">
              {preview.map((row) => (
                <li key={`${row.utcIso}-${row.expr}`} className="text-[10px] text-[var(--tx2)] leading-[1.4]">
                  <span className="text-[var(--tx)]">{row.localIso}</span>
                  {" · "}
                  <span>{row.utcIso.replace(".000Z", "Z")} UTC</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

const WEEKDAY_SET = "1,2,3,4,5"

/** Chip copy: "Daily at 19:00 GMT+4" / "Weekdays at 09:00 GMT+4" / "At 09:00, 19:00 GMT+4". */
function timesChipText(localSlots: TimeSlot[], tzLabel: string): string {
  const times = [...new Set(localSlots.map((s) => padTime(s.hour, s.minute)))].sort()
  if (localSlots.length === 1) {
    const days = [...new Set(localSlots[0].weekdays)].sort((a, b) => a - b)
    if (days.length === 7) return `Daily at ${times[0]} ${tzLabel}`
    if (days.join(",") === WEEKDAY_SET) return `Weekdays at ${times[0]} ${tzLabel}`
  }
  return `At ${times.join(", ")} ${tzLabel}`
}

function TimesEditor({
  value,
  onChange,
  browserTz,
}: {
  value: Extract<ScheduleValue, { mode: "times" }>
  onChange: (v: ScheduleValue) => void
  browserTz: string
}) {
  // Users type wall-clock times in a HUMAN timezone; storage is UTC. The
  // schedule stays pinned to the tz it was authored in (authoredTz) so a
  // traveling user's claw never silently shifts; unpinned/legacy values speak
  // the browser tz. D6: without any of this, a Dubai founder's typed 19:00
  // was stored as 19:00Z (23:00 his time).
  const inputTz = value.authoredTz ?? browserTz
  const tzLabel = tzShortLabel(inputTz)
  const localSlots = value.slots.map((s) => convertSlotWall(s, value.tz, inputTz))
  const commitLocal = (nextLocal: TimeSlot[]) => {
    onChange({
      ...value,
      tz: "UTC",
      authoredTz: inputTz,
      slots: nextLocal.map((s) => convertSlotWall(s, inputTz, "UTC")),
    })
  }
  const updateSlot = (idx: number, patch: Partial<TimeSlot>) => {
    commitLocal(localSlots.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  return (
    <div className="flex flex-col gap-[6px]">
      <div
        data-testid="schedule-chip"
        className="self-start px-[8px] h-[22px] inline-flex items-center rounded-[6px] border border-[var(--bd)] text-[10px] text-[var(--tx2)]"
      >
        {timesChipText(localSlots, tzLabel)}
      </div>
      {localSlots.map((slot, idx) => {
        const utcSlot = convertSlotWall(slot, inputTz, "UTC")
        const receipt =
          tzLabel === "UTC"
            ? `${padTime(slot.hour, slot.minute)} UTC`
            : `${padTime(slot.hour, slot.minute)} ${tzLabel} · ${padTime(utcSlot.hour, utcSlot.minute)} UTC`
        return (
        <div key={`${idx}-${slot.hour}-${slot.minute}`} className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[6px]">
            <Input
              type="time"
              step={60}
              variant="compact"
              className="flex-1"
              value={padTime(slot.hour, slot.minute)}
              onChange={(e) => {
                const t = parseTimeInput(e.target.value)
                if (t) updateSlot(idx, t)
              }}
              aria-label={`Custom time ${idx + 1}`}
            />
            <span
              data-testid={`slot-receipt-${idx}`}
              className="text-[10px] text-[var(--tx3)] whitespace-nowrap"
            >
              {receipt}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => commitLocal(localSlots.filter((_, i) => i !== idx))}
            >
              Remove
            </Button>
          </div>
          <div className="flex flex-wrap gap-[4px]">
            {DOW.map(({ d, label }) => {
              const on = slot.weekdays.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  className={`h-[22px] px-[6px] rounded-[6px] text-[10px] border ${
                    on
                      ? "border-[var(--ac)] bg-[var(--acbg)] text-[var(--ac-text)]"
                      : "border-[var(--bd)] text-[var(--tx3)]"
                  }`}
                  onClick={() => {
                    const weekdays = on
                      ? slot.weekdays.filter((x) => x !== d)
                      : [...slot.weekdays, d].sort((a, b) => a - b)
                    updateSlot(idx, { weekdays: weekdays as Weekday[] })
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
        )
      })}
      {localSlots.length < 24 && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => commitLocal([...localSlots, { hour: 8, minute: 0, weekdays: [...WEEKDAYS] }])}
        >
          Add time
        </Button>
      )}
      <p className="text-[10px] text-[var(--tx3)] leading-[1.4]">
        Times are in {inputTz}
        {inputTz === browserTz ? " (your local timezone)." : " (the timezone this schedule was authored in)."}
      </p>
    </div>
  )
}

function IntervalEditor({
  value,
  onChange,
}: {
  value: Extract<ScheduleValue, { mode: "interval" }>
  onChange: (v: ScheduleValue) => void
}) {
  const isHours = value.everyMinutes >= 60 && value.everyMinutes % 60 === 0
  const amount = isHours ? value.everyMinutes / 60 : value.everyMinutes
  return (
    <div className="flex items-center gap-[6px]">
      <span className="text-[11px] text-[var(--tx2)]">Every</span>
      <Input
        type="number"
        min={isHours ? 1 : 15}
        step={1}
        variant="compact"
        className="w-[64px]"
        value={amount}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!Number.isInteger(n) || n <= 0) return
          onChange({ ...value, everyMinutes: isHours ? n * 60 : n })
        }}
        aria-label="Interval amount"
      />
      <CustomSelect
        value={isHours ? "hours" : "minutes"}
        onChange={(unit) => {
          if (unit === "hours") {
            const hours = Math.max(1, Math.round(value.everyMinutes / 60) || 1)
            onChange({ ...value, everyMinutes: hours * 60 })
          } else {
            onChange({ ...value, everyMinutes: Math.max(15, value.everyMinutes % 60 || 15) })
          }
        }}
        options={[
          { value: "minutes", label: "minutes" },
          { value: "hours", label: "hours" },
        ]}
      />
    </div>
  )
}

function MonthlyEditor({
  value,
  onChange,
}: {
  value: Extract<ScheduleValue, { mode: "monthly" }>
  onChange: (v: ScheduleValue) => void
}) {
  const dayValue = value.day === "last" ? "last" : String(value.day)
  const dayOptions = [
    ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` })),
    { value: "last", label: "Last day" },
  ]
  // Monthly stays pinned to value.tz (the authoring tz for new values): a
  // UTC conversion could cross midnight and shift the day-of-month. The
  // receipt keeps the UTC pair visible.
  const tzLabel = tzShortLabel(value.tz)
  const utc = convertWallTime({ hour: value.hour, minute: value.minute, fromTz: value.tz, toTz: "UTC" })
  const receipt =
    tzLabel === "UTC"
      ? `${padTime(value.hour, value.minute)} UTC`
      : `${padTime(value.hour, value.minute)} ${tzLabel} · ${padTime(utc.hour, utc.minute)} UTC`
  return (
    <div className="flex flex-col gap-[6px]">
      <CustomSelect
        value={dayValue}
        onChange={(v) =>
          onChange({ ...value, day: v === "last" ? "last" : parseInt(v, 10) })
        }
        options={dayOptions}
      />
      <div className="flex items-center gap-[6px]">
        <Input
          type="time"
          step={60}
          variant="compact"
          className="flex-1"
          value={padTime(value.hour, value.minute)}
          onChange={(e) => {
            const t = parseTimeInput(e.target.value)
            if (t) onChange({ ...value, ...t })
          }}
          aria-label="Monthly time"
        />
        <span data-testid="monthly-receipt" className="text-[10px] text-[var(--tx3)] whitespace-nowrap">
          {receipt}
        </span>
      </div>
      <p className="text-[10px] text-[var(--tx3)] leading-[1.4]">Fires in {value.tz}.</p>
    </div>
  )
}

function CronExprsEditor({
  expressions,
  onChange,
  runTz,
}: {
  expressions: string[]
  onChange: (next: string[]) => void
  runTz: string
}) {
  return (
    <div className="flex flex-col gap-[6px] mt-[6px]">
      {expressions.map((expr, idx) => (
        <div key={idx} className="flex items-center gap-[6px]">
          <Input
            variant="compact"
            className="font-mono flex-1"
            placeholder="43 14 * * *"
            value={expr}
            onChange={(e) => {
              const next = expressions.map((x, i) => (i === idx ? e.target.value : x))
              onChange(next)
            }}
            aria-label={`Cron expression ${idx + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange(expressions.filter((_, i) => i !== idx))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => onChange([...expressions, ""])}
      >
        Add cron
      </Button>
      <p className="text-[10px] text-[var(--tx3)] leading-[1.4]">Expressions run in {runTz}.</p>
    </div>
  )
}
