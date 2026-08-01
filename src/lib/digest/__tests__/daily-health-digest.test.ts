import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  classifyDigestError,
  computeDigestStats,
  DAILY_DIGEST_EVENT_KIND,
  formatDailyDigestMessage,
} from "@/lib/digest/daily-health-digest"

describe("formatDailyDigestMessage", () => {
  it("renders honest error split + Costs (est.) when estimated", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "Twitter/X Growth Machine (5)",
      asOfUtc: "2026-07-31T06:00:00.000Z",
      stats: {
        heartbeatsKept: 4,
        heartbeatsMissedLedgered: 0,
        sleepWakeCycles: 1,
        costCents24h: 123,
        costIsEstimate: true,
        strands: 0,
        errors24h: 5,
        errorsAgent24h: 1,
        errorsExternal24h: 4,
      },
    })
    expect(text).toContain("Claws digest — Twitter/X Growth Machine (5)")
    expect(text).toContain("Heartbeats: kept 4 | missed+ledgered 0")
    expect(text).toContain("Sleep/wake cycles: 1")
    expect(text).toContain("Costs (est.): $1.23")
    expect(text).not.toContain("\nCosts: $1.23")
    expect(text).toContain("Strands: 0")
    expect(text).toContain("Errors: 1 agent · 4 external")
  })

  it("labels Costs (not est.) for credit-mode real cents", () => {
    const text = formatDailyDigestMessage({
      workspaceName: "W",
      asOfUtc: "2026-08-01T06:00:00.000Z",
      stats: {
        heartbeatsKept: 0,
        heartbeatsMissedLedgered: 0,
        sleepWakeCycles: 0,
        costCents24h: 50,
        costIsEstimate: false,
        strands: 0,
        errors24h: 0,
        errorsAgent24h: 0,
        errorsExternal24h: 0,
      },
    })
    expect(text).toContain("Costs: $0.50")
    expect(text).not.toContain("Costs (est.)")
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
  it("counts typed HEARTBEAT ticks as kept; miss ledger; splits errors", () => {
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
          action: "Tool read failed",
          metadata: '{"toolName":"read"}',
        },
        {
          actionType: "ERROR",
          action: "Tool web_fetch failed",
          metadata: '{"toolName":"web_fetch"}',
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
    expect(src).toContain("resolveDigestCostCents")
    expect(src).toContain("already-sent-today")
    expect(DAILY_DIGEST_EVENT_KIND).toBe("daily_digest_sent")
  })
})
