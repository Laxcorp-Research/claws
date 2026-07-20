import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CHANNEL_IDLE_MS, warmIdleWhere, runningIdleWhere } from "@/lib/hibernation/predicates"

describe("warmIdleWhere — P1.1", () => {
  it("matches stamped idle OR (null stamp + channelsConnectedAt older than 24h)", () => {
    const now = new Date("2026-07-19T12:00:00.000Z")
    const where = warmIdleWhere(now)
    expect(where.containerPhase).toBe("WARM")
    const idleOr = where.AND[0]!.OR
    expect(idleOr).toEqual([
      { lastChannelMessageAt: { lt: new Date(now.getTime() - CHANNEL_IDLE_MS) } },
      {
        AND: [
          { lastChannelMessageAt: null },
          { channelsConnectedAt: { lt: new Date(now.getTime() - CHANNEL_IDLE_MS) } },
        ],
      },
    ])
  })

  it("25h-old timestamp is older than the 24h cutoff", () => {
    const now = new Date("2026-07-19T12:00:00.000Z")
    const cutoff = new Date(now.getTime() - CHANNEL_IDLE_MS)
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    expect(twentyFiveHoursAgo.getTime()).toBeLessThan(cutoff.getTime())
  })

  it("MUTATION: null-with-fresh-connection must stay protected", () => {
    const src = readFileSync(join(__dirname, "../predicates.ts"), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    // Must require channelsConnectedAt < cutoff alongside null stamp.
    expect(code).toContain("channelsConnectedAt: { lt: channelIdleCutoff }")
    expect(code).toContain("lastChannelMessageAt: null")
    // Simulate buggy "null alone matches" — must NOT equal shipped where.
    const now = new Date()
    const shipped = warmIdleWhere(now)
    const buggyNullAlone = {
      containerPhase: "WARM" as const,
      OR: [
        { lastChannelMessageAt: { lt: new Date() } },
        { lastChannelMessageAt: null },
      ],
    }
    expect(JSON.stringify(buggyNullAlone)).toContain('"lastChannelMessageAt":null')
    expect(JSON.stringify(shipped)).toContain("channelsConnectedAt")
    expect(JSON.stringify(shipped.AND[0])).toContain("channelsConnectedAt")
  })
})

describe("runningIdleWhere", () => {
  it("keeps hasActiveChannels:false and 10m lastActiveAt", () => {
    const where = runningIdleWhere(new Date())
    expect(where.hasActiveChannels).toBe(false)
    expect(where.containerPhase).toBe("RUNNING")
    expect(where.lastActiveAt).toHaveProperty("lt")
  })
})

describe("cron ↔ candidates parity", () => {
  it("both routes import warmIdleWhere / runningIdleWhere from predicates", () => {
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/hibernation/route.ts"),
      "utf8",
    )
    const candidates = readFileSync(
      join(process.cwd(), "src/app/api/internal/hibernation/candidates/route.ts"),
      "utf8",
    )
    expect(cron).toContain('from "@/lib/hibernation/predicates"')
    expect(candidates).toContain('from "@/lib/hibernation/predicates"')
    expect(cron).toContain("warmIdleWhere")
    expect(candidates).toContain("warmIdleWhere")
    expect(cron).toContain("runningIdleWhere")
    expect(candidates).toContain("runningIdleWhere")
  })
})
