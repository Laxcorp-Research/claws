/**
 * -13 catch-up-beat-on-boot (croner loader + no-throw ledger over -12).
 *
 * Boot order: wait for jobs file readable AND gateway healthy (bounded wait,
 * same poll pattern as process-manager waitForProxyHealth / -9 rebuild-index
 * readiness) BEFORE the catch-up decision. Every exit path ledgers a reason
 * (eventKind=heartbeat_catchup_skip) or fires the beat - silent no-ops die here.
 * process-manager wraps the ledger with retries (boot race vs activity reporter).
 *
 * -12 stdout ground truth (fixture v72): catch-up invoked but threw
 * "cron-parser unavailable" before any finishSkip - OpenClaw base ships
 * `croner`, not `cron-parser`. -13 loads croner via createRequire(/app) and
 * never exits the decision path without a ledger row.
 *
 * After readiness: if the most recent heartbeat cron moment is in the past
 * within CATCHUP_GRACE, fire ONE immediate cron.run (force). OpenClaw's
 * enqueueRun rolls nextRunAt - no double-fire at the next wall-clock slot.
 *
 * Pure helpers are exported for repo-side contract tests (no live gateway).
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

/** Default 30m - covers observed ~19.5m GH late-wake with margin. */
export const DEFAULT_CATCHUP_GRACE_MS = 30 * 60 * 1000

/** Marker logged / stamped so -13 boots are distinguishable in telemetry. */
export const CATCHUP_OVERLAY_MARKER = "catchup-v13"

export const HEARTBEAT_CATCHUP_SKIP_EVENT_KIND = "heartbeat_catchup_skip"

/** Bounded readiness waits (reuse -9 proxy-health poll shape). */
export const DEFAULT_JOBS_READY_TIMEOUT_MS = 30_000
export const DEFAULT_GATEWAY_READY_TIMEOUT_MS = 60_000
export const DEFAULT_READY_POLL_MS = 500

const HEARTBEAT_JOB_ID_PREFIX = "heartbeat-"
const HEARTBEAT_JOB_NAME_PREFIX = "orchestrator-heartbeat-"

export function catchupGraceMsFromEnv(env = process.env) {
  const raw = env.CLAWS_HEARTBEAT_CATCHUP_GRACE_MS
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_CATCHUP_GRACE_MS
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CATCHUP_GRACE_MS
  return Math.floor(n)
}

export function isHeartbeatCronJob(job) {
  if (!job || typeof job !== "object") return false
  if (job.enabled === false) return false
  const id = typeof job.id === "string" ? job.id : ""
  const name = typeof job.name === "string" ? job.name : ""
  return (
    id.startsWith(HEARTBEAT_JOB_ID_PREFIX) ||
    name.startsWith(HEARTBEAT_JOB_NAME_PREFIX)
  )
}

export function extractCronExpr(job) {
  if (!job || typeof job !== "object") return null
  const sched = job.schedule
  if (!sched || typeof sched !== "object") return null
  if (sched.kind !== "cron") return null
  if (typeof sched.expr !== "string" || sched.expr.length === 0) return null
  return { expr: sched.expr, tz: typeof sched.tz === "string" ? sched.tz : "UTC" }
}

/**
 * Adapt OpenClaw's `croner` to the cron-parser CronExpressionParser shape
 * used by lastExpectedHeartbeatFire / nextFireAfter (prev/next → toDate()).
 * prev() is strictly before currentDate (cron-parser semantics).
 */
export function cronerAsCronExpressionParser(Cron) {
  return {
    parse(expr, opts = {}) {
      const currentDate =
        opts.currentDate instanceof Date
          ? opts.currentDate
          : new Date(opts.currentDate ?? Date.now())
      const tz = typeof opts.tz === "string" ? opts.tz : "UTC"
      const cron = new Cron(expr, { timezone: tz })
      return {
        prev() {
          // croner previousRuns can skip a fire inside the same second;
          // probe +1s then keep only runs strictly before currentDate.
          const exclusiveEnd = new Date(currentDate.getTime() - 1)
          const probe = new Date(exclusiveEnd.getTime() + 1000)
          const runs = cron.previousRuns(5, probe)
          const d = runs.find((x) => x.getTime() <= exclusiveEnd.getTime())
          if (!(d instanceof Date)) {
            throw new Error("croner: no previous run")
          }
          return { toDate: () => d }
        },
        next() {
          let d = cron.nextRun(currentDate)
          if (d instanceof Date && d.getTime() <= currentDate.getTime()) {
            d = cron.nextRun(new Date(currentDate.getTime() + 1))
          }
          if (!(d instanceof Date)) {
            throw new Error("croner: no next run")
          }
          return { toDate: () => d }
        },
      }
    },
  }
}

