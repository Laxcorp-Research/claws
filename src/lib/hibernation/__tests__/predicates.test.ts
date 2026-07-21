import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CHANNEL_IDLE_MS,
  DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS,
  resolveImminentExemptMs,
  warmIdleWhere,
  runningIdleWhere,
} from "@/lib/hibernation/predicates"

afterEach(() => {
  delete process.env.HEARTBEAT_IMMINENT_EXEMPT_MS
})

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

describe("imminent-beat exemption (HEARTBEAT_IMMINENT_EXEMPT_MS)", () => {
  it("defaults to 15m env-less", () => {
    delete process.env.HEARTBEAT_IMMINENT_EXEMPT_MS
    expect(resolveImminentExemptMs()).toBe(DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS)
    expect(resolveImminentExemptMs()).toBe(15 * 60 * 1000)
  })

  it("imminent claw survives both predicates (hint inside exempt window)", () => {
    const now = new Date("2026-07-21T11:55:00.000Z")
    const exemptUntil = new Date(now.getTime() + 15 * 60 * 1000) // 12:10
    const appointment = new Date("2026-07-21T12:00:00.000Z") // inside window

    const running = runningIdleWhere(now)
    const warm = warmIdleWhere(now)

    // Predicate requires nextHeartbeatAt > exemptUntil OR null.
    const runningOr = running.OR as Array<{ nextHeartbeatAt?: unknown }>
    const warmOr = warm.AND[1]!.OR as Array<{ nextHeartbeatAt?: unknown }>
    expect(runningOr).toEqual([
      { nextHeartbeatAt: null },
      { nextHeartbeatAt: { gt: exemptUntil } },
    ])
    expect(warmOr).toEqual([
      { nextHeartbeatAt: null },
      { nextHeartbeatAt: { gt: exemptUntil } },
    ])

    // Appointment is NOT > exemptUntil → would not match hibernate query.
    expect(appointment.getTime()).toBeLessThanOrEqual(exemptUntil.getTime())
  })

  it("MUTATION: drop exemption → imminent claws would match", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/predicates.ts"),
      "utf8",
    )
    expect(src).toContain("HEARTBEAT_IMMINENT_EXEMPT_MS")
    expect(src).toContain("nextHeartbeatNotImminent")
    expect(src).toContain("resolveImminentExemptMs")
    // Both predicates must call the shared guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).toMatch(/runningIdleWhere[\s\S]*nextHeartbeatNotImminent/)
    expect(code).toMatch(/warmIdleWhere[\s\S]*nextHeartbeatNotImminent/)
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
