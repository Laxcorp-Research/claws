/**
 * -11 catch-up-beat contract (repo-side, against overlay code).
 *
 * in-grace boot fires exactly once; each skip branch ledgers its reason.
 * MUTATION: remove skip-ledger → reason test fails.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"
import { CronExpressionParser } from "cron-parser"
import { isHeartbeatBeatEvidence } from "@/lib/hibernation/next-heartbeat"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let catchup: any

beforeEach(async () => {
  vi.resetModules()
  catchup = await import("../../container/heartbeat-catchup.mjs")
})

describe("heartbeat catch-up (-11)", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  function writeJobs(jobs: unknown[]) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-catchup-"))
    fs.mkdirSync(path.join(dir, "cron"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "cron", "jobs.json"),
      JSON.stringify(jobs, null, 2),
    )
    fs.writeFileSync(
      path.join(dir, ".env"),
      "OPENCLAW_GATEWAY_TOKEN=test-gw-token\n",
    )
    return dir
  }

  const dailyJob = {
    id: "heartbeat-twitter-commander-md-0-8",
    name: "orchestrator-heartbeat-md-0-8",
    enabled: true,
    schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
  }

  function healthyFetch() {
    const calls: unknown[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"))
      calls.push(body)
      if (body.method === "health") {
        return new Response(JSON.stringify({ ok: true, payload: { ok: true } }), {
          status: 200,
        })
      }
      if (body.method === "cron.run") {
        return new Response(
          JSON.stringify({ ok: true, payload: { ok: true, enqueued: true } }),
          { status: 200 },
        )
      }
      return new Response("nope", { status: 404 })
    })
    return { fetchImpl, calls }
  }

  it("in-grace boot fires exactly once (catchup-v12)", async () => {
    writeJobs([dailyJob])
    const now = new Date("2026-07-24T08:10:00.000Z")
    const { fetchImpl, calls } = healthyFetch()
    const ledger = vi.fn()

    const result = await catchup.runHeartbeatCatchupOnBoot({
      dataDir: dir,
      port: "18789",
      now,
      fetchImpl,
      CronExpressionParser,
      ledger,
      jobsReadyTimeoutMs: 50,
      gatewayReadyTimeoutMs: 2000,
    })

    expect(result.ran).toBe(true)
    expect(result.reason).toBe("catchup-fired")
    expect(result.marker).toBe("catchup-v12")
    expect(result.expectedAt).toBe("2026-07-24T08:00:00.000Z")
    expect(result.jobId).toBe(dailyJob.id)
    expect(result.nextFireAt).toBe("2026-07-25T08:00:00.000Z")
    expect(ledger).not.toHaveBeenCalled()

    const runs = calls.filter(
      (c) => (c as { method?: string }).method === "cron.run",
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual({
      method: "cron.run",
      params: { id: dailyJob.id, mode: "force" },
    })
    expect(isHeartbeatBeatEvidence(result.evidenceShape)).toBe(true)
  })

  it("each skip branch ledgers its reason", async () => {
    const cases: Array<{
      reason: string
      setup: () => void
      env?: Record<string, string>
      fetchImpl?: ReturnType<typeof vi.fn>
      now?: Date
    }> = [
      {
        reason: "disabled",
        setup: () => writeJobs([dailyJob]),
        env: { CLAWS_HEARTBEAT_CATCHUP_DISABLED: "true" },
        now: new Date("2026-07-24T08:10:00.000Z"),
      },
      {
        reason: "no-jobs",
        setup: () => {
          dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-catchup-"))
          // no cron/jobs.json
          fs.writeFileSync(
            path.join(dir, ".env"),
            "OPENCLAW_GATEWAY_TOKEN=test-gw-token\n",
          )
        },
        now: new Date("2026-07-24T08:10:00.000Z"),
        fetchImpl: healthyFetch().fetchImpl,
      },
      {
        reason: "gateway-unhealthy",
        setup: () => writeJobs([dailyJob]),
        now: new Date("2026-07-24T08:10:00.000Z"),
        fetchImpl: vi.fn(async () => new Response("down", { status: 503 })),
      },
      {
        reason: "beyond-grace",
        setup: () => writeJobs([dailyJob]),
        now: new Date("2026-07-24T08:45:00.000Z"),
        fetchImpl: healthyFetch().fetchImpl,
      },
      {
        reason: "no-due-job",
        setup: () =>
          writeJobs([
            {
              id: "other-job",
              name: "not-a-heartbeat",
              enabled: true,
              schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
            },
          ]),
        now: new Date("2026-07-24T08:10:00.000Z"),
        fetchImpl: healthyFetch().fetchImpl,
      },
      {
        reason: "rpc-fail",
        setup: () => writeJobs([dailyJob]),
        now: new Date("2026-07-24T08:10:00.000Z"),
        fetchImpl: vi.fn(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}"))
          if (body.method === "health") {
            return new Response(JSON.stringify({ ok: true }), { status: 200 })
          }
          return new Response(JSON.stringify({ ok: false, error: "boom" }), {
            status: 500,
          })
        }),
      },
    ]

    for (const c of cases) {
      const ledger = vi.fn(async () => ({ ok: true }))
      c.setup()
      const result = await catchup.runHeartbeatCatchupOnBoot({
        dataDir: dir,
        port: "18789",
        now: c.now ?? new Date("2026-07-24T08:10:00.000Z"),
        fetchImpl: c.fetchImpl ?? healthyFetch().fetchImpl,
        CronExpressionParser,
        env: c.env ?? {},
        ledger,
        jobsReadyTimeoutMs: 20,
        gatewayReadyTimeoutMs: 200,
        sleep: async () => {},
      })
      expect(result.ran, c.reason).toBe(false)
      expect(result.reason, c.reason).toBe(c.reason)
      expect(ledger, c.reason).toHaveBeenCalled()
      const calls = ledger.mock.calls as unknown as Array<
        [{ metadata: { eventKind: string; reason: string; marker: string } }]
      >
      const event = calls[0]![0]!
      expect(event.metadata.eventKind).toBe("heartbeat_catchup_skip")
      expect(event.metadata.reason).toBe(c.reason)
      expect(event.metadata.marker).toBe("catchup-v12")
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
        dir = ""
      }
    }
  })

  it("MUTATION tripwires: process-manager + Dockerfile + skip-ledger", () => {
    const pm = readFileSync(
      path.join(process.cwd(), "container/process-manager.mjs"),
      "utf8",
    )
    expect(pm).toContain("runHeartbeatCatchupOnBoot")
    expect(pm).toContain("CATCHUP_OVERLAY_MARKER")
    expect(pm).toContain("ledger:")
    // -12: ledger RETRY closes silent no-op (boot race vs activity reporter).
    expect(pm).toContain("ledgerCatchupWithRetry")
    expect(pm).toMatch(/attempt <= 4/)

    const dockerfile = readFileSync(
      path.join(process.cwd(), "docker/Dockerfile"),
      "utf8",
    )
    expect(dockerfile).toContain("heartbeat-catchup.mjs")
    expect(dockerfile).toContain("thinking-signature-heal.mjs")
    expect(dockerfile).toContain("catchup-v12")

    const catchupSrc = readFileSync(
      path.join(process.cwd(), "container/heartbeat-catchup.mjs"),
      "utf8",
    )
    expect(catchupSrc).toMatch(/export function shouldCatchUpBeat/)
    expect(catchupSrc).not.toMatch(
      /export function shouldCatchUpBeat\(args\) \{\s*return false/,
    )
    expect(catchupSrc).toContain("catchup-v12")
    expect(catchupSrc).toContain("ledgerCatchupSkip")
    expect(catchupSrc).toContain("heartbeat_catchup_skip")
    expect(catchupSrc).toContain("waitForCronJobsReadable")
    // MUTATION: remove skip-ledger → this assertion fails.
    expect(catchupSrc).toMatch(/await ledgerCatchupSkip\(/)
  })

  it("shouldCatchUpBeat: age within grace only", () => {
    const expectedAt = new Date("2026-07-24T08:00:00.000Z")
    expect(
      catchup.shouldCatchUpBeat({
        enabled: true,
        expectedAt,
        nowMs: expectedAt.getTime() + 10 * 60 * 1000,
        graceMs: 30 * 60 * 1000,
      }),
    ).toBe(true)
    expect(
      catchup.shouldCatchUpBeat({
        enabled: true,
        expectedAt,
        nowMs: expectedAt.getTime() + 45 * 60 * 1000,
        graceMs: 30 * 60 * 1000,
      }),
    ).toBe(false)
    expect(
      catchup.shouldCatchUpBeat({
        enabled: false,
        expectedAt,
        nowMs: expectedAt.getTime() + 10 * 60 * 1000,
        graceMs: 30 * 60 * 1000,
      }),
    ).toBe(false)
  })
})
