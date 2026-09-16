import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  classifyDigestError,
  computeDigestStats,
  DAILY_DIGEST_EVENT_KIND,
  formatDailyDigestMessage,
  formatRemindedLabel,
  type DigestWindowStats,
} from "@/lib/digest/daily-health-digest"
import { aggregateDigestErrorClasses } from "@/lib/digest/error-classes"

function emptyStats(overrides: Partial<DigestWindowStats> = {}): DigestWindowStats {
  return {
    heartbeatsKept: 0,
    heartbeatsMissedLedgered: 0,
    sleepWakeCycles: 0,
    costCents24h: 0,
    costIsEstimate: false,
    strands: 0,
    errors24h: 0,
    errorsAgent24h: 0,
    errorsExternal24h: 0,
    errorsCounted24h: 0,
    errorClasses: [],
    ...overrides,
  }
}

/** Canary-shaped fixture: the Sep-15 "9 agent / 5 external" window as classes. */
function canaryStats(): DigestWindowStats {
  const errorClasses = aggregateDigestErrorClasses([
    ...Array.from({ length: 8 }, (_, i) => ({
      action: "Heartbeat catch-up skipped: beyond-grace",
      detail: "marker=catchup-v13 reason=beyond-grace",
      metadata: '{"eventKind":"heartbeat_catchup_skip","reason":"beyond-grace"}',
      timestamp: `2026-09-14T${String(7 + i).padStart(2, "0")}:30:00.000Z`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      action: "Tool web_fetch failed: Web fetch failed (404): SECURITY NOTICE ...",
      metadata: '{"toolName":"web_fetch"}',
      timestamp: `2026-09-14T08:0${i}:00.000Z`,
    })),
    {
      action: "Tool read failed: EISDIR: illegal operation on a directory, read",
      metadata: '{"toolName":"read"}',
      timestamp: "2026-09-14T21:00:23.000Z",
    },
    {
      action: "Tool dir_fetch failed: unknown node: local",
      metadata: '{"toolName":"dir_fetch"}',
      timestamp: "2026-09-14T21:00:26.000Z",
    },
  ])
  return emptyStats({
    heartbeatsKept: 5,
    sleepWakeCycles: 6,
    costCents24h: 123,
    costIsEstimate: true,
    errors24h: 14,
    errorsAgent24h: 10,
    errorsExternal24h: 4,
    errorsCounted24h: 4,
    errorClasses,
  })
}

