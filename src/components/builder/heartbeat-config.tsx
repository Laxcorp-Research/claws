"use client"

import { useBuilderStore } from "@/stores/builder-store"
import { CustomSelect } from "./custom-select"
import { HelpTooltip } from "@/components/ui/help-tooltip"

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every hour" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "every_12h", label: "Every 12 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekday", label: "Weekdays only" },
]

const TIME_OPTIONS = [
  { value: "06:00", label: "6:00 AM" },
  { value: "07:00", label: "7:00 AM" },
  { value: "08:00", label: "8:00 AM" },
  { value: "09:00", label: "9:00 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "12:00", label: "12:00 PM" },
  { value: "14:00", label: "2:00 PM" },
  { value: "16:00", label: "4:00 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "20:00", label: "8:00 PM" },
]

export function HeartbeatConfig() {
  const { heartbeatSchedule, setHeartbeatSchedule } = useBuilderStore()
  const showTime = heartbeatSchedule.frequency !== "hourly"

  return (
    <div>
      <div className="flex items-center gap-[4px] mb-[6px]">
        <div className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Heartbeat</div>
        <HelpTooltip text="How often the Orchestrator wakes up and runs its task checklist. Daily at 8 AM is a good default for most business Claws." />
      </div>
      <div className="flex flex-col gap-[6px]">
        <CustomSelect
          value={heartbeatSchedule.frequency}
          onChange={(val) => setHeartbeatSchedule({ frequency: val })}
          options={FREQUENCY_OPTIONS}
        />
        {showTime && (
          <CustomSelect
            value={heartbeatSchedule.time}
            onChange={(val) => setHeartbeatSchedule({ time: val })}
            options={TIME_OPTIONS}
          />
        )}
      </div>
    </div>
  )
}
