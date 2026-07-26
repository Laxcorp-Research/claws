/**
 * -10 catch-up-beat contract (repo-side, against overlay code).
 *
 * "boot at expected+10min emits exactly one HEARTBEAT-evidence event,
 * then next fire is the next slot".
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

describe("heartbeat catch-up (-10)", () => {
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

  it("boot at expected+10min → catch-up fires exactly one cron.run force", async () => {
    writeJobs([dailyJob])
    const now = new Date("2026-07-24T08:10:00.000Z")
    const calls: unknown[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
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

    const result = await catchup.runHeartbeatCatchupOnBoot({
      dataDir: dir,
      port: "18789",
      now,
      fetchImpl,
      CronExpressionParser,
    })

    expect(result.ran).toBe(true)
    expect(result.reason).toBe("catchup-fired")
    expect(result.marker).toBe("catchup-v10")
    expect(result.expectedAt).toBe("2026-07-24T08:00:00.000Z")
    expect(result.jobId).toBe(dailyJob.id)
    expect(result.nextFireAt).toBe("2026-07-25T08:00:00.000Z")

    const runs = calls.filter(
      (c) => (c as { method?: string }).method === "cron.run",
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual({
      method: "cron.run",
      params: { id: dailyJob.id, mode: "force" },
    })

    // Emission shape matches sticky-clear contract (typed HEARTBEAT).
    expect(isHeartbeatBeatEvidence(result.evidenceShape)).toBe(true)
  })

  it("beyond CATCHUP_GRACE → no fire (next occurrence owns it)", async () => {
    writeJobs([dailyJob])
    const now = new Date("2026-07-24T08:45:00.000Z") // 45m > 30m default
    const fetchImpl = vi.fn()
    const result = await catchup.runHeartbeatCatchupOnBoot({
      dataDir: dir,
      port: "18789",
      now,
      fetchImpl,
      CronExpressionParser,
      env: {},
    })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe("beyond-grace")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("stale expected (>> grace) → no catch-up", async () => {
    writeJobs([dailyJob])
    // 07:58 → prev is yesterday 08:00 (~24h) → beyond grace
    const now = new Date("2026-07-24T07:58:00.000Z")
    const fetchImpl = vi.fn()
    const result = await catchup.runHeartbeatCatchupOnBoot({
      dataDir: dir,
      port: "18789",
      now,
      fetchImpl,
      CronExpressionParser,
      env: {},
    })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe("beyond-grace")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("MUTATION tripwires: process-manager + Dockerfile must wire -10 catch-up", () => {
    const pm = readFileSync(
      path.join(process.cwd(), "container/process-manager.mjs"),
      "utf8",
    )
    expect(pm).toContain("runHeartbeatCatchupOnBoot")
    expect(pm).toContain("CATCHUP_OVERLAY_MARKER")

    const dockerfile = readFileSync(
      path.join(process.cwd(), "docker/Dockerfile"),
      "utf8",
    )
    expect(dockerfile).toContain("heartbeat-catchup.mjs")
    expect(dockerfile).toContain("-10 catch-up-beat")

    const catchupSrc = readFileSync(
      path.join(process.cwd(), "container/heartbeat-catchup.mjs"),
      "utf8",
    )
    // MUTATION: shouldCatchUpBeat always false → +10min contract fails.
    expect(catchupSrc).toMatch(/export function shouldCatchUpBeat/)
    expect(catchupSrc).not.toMatch(
      /export function shouldCatchUpBeat\(args\) \{\s*return false/,
    )
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
