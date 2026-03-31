"use client"

import { useBuilderStore } from "@/stores/builder-store"
import { CustomSelect } from "./custom-select"

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
      <span className="text-[var(--tx2)] font-medium flex-shrink-0">Run every:</span>
      <CustomSelect
        value={heartbeatSchedule.frequency}
        onChange={(val) => setHeartbeatSchedule({ frequency: val })}
        options={FREQUENCY_OPTIONS}
        className="min-w-[110px]"
      />
      {showTime && (
        <>
          <span className="text-[var(--tx2)] flex-shrink-0">at</span>
          <CustomSelect
            value={heartbeatSchedule.time}
            onChange={(val) => setHeartbeatSchedule({ time: val })}
            options={TIME_OPTIONS}
            className="min-w-[90px]"
          />
        </>
      )}
    </div>
  )
}
