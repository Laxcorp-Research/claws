import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CHANNEL_IDLE_MS,
  DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS,
  resolveImminentExemptMs,
  warmIdleWhere,
  runningIdleWhere,
  wakeHibernatedWhere,
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

  it("excludes alwaysOn workspaces (PR-C #10)", () => {
    const where = runningIdleWhere(new Date())
    expect(where.workspace).toEqual({ alwaysOn: false })
  })
})

describe("warmIdleWhere alwaysOn exemption (PR-C #10)", () => {
  it("excludes alwaysOn workspaces", () => {
    const where = warmIdleWhere(new Date())
    expect(where.workspace).toEqual({ alwaysOn: false })
  })

  it("MUTATION: dropping the alwaysOn filter → alwaysOn claws would hibernate", () => {
    const src = readFileSync(join(__dirname, "../predicates.ts"), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).toMatch(/runningIdleWhere[\s\S]*workspace: \{ alwaysOn: false \}/)
    expect(code).toMatch(/warmIdleWhere[\s\S]*workspace: \{ alwaysOn: false \}/)
  })

  it("wakeHibernatedWhere does NOT filter alwaysOn (wake is always the safe direction)", () => {
    const where = wakeHibernatedWhere()
    expect(where).not.toHaveProperty("workspace")
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

  it("MUTATION: drop exemption from sleep → imminent claws would match", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/predicates.ts"),
      "utf8",
    )
    expect(src).toContain("HEARTBEAT_IMMINENT_EXEMPT_MS")
    expect(src).toContain("nextHeartbeatNotImminent")
    expect(src).toContain("resolveImminentExemptMs")
    // Both SLEEP predicates must call the shared guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).toMatch(/runningIdleWhere[\s\S]*nextHeartbeatNotImminent/)
    expect(code).toMatch(/warmIdleWhere[\s\S]*nextHeartbeatNotImminent/)
  })

  it("wakeHibernatedWhere includes imminent claws (no sleep exemption)", () => {
    const where = wakeHibernatedWhere()
    expect(where).toEqual({
      containerPhase: "HIBERNATED",
      nextHeartbeatAt: { not: null },
    })
    // No gt:exemptUntil / OR-null sleep shape on wake.
    expect(JSON.stringify(where)).not.toContain('"gt"')
    expect(where).not.toHaveProperty("OR")
    expect(where).not.toHaveProperty("AND")
  })

  it("MUTATION: apply sleep exemption to wake → wake-window test fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/predicates.ts"),
      "utf8",
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    // wakeHibernatedWhere body must not call nextHeartbeatNotImminent.
    const wakeFn = code.match(
      /export function wakeHibernatedWhere\(\)[\s\S]*?(?=export |$)/,
    )?.[0]
    expect(wakeFn).toBeTruthy()
    expect(wakeFn).not.toContain("nextHeartbeatNotImminent")
    expect(wakeFn).not.toContain("imminentExemptCutoff")
    expect(wakeFn).not.toContain("resolveImminentExemptMs")

    // Simulate the buggy cross-wire: sleep guard on wake excludes imminent.
    const now = new Date("2026-07-21T11:55:00.000Z")
    const exemptUntil = new Date(now.getTime() + 15 * 60 * 1000)
    const appointment = new Date("2026-07-21T12:00:00.000Z")
    const buggyWakeWhere = {
      containerPhase: "HIBERNATED" as const,
      nextHeartbeatAt: { not: null },
      OR: [
        { nextHeartbeatAt: null },
        { nextHeartbeatAt: { gt: exemptUntil } },
      ],
    }
    // Imminent appointment would NOT match buggy wake (wrong intent).
    expect(appointment.getTime()).toBeLessThanOrEqual(exemptUntil.getTime())
    expect(JSON.stringify(buggyWakeWhere)).toContain('"gt"')
    // Shipped wake must stay free of that filter.
    expect(JSON.stringify(wakeHibernatedWhere())).not.toContain('"gt"')
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