describe("formatDailyDigestMessage v2 - three honest sections", () => {
  it("renders the canary window: named classes, counts, first/last, deep links, nudge dedup", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "Twitter/X Growth Machine",
      asOfUtc: "2026-09-15T06:00:00.000Z",
      stats: canaryStats(),
      openNudges: [
        {
          condition: "tool-connection-error",
          action: "Fix or reconnect the broken tool, then resume.",
          remindedAt: "2026-09-09T06:00:00.000Z",
        },
      ],
      appUrl: "https://app.buildclaws.ai",
      workspaceId: "cms1i48ta000004ld4q126k3l",
    })

    // Kept lines stay.
    expect(text).toContain("Claws digest - Twitter/X Growth Machine")
    expect(text).toContain("Heartbeats: kept 5 | missed+ledgered 0")
    expect(text).toContain("Sleep/wake cycles: 6")
    expect(text).toContain("Costs (est.): $1.23")

    // Honest headline: transient recoveries are not errors.
    expect(text).toContain("Errors that count: 4 (14 ledgered; 10 transient recoveries excluded)")

    // Section 1: Needs you - ONE action + dedup + dashboard link.
    expect(text).toContain("Needs you:")
    expect(text).toContain(
      "- Fix or reconnect the broken tool, then resume. (tool-connection-error; reminded Sep 9) -> https://app.buildclaws.ai/dashboard/cms1i48ta000004ld4q126k3l",
    )

    // Section 2: Handled automatically - class + count + window + deep link.
    expect(text).toContain("Handled automatically (mission continued):")
    expect(text).toContain(
      "- External pages failed to load (dead links, 4xx/5xx); the agent used other sources - 4x, 08:00Z-08:03Z -> https://app.buildclaws.ai/dashboard/cms1i48ta000004ld4q126k3l?tab=activity&aq=Tool%20web_fetch%20failed",
    )

    // Section 3: Transient, recovered - catch-up skips + file fumbles named.
    expect(text).toContain("Transient, recovered (not counted as errors):")
    expect(text).toContain(
      "- Wake-time heartbeat catch-up declined stale windows (routine; no beat was lost) - 8x, 07:30Z-14:30Z -> https://app.buildclaws.ai/dashboard/cms1i48ta000004ld4q126k3l?tab=activity&aq=Heartbeat%20catch-up%20skipped",
    )
    expect(text).toContain(
      "- Agent file lookups hit a wrong path and retried (EISDIR / ENOENT / unknown node) - 2x, at 21:00Z",
    )
  })

  it("MUTATION: count-only digest restored -> fails (all three section headers are mandatory even when empty)", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "Quiet Claw",
      asOfUtc: "2026-09-15T06:00:00.000Z",
      stats: emptyStats(),
    })
    // A digest with zero errors still renders the sections - reverting to
    // the old single "Errors: N agent · M external" line kills these.
    expect(text).toContain("Needs you:")
    expect(text).toContain("Handled automatically (mission continued):")
    expect(text).toContain("Transient, recovered (not counted as errors):")
    expect(text).toContain("- nothing")
    expect(text).not.toMatch(/Errors: \d+ agent · \d+ external/)
  })

  it("MUTATION: digest body must include workspace name", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "Quant Trader",
      asOfUtc: "2026-08-10T06:00:00.000Z",
      stats: emptyStats(),
    })
    expect(text.startsWith("Claws digest - Quant Trader")).toBe(true)
  })

  it("labels Costs (not est.) for credit-mode real cents", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "W",
      asOfUtc: "2026-08-01T06:00:00.000Z",
      stats: emptyStats({ costCents24h: 50 }),
    })
    expect(text).toContain("Costs: $0.50")
    expect(text).not.toContain("Costs (est.)")
  })

  it("omits links when appUrl/workspaceId are absent (Telegram-safe plain text)", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "W",
      asOfUtc: "2026-09-15T06:00:00.000Z",
      stats: canaryStats(),
    })
    expect(text).not.toContain("->")
    expect(text).toContain("Handled automatically (mission continued):")
  })
})

describe("formatRemindedLabel", () => {
  it("renders UTC month-day and tolerates null/invalid", () => {
    expect(formatRemindedLabel("2026-09-09T23:59:00.000Z")).toBe("Sep 9")
    expect(formatRemindedLabel(null)).toBeNull()
    expect(formatRemindedLabel("not-a-date")).toBeNull()
  })
})

describe("classifyDigestError + Day-1 five", () => {
  it("Day-1 five classify 4 external / 1 agent", () => {
    const day1 = [
      { toolName: "web_fetch" },
      { toolName: "web_fetch" },
      { toolName: "web_fetch" },
      { toolName: "web_fetch" },
      { toolName: "read" },
    ]
    const classes = day1.map((m) => classifyDigestError(JSON.stringify(m)))
    expect(classes.filter((c) => c === "external")).toHaveLength(4)
    expect(classes.filter((c) => c === "agent")).toHaveLength(1)
  })

  it("MUTATION: treating web_fetch as agent fails Day-1 split", () => {
    expect(classifyDigestError('{"toolName":"web_fetch"}')).toBe("external")
    expect(classifyDigestError('{"toolName":"read"}')).toBe("agent")
  })
})