function asCronExpressionParser(mod) {
  if (!mod) return null
  if (mod.CronExpressionParser || mod.default?.CronExpressionParser) {
    return mod.CronExpressionParser || mod.default.CronExpressionParser
  }
  if (typeof mod.parseExpression === "function") {
    return {
      parse: (expr, opts) => ({
        prev: () => mod.parseExpression(expr, opts).prev(),
        next: () => mod.parseExpression(expr, opts).next(),
      }),
    }
  }
  // croner default export shape: { Cron }
  const Cron = mod.Cron || mod.default?.Cron
  if (typeof Cron === "function") {
    return cronerAsCronExpressionParser(Cron)
  }
  return null
}

/**
 * Load a CronExpressionParser-compatible API.
 * Prefer cron-parser (repo tests / future vendor); fall back to OpenClaw's
 * bundled `croner` via createRequire("/app/package.json").
 * Returns null when nothing loads - callers MUST ledger (no throw).
 * MUTATION: throw here again → silent catch in process-manager (class C).
 */
export async function loadCronParser() {
  const fileCandidates = [
    "/app/node_modules/cron-parser/dist/index.js",
    "/app/node_modules/cron-parser/lib/index.js",
  ]
  for (const c of fileCandidates) {
    try {
      if (!fs.existsSync(c)) continue
      const mod = await import(pathToFileURL(c).href)
      const parser = asCronExpressionParser(mod)
      if (parser) return parser
    } catch {
      // try next
    }
  }

  for (const spec of ["cron-parser", "croner"]) {
    try {
      const mod = await import(spec)
      const parser = asCronExpressionParser(mod)
      if (parser) return parser
    } catch {
      // try next
    }
  }

  // Image reality: process-manager lives under /usr/local/bin; bare
  // import("croner") does not walk /app/node_modules. createRequire does.
  try {
    const require = createRequire("/app/package.json")
    for (const spec of ["cron-parser", "croner"]) {
      try {
        const mod = require(spec)
        const parser = asCronExpressionParser(mod)
        if (parser) return parser
      } catch {
        // try next
      }
    }
  } catch {
    // no /app package.json
  }

  return null
}

export function cronJobsFilePath(dataDir) {
  return path.join(dataDir, "cron", "jobs.json")
}

/**
 * True when cron/jobs.json exists and parses to an array (possibly empty).
 * Empty array is "readable" - decision layer maps to no-due-job / no-jobs.
 */
