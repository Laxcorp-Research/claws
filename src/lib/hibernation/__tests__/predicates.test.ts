import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CHANNEL_IDLE_MS, warmIdleWhere, runningIdleWhere } from "@/lib/hibernation/predicates"

describe("warmIdleWhere — null never matches", () => {
  it("requires lastChannelMessageAt < cutoff (Prisma lt excludes null)", () => {
    const now = new Date("2026-07-19T12:00:00.000Z")
    const where = warmIdleWhere(now)
    expect(where.containerPhase).toBe("WARM")
    expect(where.lastChannelMessageAt).toEqual({
      lt: new Date(now.getTime() - CHANNEL_IDLE_MS),
    })
    // Must NOT include a null-match OR on lastChannelMessageAt.
    expect(where).not.toHaveProperty("AND")
    expect(JSON.stringify(where.lastChannelMessageAt)).not.toContain("null")
  })

  it("25h-old timestamp is older than the 24h cutoff", () => {
    const now = new Date("2026-07-19T12:00:00.000Z")
    const cutoff = (warmIdleWhere(now).lastChannelMessageAt as { lt: Date }).lt
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    expect(twentyFiveHoursAgo.getTime()).toBeLessThan(cutoff.getTime())
  })

  it("MUTATION: restoring null-match would reintroduce the warmIdle bug", () => {
    const src = readFileSync(join(__dirname, "../predicates.ts"), "utf8")
    // Strip comments so the mutation doc line cannot false-positive.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).toContain("lastChannelMessageAt: { lt: channelIdleCutoff }")
    expect(code).not.toMatch(/lastChannelMessageAt:\s*null/)
    // Simulate the pre-fix predicate shape — must NOT equal shipped where.
    const now = new Date()
    const shipped = warmIdleWhere(now)
    const buggy = {
      ...shipped,
      OR: [
        { lastChannelMessageAt: { lt: new Date() } },
        { lastChannelMessageAt: null },
      ],
    }
    expect(JSON.stringify(buggy)).toContain('"lastChannelMessageAt":null')
    expect(JSON.stringify(shipped.lastChannelMessageAt)).not.toContain("null")
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
