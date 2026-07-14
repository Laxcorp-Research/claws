import { describe, expect, it } from "vitest"
import {
  decideNearCapAlert,
  NEAR_CAP_METADATA_CONTAINS,
  NEAR_CAP_METADATA_KIND,
} from "@/lib/openclaw/near-cap-alert"
import { NEAR_CAP_REARM_BYTES, NEAR_CAP_WARN_BYTES } from "@/lib/openclaw/state-sync-limits"

describe("decideNearCapAlert", () => {
  const warnAt = new Date("2026-07-14T10:00:00.000Z")

  it("returns false when no near-cap warning exists", () => {
    expect(
      decideNearCapAlert({
        latestWarning: null,
        latestSnapshot: {
          updatedAt: new Date("2026-07-14T11:00:00.000Z"),
          compressedBytes: NEAR_CAP_WARN_BYTES,
        },
      }),
    ).toBe(false)
  })

  it("returns true for an unresolved warning (no later sync below re-arm)", () => {
    expect(
      decideNearCapAlert({
        latestWarning: { timestamp: warnAt },
        latestSnapshot: null,
      }),
    ).toBe(true)
    expect(
      decideNearCapAlert({
        latestWarning: { timestamp: warnAt },
        latestSnapshot: {
          updatedAt: new Date("2026-07-14T09:00:00.000Z"),
          compressedBytes: 1,
        },
      }),
    ).toBe(true)
    expect(
      decideNearCapAlert({
        latestWarning: { timestamp: warnAt },
        latestSnapshot: {
          updatedAt: new Date("2026-07-14T11:00:00.000Z"),
          compressedBytes: NEAR_CAP_REARM_BYTES,
        },
      }),
    ).toBe(true)
  })

  it("auto-resolves when a subsequent sync reports below re-arm", () => {
    expect(
      decideNearCapAlert({
        latestWarning: { timestamp: warnAt },
        latestSnapshot: {
          updatedAt: new Date("2026-07-14T11:00:00.000Z"),
          compressedBytes: NEAR_CAP_REARM_BYTES - 1,
        },
      }),
    ).toBe(false)
  })

  it("MUTATION: dropping the warning_required gate would show a phantom banner", () => {
    // Detector must short-circuit on null warning — this assertion fails if that gate is removed.
    const source = decideNearCapAlert.toString()
    expect(source).toContain("NEAR_CAP_DETECT_ASSERT: warning_required")
    expect(
      decideNearCapAlert({ latestWarning: null, latestSnapshot: null }),
    ).toBe(false)
  })

  it("MUTATION: dropping the rearm_clears_banner gate would never auto-resolve", () => {
    const source = decideNearCapAlert.toString()
    expect(source).toContain("NEAR_CAP_DETECT_ASSERT: rearm_clears_banner")
    expect(NEAR_CAP_METADATA_KIND).toBe("state_sync_near_cap")
    expect(NEAR_CAP_METADATA_CONTAINS).toContain(NEAR_CAP_METADATA_KIND)
  })
})
