import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MISSION_RESUME_FAIL_NOTE,
  MISSION_RESUME_PROMPT,
} from "@/lib/healing/mission-resume"

describe("mission_interrupted resume copy", () => {
  it("auto-resume prompt pastes work; user note only after two fails", () => {
    expect(MISSION_RESUME_PROMPT).toContain("interrupted mission")
    expect(MISSION_RESUME_PROMPT).toContain("shared/deliverables")
    expect(MISSION_RESUME_PROMPT).not.toContain("verbatim")
    expect(MISSION_RESUME_FAIL_NOTE).toContain("two tries")
  })

  it("MUTATION: wake must call resume; health-monitor must ledger mid-mission death", () => {
    const wake = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(wake).toContain("maybeResumeInterruptedMission")
    const health = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    )
    expect(health).toContain("maybeLedgerMissionInterrupted")
    expect(health).toContain('probe.result.reason !== "no-container"')
    const registry = readFileSync(join(process.cwd(), "src/lib/healing/registry.ts"), "utf8")
    expect(registry).toContain("mission_interrupted")
    expect(registry).toContain("auto-resume on wake")
  })
})
