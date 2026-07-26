/**
 * Shared contract: -10 catch-up beat emission shapes that clear sticky
 * heartbeatMissedAt via isHeartbeatBeatEvidence (activity roller).
 *
 * Catch-up must ledger either typed HEARTBEAT ("Heartbeat tick") or
 * TASK_START with the OpenClaw poll marker — same as scheduled fires.
 * MUTATION: narrowing evidence to HEARTBEAT-only breaks poll-marker catch-up.
 */
import { describe, expect, it } from "vitest"
import {
  isHeartbeatBeatEvidence,
  OPENCLAW_HEARTBEAT_POLL_MARKER,
} from "@/lib/hibernation/next-heartbeat"

describe("catch-up / scheduled beat evidence contract", () => {
  it("typed HEARTBEAT (reporter Heartbeat tick) clears sticky", () => {
    expect(
      isHeartbeatBeatEvidence({
        type: "HEARTBEAT",
        action: "Heartbeat tick",
      }),
    ).toBe(true)
  })

  it("poll-marker TASK_START clears sticky", () => {
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        action: `Heartbeat check ${OPENCLAW_HEARTBEAT_POLL_MARKER}`,
      }),
    ).toBe(true)
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        detail: `${OPENCLAW_HEARTBEAT_POLL_MARKER}\nprompt`,
      }),
    ).toBe(true)
  })

  it("overlay_boot never clears sticky (catch-up must not use boot alone)", () => {
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        metadata: { eventKind: "overlay_boot" },
        action: "Claws overlay boot",
      }),
    ).toBe(false)
  })

  it("Heartbeat check without poll-marker is NOT evidence (until typed HEARTBEAT)", () => {
    // Live fixture uses typed HEARTBEAT + "Heartbeat check"; check alone is not enough.
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        action: "Heartbeat check",
      }),
    ).toBe(false)
  })
})
