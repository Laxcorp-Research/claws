import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CRON_JOB_FAILED_RE,
  CRON_JOB_FAILED_MIN_COUNT,
  decideCronJobFailedAlert,
  extractCronJobName,
  isCronJobFailedEvent,
} from "@/lib/alerts/cron-job-failed-detect"

describe("isCronJobFailedEvent", () => {
  it("detection matrix: MESSAGE_SENT with 'Cron job \"...\" failed' matches", () => {
    expect(
      isCronJobFailedEvent({
        type: "MESSAGE_SENT",
        action: 'Sent to telegram: Cron job "orchestrator-heartbeat-md-0-12-16-20" failed: LLM request rejected',
      }),
    ).toBe(true)
  })

  it("detection matrix: MESSAGE_SENT without the cron-fail shape does not match", () => {
    expect(
      isCronJobFailedEvent({
        type: "MESSAGE_SENT",
        action: "Sent to telegram: heartbeat OK",
      }),
    ).toBe(false)
  })

  it("detection matrix: non-MESSAGE_SENT types never match, even with matching text", () => {
    expect(
      isCronJobFailedEvent({
        type: "ERROR",
        detail: 'Cron job "job-a" failed: boom',
      }),
    ).toBe(false)
  })

  it("matches from detail when action lacks the shape", () => {
    expect(
      isCronJobFailedEvent({
        type: "MESSAGE_SENT",
        action: "delivery failed",
        detail: 'Cron job "job-b" failed: timeout',
      }),
    ).toBe(true)
  })
})

describe("extractCronJobName", () => {
  it("extracts the job name from the first matching text argument", () => {
    expect(
      extractCronJobName('Sent to telegram: Cron job "orchestrator-heartbeat-md-0-12-16-20" failed: x', null),
    ).toBe("orchestrator-heartbeat-md-0-12-16-20")
  })

  it("checks later arguments when earlier ones don't match", () => {
    expect(extractCronJobName("no match here", 'Cron job "job-c" failed')).toBe("job-c")
  })

  it("returns null when nothing matches", () => {
    expect(extractCronJobName("nothing", null, undefined)).toBeNull()
  })
})

describe("decideCronJobFailedAlert", () => {
  it("does not alert on a single failure", () => {
    expect(decideCronJobFailedAlert({ recentFailureCount: 1 })).toBe(false)
  })

  it("alerts once the same job has failed twice (or more) in-window", () => {
    expect(decideCronJobFailedAlert({ recentFailureCount: CRON_JOB_FAILED_MIN_COUNT })).toBe(true)
    expect(decideCronJobFailedAlert({ recentFailureCount: CRON_JOB_FAILED_MIN_COUNT + 3 })).toBe(true)
  })

  it("does not alert on zero failures", () => {
    expect(decideCronJobFailedAlert({ recentFailureCount: 0 })).toBe(false)
  })

  it("MUTATION: threshold comparison must be live (not hardcoded true/false)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/alerts/cron-job-failed-detect.ts"),
      "utf8",
    )
    expect(src).toContain("CRON_JOB_FAILED_MIN_COUNT")
    expect(src).toMatch(/recentFailureCount\s*>=\s*CRON_JOB_FAILED_MIN_COUNT/)
    expect(CRON_JOB_FAILED_RE.test('Cron job "x" failed')).toBe(true)
  })
})
