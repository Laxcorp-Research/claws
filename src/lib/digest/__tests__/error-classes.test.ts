import { describe, expect, it } from "vitest"
import {
  aggregateDigestErrorClasses,
  classifyDigestErrorRow,
  decideIngestErrorReclass,
  decideTransientStormAlert,
  DIGEST_ERROR_CLASSES,
  DIGEST_SECTION_HEADERS,
  isCountedDigestError,
  TRANSIENT_STORM_THRESHOLD,
} from "@/lib/digest/error-classes"
import { classifyDigestError } from "@/lib/digest/daily-health-digest"

/**
 * Row shapes below are verbatim from the prod canary trace
 * (cms1i48ta..., digest window 2026-09-14T06:00Z -> 09-15T06:00Z,
 * the "9 agent / 5 external" digest).
 */
const CANARY = {
  catchupSkip: {
    action: "Heartbeat catch-up skipped: beyond-grace",
    detail: "marker=catchup-v13 reason=beyond-grace",
    metadata: '{"eventKind":"heartbeat_catchup_skip","reason":"beyond-grace"}',
  },
  webFetch404: {
    action: "Tool web_fetch failed: Web fetch failed (404): SECURITY NOTICE: ...",
    detail: "Web fetch failed (404): SECURITY NOTICE: ...",
    metadata: '{"toolName":"web_fetch"}',
  },
  webFetchEmpty: {
    action:
      "Tool web_fetch failed: Web fetch extraction failed: Readability, provider fallback, and basic HTML cleanup returned no content.",
    detail: "Web fetch extraction failed: ...",
    metadata: '{"toolName":"web_fetch"}',
  },
  readEisdir: {
    action: "Tool read failed: EISDIR: illegal operation on a directory, read",
    detail: "EISDIR: illegal operation on a directory, read",
    metadata: '{"toolName":"read"}',
  },
  dirFetchUnknownNode: {
    action: "Tool dir_fetch failed: unknown node: local",
    detail: "unknown node: local",
    metadata: '{"toolName":"dir_fetch"}',
  },
  agentsWait: {
    action: "Tool agents_wait failed: {",
    detail: "{",
    metadata: '{"toolName":"agents_wait","error":"{"}',
  },
  sessionsYield: {
    action:
      "Tool sessions_yield failed: No pending child completion is owned by this turn. Continue working ...",
    detail: "No pending child completion is owned by this turn.",
    metadata: '{"toolName":"sessions_yield"}',
  },
  deadBearer: {
    action: "Tool http failed: HTTP 401 Unauthorized from api.twitter.com",
    detail: "401 Unauthorized: invalid bearer token",
    metadata: '{"toolName":"http"}',
  },
}

describe("classifyDigestErrorRow - canary row classes", () => {
  it("routes each canary row to its named class", () => {
    expect(classifyDigestErrorRow(CANARY.catchupSkip)).toBe("catchup-skip")
    expect(classifyDigestErrorRow(CANARY.webFetch404)).toBe("web-fetch-failed")
    expect(classifyDigestErrorRow(CANARY.webFetchEmpty)).toBe("web-fetch-failed")
    expect(classifyDigestErrorRow(CANARY.readEisdir)).toBe("file-tool-fumble")
    expect(classifyDigestErrorRow(CANARY.dirFetchUnknownNode)).toBe("file-tool-fumble")
    expect(classifyDigestErrorRow(CANARY.agentsWait)).toBe("session-plumbing")
    expect(classifyDigestErrorRow(CANARY.sessionsYield)).toBe("session-plumbing")
  })

  it("dead-Bearer 401s route to needs_you (tool-auth-dead), beating the fetch class", () => {
    expect(classifyDigestErrorRow(CANARY.deadBearer)).toBe("tool-auth-dead")
    expect(DIGEST_ERROR_CLASSES["tool-auth-dead"].section).toBe("needs_you")
  })

  it("unknown errors fall back to other-agent in Handled (never silently dropped)", () => {
    const cls = classifyDigestErrorRow({
      action: "Tool exotic failed: something new",
      metadata: '{"toolName":"exotic"}',
    })
    expect(cls).toBe("other-agent")
    expect(DIGEST_ERROR_CLASSES["other-agent"].section).toBe("handled")
  })
})

