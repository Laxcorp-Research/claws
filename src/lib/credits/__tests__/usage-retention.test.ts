import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CREDIT_USAGE_RETENTION_MS,
  creditUsageRetentionCutoff,
  PRE_INSTRUMENTATION_NOTE_EVENT_KIND,
} from "@/lib/credits/usage-retention"

describe("credit usage retention", () => {
  it("retains raw rows for 90 days (not 7)", () => {
    expect(CREDIT_USAGE_RETENTION_MS).toBe(90 * 86400000)
    const now = new Date("2026-08-10T00:00:00.000Z")
    expect(creditUsageRetentionCutoff(now).toISOString()).toBe("2026-05-12T00:00:00.000Z")
  })

  it("MUTATION: aggregate-credit-usage must use CREDIT_USAGE_RETENTION_MS (not bare 7d)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/aggregate-credit-usage/route.ts"),
      "utf8",
    )
    expect(src).toContain("creditUsageRetentionCutoff")
    expect(src).toContain("usage-retention")
    expect(src).not.toMatch(/7\s*\*\s*86400000/)
  })

  it("MUTATION: report-batch must createMany usage rows", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/metering/report-batch/route.ts"),
      "utf8",
    )
    expect(src).toContain("creditUsageRecord.createMany")
    expect(src).toContain("idempotencyKey")
  })

  it("MUTATION: aggregate daily upsert SET (not increment) — drop → double-count class", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/aggregate-credit-usage/route.ts"),
      "utf8",
    )
    expect(src).toMatch(/totalCostCents:\s*r\._sum\.costCents/)
    expect(src).not.toMatch(/totalCostCents:\s*\{\s*increment:/)
  })

  it("pre-instrumentation note kind is stable", () => {
    expect(PRE_INSTRUMENTATION_NOTE_EVENT_KIND).toBe("credit_usage_pre_instrumentation_note")
  })
})
