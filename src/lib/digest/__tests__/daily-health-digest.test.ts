import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  computeDigestStats,
  DAILY_DIGEST_EVENT_KIND,
  formatDailyDigestMessage,
} from "@/lib/digest/daily-health-digest"

describe("formatDailyDigestMessage", () => {
  it("renders the 5-line health table (+ header)", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "Twitter/X Growth Machine (5)",
      asOfUtc: "2026-07-31T06:00:00.000Z",
      stats: {
        heartbeatsKept: 4,
        heartbeatsMissedLedgered: 0,
        sleepWakeCycles: 1,
        costCents24h: 123,
        strands: 0,
        errors24h: 2,
      },
    })
    expect(text).toContain("Claws digest — Twitter/X Growth Machine (5)")
    expect(text).toContain("Heartbeats: kept 4 | missed+ledgered 0")
    expect(text).toContain("Sleep/wake cycles: 1")
    expect(text).toContain("Costs: $1.23")
    expect(text).toContain("Strands: 0")
    expect(text).toContain("Errors: 2")
  })
})

describe("computeDigestStats", () => {
  it("counts typed HEARTBEAT ticks as kept; miss ledger; errors", () => {
    const stats = computeDigestStats({
      costCents24h: 50,
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
        { actionType: "ERROR", action: "Tool read failed", metadata: "{}" },
      ],
    })
    expect(stats.heartbeatsKept).toBe(2)
    expect(stats.heartbeatsMissedLedgered).toBe(1)
    expect(stats.sleepWakeCycles).toBe(1)
    expect(stats.costCents24h).toBe(50)
    expect(stats.strands).toBe(1)
    expect(stats.errors24h).toBe(2)
  })
})

describe("daily-digest route contract", () => {
  it("MUTATION: route must ledger daily_digest_sent + use formatDailyDigestMessage", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-digest/route.ts"),
      "utf8",
    )
    expect(src).toContain("formatDailyDigestMessage")
    expect(src).toContain("DAILY_DIGEST_EVENT_KIND")
    expect(src).toContain("telegramSendMessage")
    expect(src).toContain("CRON_SECRET")
    expect(src).toContain("digestCandidateWhere")
    expect(DAILY_DIGEST_EVENT_KIND).toBe("daily_digest_sent")
  })
})