describe("sections + counting", () => {
  it("transient classes are excluded from the counted-errors headline", () => {
    expect(isCountedDigestError("catchup-skip")).toBe(false)
    expect(isCountedDigestError("session-plumbing")).toBe(false)
    expect(isCountedDigestError("file-tool-fumble")).toBe(false)
    expect(isCountedDigestError("web-fetch-failed")).toBe(true)
    expect(isCountedDigestError("tool-auth-dead")).toBe(true)
    expect(isCountedDigestError("other-agent")).toBe(true)
  })

  it("all three section headers exist and are distinct", () => {
    const headers = Object.values(DIGEST_SECTION_HEADERS)
    expect(headers).toHaveLength(3)
    expect(new Set(headers).size).toBe(3)
    expect(DIGEST_SECTION_HEADERS.needs_you).toContain("Needs you")
    expect(DIGEST_SECTION_HEADERS.handled).toContain("Handled automatically")
    expect(DIGEST_SECTION_HEADERS.transient).toContain("Transient, recovered")
  })

  it("aggregates count + first/last (UTC) per class, section-ordered", () => {
    const aggs = aggregateDigestErrorClasses([
      { ...CANARY.catchupSkip, timestamp: "2026-09-14T07:30:39.000Z" },
      { ...CANARY.catchupSkip, timestamp: "2026-09-14T19:30:43.000Z" },
      { ...CANARY.webFetch404, timestamp: "2026-09-14T08:00:26.000Z" },
      { ...CANARY.deadBearer, timestamp: "2026-09-14T09:00:00.000Z" },
    ])
    expect(aggs.map((a) => a.classId)).toEqual([
      "tool-auth-dead",
      "web-fetch-failed",
      "catchup-skip",
    ])
    const skip = aggs.find((a) => a.classId === "catchup-skip")
    expect(skip?.count).toBe(2)
    expect(skip?.firstAtUtc).toBe("07:30Z")
    expect(skip?.lastAtUtc).toBe("19:30Z")
  })
})

describe("legacy agent/external split - dir_fetch is a LOCAL tool", () => {
  it("MUTATION: dir_fetch / file_fetch no longer count as external (the includes-fetch heuristic is dead)", () => {
    // The canary's Sep-15 digest counted "Tool dir_fetch failed: unknown
    // node: local" as one of its "5 external" - a local file tool.
    expect(classifyDigestError('{"toolName":"dir_fetch"}')).toBe("agent")
    expect(classifyDigestError('{"toolName":"file_fetch"}')).toBe("agent")
    // The real external set is untouched.
    expect(classifyDigestError('{"toolName":"web_fetch"}')).toBe("external")
    expect(classifyDigestError('{"toolName":"http"}')).toBe("external")
  })
})

describe("decideIngestErrorReclass (activity-wire write path)", () => {
  it("routine catch-up skips (beyond-grace / no-due-job / disabled) become SYSTEM", () => {
    for (const reason of ["beyond-grace", "no-due-job", "disabled"]) {
      expect(
        decideIngestErrorReclass({
          type: "ERROR",
          action: `Heartbeat catch-up skipped: ${reason}`,
          detail: `marker=catchup-v13 reason=${reason}`,
          metadata: { eventKind: "heartbeat_catchup_skip", reason },
        }),
      ).toEqual({ storeActionType: "SYSTEM", transientClass: "catchup-skip" })
    }
  })

  it("alarming catch-up reasons stay ERROR (gateway-unhealthy / rpc-fail / cron-parser-unavailable)", () => {
    for (const reason of ["gateway-unhealthy", "rpc-fail", "cron-parser-unavailable", "no-jobs"]) {
      expect(
        decideIngestErrorReclass({
          type: "ERROR",
          action: `Heartbeat catch-up skipped: ${reason}`,
          metadata: { eventKind: "heartbeat_catchup_skip", reason },
        }),
      ).toBeNull()
    }
  })

  it("agents_wait / sessions_yield transients become SYSTEM session-plumbing", () => {
    expect(
      decideIngestErrorReclass({
        type: "ERROR",
        action: "Tool agents_wait failed: {",
        metadata: { toolName: "agents_wait" },
      }),
    ).toEqual({ storeActionType: "SYSTEM", transientClass: "session-plumbing" })
    expect(
      decideIngestErrorReclass({
        type: "ERROR",
        action: "Tool sessions_yield failed: No pending child completion is owned by this turn.",
        metadata: { toolName: "sessions_yield" },
      }),
    ).toEqual({ storeActionType: "SYSTEM", transientClass: "session-plumbing" })
  })

  it("real errors are NEVER reclassified (web_fetch, 401s, non-ERROR types)", () => {
    expect(
      decideIngestErrorReclass({
        type: "ERROR",
        action: CANARY.webFetch404.action,
        metadata: { toolName: "web_fetch" },
      }),
    ).toBeNull()
    expect(
      decideIngestErrorReclass({
        type: "ERROR",
        action: CANARY.deadBearer.action,
        detail: CANARY.deadBearer.detail,
        metadata: { toolName: "http" },
      }),
    ).toBeNull()
    expect(
      decideIngestErrorReclass({
        type: "SKILL_INVOKED",
        action: "Tool agents_wait invoked",
        metadata: { toolName: "agents_wait" },
      }),
    ).toBeNull()
  })
})

describe("decideTransientStormAlert", () => {
  it("pages the owner only at the threshold (bounded, never per-occurrence)", () => {
    expect(decideTransientStormAlert({ recentTransientCount: TRANSIENT_STORM_THRESHOLD - 1 })).toBe(
      false,
    )
    expect(decideTransientStormAlert({ recentTransientCount: TRANSIENT_STORM_THRESHOLD })).toBe(true)
  })
})
