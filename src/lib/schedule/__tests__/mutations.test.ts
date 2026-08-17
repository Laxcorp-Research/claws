import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

describe("schedule editor mutations", () => {
  it("MUTATION: banner-restored fails", () => {
    const config = readFileSync(join(ROOT, "src/components/builder/heartbeat-config.tsx"), "utf8")
    const picker = readFileSync(join(ROOT, "src/lib/builder/heartbeat-picker.ts"), "utf8")
    expect(config).not.toContain("Runs on its template schedule")
    expect(picker).not.toContain("Runs on its template schedule")
    expect(config).not.toContain("customHeartbeatLabel")
  })

  it("MUTATION: lookalike-parser substituted fails", () => {
    const src = readFileSync(join(ROOT, "src/lib/schedule/croner-parse.ts"), "utf8")
    expect(src).toMatch(/from ["']croner["']/)
    expect(src).not.toMatch(/from ["']cron-parser["']/)
    expect(src).not.toMatch(/CronExpressionParser/)
  })

  it("MUTATION: emission severed fails", () => {
    const gen = readFileSync(join(ROOT, "src/lib/openclaw/generator.ts"), "utf8")
    expect(gen).toContain("emitHeartbeatJobs")
    expect(gen).toContain("heartbeat?.cronJobs")
    expect(gen).toMatch(/for \(const job of heartbeatJobs\)/)
  })
})
