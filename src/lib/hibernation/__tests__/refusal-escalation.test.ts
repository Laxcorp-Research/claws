import { describe, expect, it } from "vitest"
import {
  decideRefusalEscalation,
  REFUSAL_ALERT_DEDUP_MS,
  REFUSAL_BACKOFF_CAP_MS,
  REFUSAL_SILENT_RETRIES,
  refusalBackoffMs,
} from "@/lib/hibernation/refusal-escalation"

const NOW = Date.parse("2026-09-16T09:00:00Z")

describe("decideRefusalEscalation", () => {
  it("attempts 1 and 2 are silent SYSTEM retries (no page)", () => {
    for (const prior of [0, 1]) {
      const d = decideRefusalEscalation({
        priorRefusalsThisEpisode: prior,
        lastAlertAtMs: null,
        nowMs: NOW,
      })
      expect(d.attempt).toBe(prior + 1)
      expect(d.sendAlert).toBe(false)
      expect(d.ledgerActionType).toBe("SYSTEM")
    }
  })

  it("attempt 3 (exhaust) pages ONCE with an ERROR row", () => {
    const d = decideRefusalEscalation({
      priorRefusalsThisEpisode: REFUSAL_SILENT_RETRIES - 1,
      lastAlertAtMs: null,
      nowMs: NOW,
    })
    expect(d.attempt).toBe(REFUSAL_SILENT_RETRIES)
    expect(d.sendAlert).toBe(true)
    expect(d.ledgerActionType).toBe("ERROR")
  })

  it("MUTATION: per-tick alert restored -> fails (attempt 4 inside the 12h dedup stays silent)", () => {
    const d = decideRefusalEscalation({
      priorRefusalsThisEpisode: 3,
      lastAlertAtMs: NOW - 60_000,
      nowMs: NOW,
    })
    expect(d.sendAlert).toBe(false)
    expect(d.ledgerActionType).toBe("SYSTEM")
  })

  it("re-pages after the 12h dedup window if still refusing", () => {
    const d = decideRefusalEscalation({
      priorRefusalsThisEpisode: 10,
      lastAlertAtMs: NOW - REFUSAL_ALERT_DEDUP_MS - 1,
      nowMs: NOW,
    })
    expect(d.sendAlert).toBe(true)
    expect(d.ledgerActionType).toBe("ERROR")
  })
})

describe("refusalBackoffMs", () => {
  it("no backoff before the first refusal; 2m/4m/8m-cap after", () => {
    expect(refusalBackoffMs(0)).toBe(0)
    expect(refusalBackoffMs(1)).toBe(2 * 60 * 1000)
    expect(refusalBackoffMs(2)).toBe(4 * 60 * 1000)
    expect(refusalBackoffMs(3)).toBe(REFUSAL_BACKOFF_CAP_MS)
    expect(refusalBackoffMs(9)).toBe(REFUSAL_BACKOFF_CAP_MS)
  })
})
