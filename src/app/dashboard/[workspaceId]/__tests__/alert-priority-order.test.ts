/**
 * Batch E - page priority assignments must match the unique total order.
 * MUTATION: swap any two adjacent key priorities in page.tsx → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** Expected key → priority (lifecycle keys share 11). */
const EXPECTED: Record<string, number> = {
  "container-error": 0,
  "container-degraded": 0,
  "credits-exhausted": 1,
  "spend-limit": 2,
  "trial-expired": 3,
  "heartbeat-missed": 4,
  "activity-silence": 4,
  "state-sync-near-cap": 5,
  "hibernation-refused": 6,
  "state-sync-stale": 6,
  "tools-expired": 7,
  "mcp-session-dead": 8,
  "spend-warning": 9,
  "trial-active": 10,
  paused: 11,
  stopped: 11,
  hibernated: 11,
  waking: 11,
  "provisioning-queued": 11,
  "config-drift": 12,
  "version-update": 13,
}

function extractPriority(src: string, key: string): number | null {
  const re = new RegExp(
    `key:\\s*"${key}"[\\s\\S]{0,120}?priority:\\s*(\\d+)`,
  )
  const m = src.match(re)
  return m ? Number(m[1]) : null
}

describe("Dashboard AlertStack priority total order (Batch E)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
    "utf8",
  )

  it("every alert key has its assigned unique-slot priority", () => {
    for (const [key, expected] of Object.entries(EXPECTED)) {
      expect(extractPriority(src, key), key).toBe(expected)
    }
  })

  it("MUTATION: adjacent slots stay ordered (swap any adjacent pair → fail)", () => {
    const spendLimit = extractPriority(src, "spend-limit")!
    const heartbeatMissed = extractPriority(src, "heartbeat-missed")!
    const silence = extractPriority(src, "activity-silence")!
    const nearCap = extractPriority(src, "state-sync-near-cap")!
    const toolsExpired = extractPriority(src, "tools-expired")!
    const mcpDead = extractPriority(src, "mcp-session-dead")!
    const spendWarning = extractPriority(src, "spend-warning")!
    const trialActive = extractPriority(src, "trial-active")!
    expect(spendLimit).toBeLessThan(silence)
    // Ops-gap class: heartbeat-missed shares priority 4 with activity-silence
    expect(heartbeatMissed).toBe(4)
    expect(silence).toBe(4)
    expect(silence).toBeLessThan(nearCap)
    // Amended: functional degrade above money-soft/info
    expect(toolsExpired).toBeLessThan(mcpDead)
    expect(mcpDead).toBeLessThan(spendWarning)
    expect(spendWarning).toBeLessThan(trialActive)
  })

  it("ops-gap: heartbeat-missed is declared before activity-silence in source (inline winner)", () => {
    const missIdx = src.indexOf('key: "heartbeat-missed"')
    const silenceIdx = src.indexOf('key: "activity-silence"')
    expect(missIdx).toBeGreaterThan(-1)
    expect(silenceIdx).toBeGreaterThan(-1)
    expect(missIdx).toBeLessThan(silenceIdx)
  })

  it("sticky visibility: heartbeat-missed is NOT RUNNING-only (WIRE-TEST / hibernated class)", () => {
    // MUTATION: restoring `status === "RUNNING" &&` on showHeartbeatMissed → fail.
    const gate = src.match(
      /const showHeartbeatMissed\s*=\s*([\s\S]*?)(?=\n\s*const show)/,
    )
    expect(gate?.[1]).toBeTruthy()
    expect(gate![1]).not.toMatch(/status\s*===\s*["']RUNNING["']/)
    expect(gate![1]).toContain("heartbeatMissedAt")
  })

  it("DATA class: hibernation-refused shares priority 6 with state-sync-stale and is declared first", () => {
    const refused = extractPriority(src, "hibernation-refused")!
    const stale = extractPriority(src, "state-sync-stale")!
    expect(refused).toBe(6)
    expect(stale).toBe(6)
    expect(src.indexOf('key: "hibernation-refused"')).toBeLessThan(
      src.indexOf('key: "state-sync-stale"'),
    )
  })

  it("Optimize costs CTA is wired to Costs tab", () => {
    const spendBlock = src.slice(
      src.indexOf('key: "spend-warning"'),
      src.indexOf('key: "tools-expired"'),
    )
    expect(spendBlock).toContain("Optimize costs")
    expect(spendBlock).toContain("?tab=costs")
    expect(spendBlock).toContain("onClick")
  })
})
