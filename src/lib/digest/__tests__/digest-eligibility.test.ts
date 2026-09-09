import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DIGEST_EXCLUDED_STATUSES,
  digestCandidateWhere,
  hasConnectedTelegramForDigest,
  parseDigestWorkspaceIdOverride,
} from "@/lib/digest/digest-eligibility"

describe("parseDigestWorkspaceIdOverride", () => {
  it("returns null for empty / whitespace (default = full predicate)", () => {
    expect(parseDigestWorkspaceIdOverride(undefined)).toBeNull()
    expect(parseDigestWorkspaceIdOverride(null)).toBeNull()
    expect(parseDigestWorkspaceIdOverride("")).toBeNull()
    expect(parseDigestWorkspaceIdOverride("   ")).toBeNull()
  })

  it("parses comma-separated debug override ids", () => {
    expect(parseDigestWorkspaceIdOverride("a, b ,c")).toEqual(["a", "b", "c"])
  })
})

describe("digestCandidateWhere", () => {
  it("excludes DRAFT / SETUP_INCOMPLETE / STOPPED; includes HIBERNATED path", () => {
    const where = digestCandidateWhere(null)
    expect(where.status.notIn).toEqual([
      "DRAFT",
      "SETUP_INCOMPLETE",
      "STOPPED",
    ])
    expect(DIGEST_EXCLUDED_STATUSES).not.toContain("HIBERNATED")
    expect(DIGEST_EXCLUDED_STATUSES).not.toContain("RUNNING")
    expect(where.containerState.nextHeartbeatAt).toEqual({ not: null })
    expect(where.deployments.some.status.in).toEqual([
      "COMPLETED",
      "SUPERSEDED",
    ])
    expect(where.id).toBeUndefined()
    expect(
      "channelConfigEncrypted" in (where as Record<string, unknown>),
    ).toBe(false)
  })

  it("debug override restricts id.in but keeps the predicate", () => {
    const where = digestCandidateWhere(["ws-fixture"])
    expect(where.id).toEqual({ in: ["ws-fixture"] })
    expect(where.containerState.nextHeartbeatAt).toEqual({ not: null })
    expect(where.status.notIn).toContain("STOPPED")
  })

  it("MUTATION: COMPLETED-only ever-deployed would drop hibernated SUPERSEDED", () => {
    const where = digestCandidateWhere(null)
    // Hibernate retires COMPLETED → SUPERSEDED; sleeping claws must still digest.
    expect(where.deployments.some.status.in).toContain("SUPERSEDED")
    expect(where.deployments.some.status.in).toContain("COMPLETED")
  })

  it("MUTATION: dropping nextHeartbeatAt armed gate fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/digest/digest-eligibility.ts"),
      "utf8",
    )
    expect(src).toContain("nextHeartbeatAt: { not: null }")
  })
})

describe("hasConnectedTelegramForDigest", () => {
  it("requires botToken + allowFrom[0]", () => {
    expect(
      hasConnectedTelegramForDigest(
        { telegram: { botToken: "bt", allowFrom: [42] } },
        "owner@example.com",
      ),
    ).toBe(true)
    expect(
      hasConnectedTelegramForDigest(
        { telegram: { botToken: "bt" } },
        "owner@example.com",
      ),
    ).toBe(false)
    expect(hasConnectedTelegramForDigest({}, "owner@example.com")).toBe(false)
  })
})

describe("daily-digest route uses eligibility module", () => {
  it("MUTATION: route must call digestCandidateWhere + hasConnectedTelegramForDigest", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-digest/route.ts"),
      "utf8",
    )
    expect(src).toContain("digestCandidateWhere")
    expect(src).toContain("hasConnectedTelegramForDigest")
    expect(src).toContain("parseDigestWorkspaceIdOverride")
    expect(src).toContain('kind: "daily_digest"')
    expect(src).toContain("watchDigestMissed")
    // Old broad predicate must not return.
    expect(src).not.toMatch(/status:\s*\{\s*not:\s*"DRAFT"\s*\}/)
  })
})
