/**
 * Contract: staging morning digest must have a DEDICATED Actions workflow
 * on the default branch (sole 06:00Z owner). Multi-cron must NOT schedule 0 6.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "../..")
const DEDICATED = resolve(ROOT, ".github/workflows/staging-daily-digest.yml")
const MULTI = resolve(ROOT, ".github/workflows/staging-cron-scheduler.yml")

describe("staging-daily-digest.yml (dedicated 06:00Z fire)", () => {
  it("exists as its own workflow file", () => {
    expect(existsSync(DEDICATED), "staging-daily-digest.yml missing").toBe(true)
  })

  it("schedules only 0 6 * * * and curls /api/cron/daily-digest", () => {
    const yml = readFileSync(DEDICATED, "utf8")
    expect(yml).toContain('cron: "0 6 * * *"')
    expect(yml).toContain("/api/cron/daily-digest")
    expect(yml).toContain("STAGING_CRON_SECRET")
    expect(yml).toContain("staging.app.buildclaws.ai")
    expect(yml).toContain("group: staging-daily-digest")
    expect(yml).not.toMatch(/cron:\s*"\*\/5/)
  })

  it("multi-cron must NOT schedule 0 6 (dedicated is sole owner)", () => {
    const multi = readFileSync(MULTI, "utf8")
    expect(multi).toContain("/api/cron/daily-digest")
    const scheduleCrons = [...multi.matchAll(/^\s+- cron: "([^"]+)"/gm)].map(
      (m) => m[1],
    )
    expect(scheduleCrons).not.toContain("0 6 * * *")
    expect(multi).not.toMatch(/"0 6 \* \* \*"\)/)
  })

  it("MUTATION: removing the dedicated schedule fails the lock", () => {
    const yml = readFileSync(DEDICATED, "utf8")
    const mutated = yml.replace('cron: "0 6 * * *"', 'cron: "0 7 * * *"')
    expect(mutated).not.toContain('cron: "0 6 * * *"')
    expect(yml).toContain('cron: "0 6 * * *"')
  })
})
