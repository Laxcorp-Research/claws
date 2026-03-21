"use client"

import { useBuilderStore } from "@/stores/builder-store"

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every hour" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "every_12h", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekday", label: "Weekdays only" },
]

function buildTimeOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of ["00", "30"]) {
      const val = `${String(h).padStart(2, "0")}:${m}`
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      const ampm = h < 12 ? "AM" : "PM"
      opts.push({ value: val, label: `${h12}:${m} ${ampm}` })
    }
  }
  return opts
}

const TIME_OPTIONS = buildTimeOptions()

export function HeartbeatConfig() {
  const { heartbeatSchedule, setHeartbeatSchedule } = useBuilderStore()
  const showTime = heartbeatSchedule.frequency !== "hourly"

  return (
    <div className="absolute bottom-2 left-1.5 right-1.5 bg-[var(--bg)] border border-[var(--bd)] rounded-[6px] px-2.5 py-1.5 flex items-center gap-2 text-[10px] z-10">
      <span className="text-[var(--tx2)] font-medium">Run every:</span>
      <select
        value={heartbeatSchedule.frequency}
        onChange={(e) => setHeartbeatSchedule({ frequency: e.target.value })}
        className="px-1.5 py-[3px] border border-[var(--bd)] rounded-[6px] text-[10px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
      >
        {FREQUENCY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {showTime && (
        <>
          <span className="text-[var(--tx2)]">at</span>
          <select
            value={heartbeatSchedule.time}
            onChange={(e) => setHeartbeatSchedule({ time: e.target.value })}
            className="px-1.5 py-[3px] border border-[var(--bd)] rounded-[6px] text-[10px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          >
            {TIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