export function isCronJobsFileReadable(dataDir) {
  const p = cronJobsFilePath(dataDir)
  try {
    if (!fs.existsSync(p)) return false
    const raw = fs.readFileSync(p, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Bounded wait for jobs file readable. Pattern mirrors waitForProxyHealth.
 * MUTATION: remove this wait → in-grace boot before restore can silent no-op.
 */
export async function waitForCronJobsReadable(args) {
  const {
    dataDir,
    timeoutMs = DEFAULT_JOBS_READY_TIMEOUT_MS,
    pollMs = DEFAULT_READY_POLL_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = args
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (isCronJobsFileReadable(dataDir)) return true
    await sleep(pollMs)
  }
  return isCronJobsFileReadable(dataDir)
}

export function readCronJobsFile(dataDir) {
  const p = cronJobsFilePath(dataDir)
  if (!fs.existsSync(p)) return []
  try {
    const raw = fs.readFileSync(p, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Most recent expected fire ≤ now across heartbeat cron jobs.
 * Returns { expectedAt, job } for the job that owns that fire (or null).
 */
export async function lastExpectedHeartbeatFire(jobs, now, CronExpressionParser) {
  const Parser = CronExpressionParser || (await loadCronParser())
  if (!Parser) {
    throw new Error("cron-parser unavailable for heartbeat catch-up")
  }
  let best = null
  for (const job of jobs) {
    if (!isHeartbeatCronJob(job)) continue
    const cron = extractCronExpr(job)
    if (!cron) continue
    try {
      const prev = Parser.parse(cron.expr, {
        currentDate: now,
        tz: cron.tz,
      })
        .prev()
        .toDate()
      if (!best || prev > best.expectedAt) {
        best = { expectedAt: prev, job }
      }
    } catch {
      // skip invalid
    }
  }
  return best
}

/** Next fire strictly after `from` for a single job. */
export async function nextFireAfter(job, from, CronExpressionParser) {
  const Parser = CronExpressionParser || (await loadCronParser())
  if (!Parser) return null
  const cron = extractCronExpr(job)
  if (!cron) return null
  try {
    return Parser.parse(cron.expr, {
      currentDate: from,
      tz: cron.tz,
    })
      .next()
      .toDate()
  } catch {
    return null
  }
}

/**
 * Decide whether to catch up.
 * MUTATION: disable (always false) → contract test fails.
 */
export function shouldCatchUpBeat(args) {
  if (args.enabled === false) return false
  if (!args.expectedAt) return false
  const age = args.nowMs - args.expectedAt.getTime()
  if (age <= 0) return false // expected in future / exactly now → scheduler owns it
  if (age > args.graceMs) return false
  return true
}

export function readGatewayToken(env = process.env, dataDir) {
  if (typeof env.OPENCLAW_GATEWAY_TOKEN === "string" && env.OPENCLAW_GATEWAY_TOKEN.length > 0) {
    return env.OPENCLAW_GATEWAY_TOKEN
  }
  if (!dataDir) return null
  try {
    const envPath = path.join(dataDir, ".env")
    if (!fs.existsSync(envPath)) return null
    const text = fs.readFileSync(envPath, "utf8")
    const m = text.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m)
    return m?.[1]?.trim() || null
  } catch {
    return null
  }
}

export async function waitForGatewayHealth(args) {
  const {
    port,
    token,
    timeoutMs = DEFAULT_GATEWAY_READY_TIMEOUT_MS,
    pollMs = DEFAULT_READY_POLL_MS,
    fetchImpl = globalThis.fetch,
  } = args
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/v1/admin/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ method: "health", params: {} }),
      })
      if (res.ok) {
        const json = await res.json().catch(() => null)
        if (json?.ok === true || json?.payload?.ok === true || res.status === 200) {
          return true
        }
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return false
}

export async function fireCatchupCronRun(args) {
  const {
    port,
    token,
    jobId,
    fetchImpl = globalThis.fetch,
  } = args
  const res = await fetchImpl(`http://127.0.0.1:${port}/api/v1/admin/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "cron.run",
      params: { id: jobId, mode: "force" },
    }),
  })
  const json = await res.json().catch(() => null)
  return { httpStatus: res.status, body: json }
}

/**
 * Ledger a skip reason via injected callback (defaults to no-op in pure tests).
 * MUTATION: remove skip ledger calls → reason contract tests fail.
 */
export async function ledgerCatchupSkip(args) {
  const { reason, expectedAt = null, graceMs = null, ledger, extra = {} } = args
  if (typeof ledger !== "function") return { ok: false, reason: "no-ledger" }
  const event = {
    type: "ERROR",
    timestamp: new Date().toISOString(),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: `Heartbeat catch-up skipped: ${reason}`,
    detail: `marker=${CATCHUP_OVERLAY_MARKER} reason=${reason}`,
    metadata: {
      eventKind: HEARTBEAT_CATCHUP_SKIP_EVENT_KIND,
      reason,
      marker: CATCHUP_OVERLAY_MARKER,
      expectedAt,
      graceMs,
      ...extra,
    },
  }
  await ledger(event)
  return { ok: true, event }
}

function skipResult(reason, fields = {}) {
  return {
    ran: false,
    reason,
    marker: CATCHUP_OVERLAY_MARKER,
    ...fields,
  }
}

/**
 * Full catch-up path. Returns a structured result for logs/tests.
 * Does not throw - callers log failures.
 *
 * Exit reasons (spec): disabled | no-jobs | gateway-unhealthy | beyond-grace |
 * no-due-job | rpc-fail | cron-parser-unavailable | catchup-fired
 */
export async function runHeartbeatCatchupOnBoot(args) {
  const {
    dataDir,
    port,
    env = process.env,
    now = new Date(),
    fetchImpl = globalThis.fetch,
    CronExpressionParser,
    loadCronParser: loadCronParserImpl = loadCronParser,
    enabled = env.CLAWS_HEARTBEAT_CATCHUP_DISABLED !== "true",
    ledger = null,
    jobsReadyTimeoutMs = DEFAULT_JOBS_READY_TIMEOUT_MS,
    gatewayReadyTimeoutMs = DEFAULT_GATEWAY_READY_TIMEOUT_MS,
    sleep,
  } = args

  const graceMs = catchupGraceMsFromEnv(env)

  async function finishSkip(reason, fields = {}) {
    await ledgerCatchupSkip({
      reason,
      expectedAt: fields.expectedAt ?? null,
      graceMs,
      ledger,
      extra: fields.extra ?? {},
    })
    return skipResult(reason, { graceMs, ...fields })
  }

  try {
    if (!enabled) {
      return await finishSkip("disabled", { expectedAt: null })
    }

    // Boot order #1: jobs file readable (bounded).
    const jobsReady = await waitForCronJobsReadable({
      dataDir,
      timeoutMs: jobsReadyTimeoutMs,
      sleep,
    })
    if (!jobsReady) {
      return await finishSkip("no-jobs", { expectedAt: null })
    }

    const token = readGatewayToken(env, dataDir)
    if (!token) {
      return await finishSkip("gateway-unhealthy", {
        expectedAt: null,
        extra: { detail: "no-gateway-token" },
      })
    }

    // Boot order #2: gateway healthy (bounded) BEFORE catch-up decision.
    const healthy = await waitForGatewayHealth({
      port,
      token,
      timeoutMs: gatewayReadyTimeoutMs,
      fetchImpl,
    })
    if (!healthy) {
      return await finishSkip("gateway-unhealthy", { expectedAt: null })
    }

    const jobs = readCronJobsFile(dataDir)
    if (jobs.length === 0) {
      return await finishSkip("no-jobs", { expectedAt: null })
    }

    // Resolve parser before decision - never throw past finishSkip (-12 class C).
    const Parser = CronExpressionParser || (await loadCronParserImpl())
    if (!Parser) {
      return await finishSkip("cron-parser-unavailable", {
        expectedAt: null,
        extra: { detail: "no cron-parser or croner in image resolve path" },
      })
    }

    const last = await lastExpectedHeartbeatFire(jobs, now, Parser)
    const expectedAt = last?.expectedAt ?? null
    const job = last?.job ?? null

    if (!expectedAt) {
      return await finishSkip("no-due-job", { expectedAt: null })
    }

    if (expectedAt.getTime() >= now.getTime()) {
      return await finishSkip("no-due-job", {
        expectedAt: expectedAt.toISOString(),
      })
    }

    const age = now.getTime() - expectedAt.getTime()
    if (age > graceMs) {
      return await finishSkip("beyond-grace", {
        expectedAt: expectedAt.toISOString(),
      })
    }

    if (
      !shouldCatchUpBeat({
        enabled: true,
        expectedAt,
        nowMs: now.getTime(),
        graceMs,
      })
    ) {
      return await finishSkip("no-due-job", {
        expectedAt: expectedAt.toISOString(),
      })
    }

    const jobId = typeof job?.id === "string" ? job.id : null
    if (!jobId) {
      return await finishSkip("no-due-job", {
        expectedAt: expectedAt.toISOString(),
        extra: { detail: "no-job-id" },
      })
    }

    const rpc = await fireCatchupCronRun({
      port,
      token,
      jobId,
      fetchImpl,
    })

    const ok =
      rpc.httpStatus >= 200 && rpc.httpStatus < 300 && rpc.body?.ok !== false
    if (!ok) {
      return await finishSkip("rpc-fail", {
        expectedAt: expectedAt.toISOString(),
        jobId,
        extra: { httpStatus: rpc.httpStatus },
        rpc,
      })
    }

    const nextAt = await nextFireAfter(job, now, Parser)

    return {
      ran: true,
      reason: "catchup-fired",
      marker: CATCHUP_OVERLAY_MARKER,
      expectedAt: expectedAt.toISOString(),
      jobId,
      graceMs,
      nextFireAt: nextAt?.toISOString() ?? null,
      rpc,
      // Contract: exactly one force run; next slot is the following occurrence.
      evidenceShape: {
        type: "HEARTBEAT",
        action: "Heartbeat tick",
      },
    }
  } catch (err) {
    // Last-resort ledger - closes the -12 throw→console.error silence.
    const message = err instanceof Error ? err.message : String(err)
    const reason = /cron-parser unavailable|croner:/i.test(message)
      ? "cron-parser-unavailable"
      : "rpc-fail"
    return finishSkip(reason, {
      expectedAt: null,
      extra: { detail: message.slice(0, 300) },
    })
  }
}