describe("computeDigestStats", () => {
  it("counts typed HEARTBEAT ticks as kept; miss ledger; splits errors; excludes transients from counted", () => {
    const stats = computeDigestStats({
      costCents24h: 50,
      costIsEstimate: false,
      strandOpen: true,
      rows: [
        { actionType: "HEARTBEAT", action: "Heartbeat tick", metadata: "{}" },
        { actionType: "HEARTBEAT", action: "Heartbeat tick", metadata: "{}" },
        {
          actionType: "TASK_START",
          action: "Task started: [OpenClaw heartbeat poll]",
          metadata: '{"promptPreview":"[OpenClaw heartbeat poll]"}',
        },
        {
          actionType: "ERROR",
          action: "Heartbeat missed",
          metadata: '{"eventKind":"heartbeat_missed"}',
        },
        {
          actionType: "SYSTEM",
          action: "Wake ack sent",
          metadata: '{"eventKind":"wake_ack_sent"}',
        },
        {
          actionType: "ERROR",
          action: "Tool read failed: EISDIR: illegal operation on a directory, read",
          metadata: '{"toolName":"read"}',
          timestamp: "2026-09-15T21:00:00.000Z",
        },
        {
          actionType: "ERROR",
          action: "Tool web_fetch failed: Web fetch failed (404)",
          metadata: '{"toolName":"web_fetch"}',
          timestamp: "2026-09-15T08:00:00.000Z",
        },
      ],
    })
    expect(stats.heartbeatsKept).toBe(2)
    expect(stats.heartbeatsMissedLedgered).toBe(1)
    expect(stats.sleepWakeCycles).toBe(1)
    expect(stats.costCents24h).toBe(50)
    expect(stats.strands).toBe(1)
    expect(stats.errors24h).toBe(3)
    expect(stats.errorsAgent24h).toBe(2)
    expect(stats.errorsExternal24h).toBe(1)
    // Counted excludes the EISDIR file fumble (transient) but keeps the
    // web_fetch failure and the heartbeat_missed (other-agent) row.
    expect(stats.errorsCounted24h).toBe(2)
    expect(stats.errorClasses.map((c) => c.classId)).toContain("file-tool-fumble")
    expect(stats.errorClasses.map((c) => c.classId)).toContain("web-fetch-failed")
  })

  it("counts hibernation_complete ledger as a sleep/wake cycle (not pair-only)", () => {
    const stats = computeDigestStats({
      costCents24h: 0,
      strandOpen: false,
      rows: [
        {
          actionType: "SYSTEM",
          action: "Workspace hibernated",
          metadata: '{"eventKind":"hibernation_complete","nextHeartbeatAt":"2026-08-11T08:00:00.000Z"}',
        },
      ],
    })
    expect(stats.sleepWakeCycles).toBe(1)
  })

  it("MUTATION: manager must ledger hibernation_complete on success", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/manager.ts"),
      "utf8",
    )
    expect(src).toContain("hibernation_complete")
    expect(src).toContain("Workspace hibernated")
  })
})

describe("daily-digest route contract", () => {
  it("MUTATION: route must ledger daily_digest_sent + use formatDailyDigestMessage + v2 inputs", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-digest/route.ts"),
      "utf8",
    )
    expect(src).toContain("formatDailyDigestMessage")
    expect(src).toContain("DAILY_DIGEST_EVENT_KIND")
    expect(src).toContain("telegramSendMessage")
    expect(src).toContain("CRON_SECRET")
    expect(src).toContain("digestCandidateWhere")
    expect(src).toContain("resolveDigestCostCents")
    expect(src).toContain("already-sent-today")
    // v2: nudge dedup + deep links + format version are wired.
    expect(src).toContain("listOpenUserOnlyNudges")
    expect(src).toContain("resolvePublicAppUrl")
    expect(src).toContain("DAILY_DIGEST_FORMAT_VERSION")
    expect(src).toContain("timestamp: true")
    expect(DAILY_DIGEST_EVENT_KIND).toBe("daily_digest_sent")
  })
})
