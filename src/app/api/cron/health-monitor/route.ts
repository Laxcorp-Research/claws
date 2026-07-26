import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import type { WorkspaceStatus, HealthStatus } from "@/generated/prisma/client"
import {
  decideHeartbeatMissed,
  decideMissedWake,
  decideWokeLateNeverBeat,
  HEARTBEAT_MISS_GRACE_MS,
  HEARTBEAT_MISS_MAX_AGE_MS,
  heartbeatEvidenceOrClause,
  lastExpectedCronFire,
  OPENCLAW_HEARTBEAT_POLL_MARKER,
  WOKE_LATE_CATCHUP_GRACE_MS,
} from "@/lib/hibernation/next-heartbeat"
import { adoptStrandedDeployments } from "@/lib/deploy/stranded-adopter"

// PR-3 — Health Monitor cron.
//
// Replaces the long-standing tautology where the dashboard derived
// agent "healthy" from `workspace.status === RUNNING` even when no cron
// ever validated the container was alive. See:
//   - src/app/api/activity/[workspaceId]/route.ts (the derivation)
//   - the dead/never-called healthCheckAllContainers in deployer.ts that
//     PR-3 removes in the same commit.
//
// What this does, per RUNNING workspace, every 2 minutes:
//   1. If containerId or containerHost is missing → zombie state
//      (status lies about reality). Treated identically to a network
//      failure: increment counter, debounce same as everything else.
//   2. Otherwise POST to
//        https://{containerHost}/api/v1/admin/rpc
//        Authorization: Bearer ${decrypt(workspace.gatewayToken)}
//        body: { "method": "health" }
//      with a 5s timeout. The admin-http-rpc plugin is enabled by the
//      generator (see src/lib/openclaw/generator.ts) — bundled with
//      OpenClaw, off by default upstream, enabled by us.
//   3. Apply the audit-locked mapping table:
//
//      | Gateway condition                              | status   | healthStatus    | lastHealthCheck |
//      |------------------------------------------------|----------|-----------------|-----------------|
//      | 200 ok:true, agents≥1, plugins.errors=∅       | unchanged| HEALTHY         | now             |
//      | 200 ok:true, agents≥1, plugins.errors≠∅       | unchanged| DEGRADED        | now             |
//      | 200 ok:true, agents=0                          | unchanged| DEGRADED        | now             |
//      | 200 ok:false (UNAVAILABLE)                     | unchanged| unchanged (++)  | unchanged       |
//      | 401 (bad token)                                | unchanged| DEGRADED (++)   | unchanged       |
//      | 404 (plugin disabled — image/config skew)      | unchanged| DEGRADED (++)   | unchanged       |
//      | 5xx / timeout / network / no containerId       | unchanged| unchanged (++)  | unchanged       |
//      | ≥2 consecutive failures (post-increment)       | unchanged| UNHEALTHY       | unchanged       |
//      | ≥5 consecutive failures (post-increment)       | ERROR    | UNHEALTHY       | unchanged       |
//
//      lastHealthCheck is ONLY updated on a successful response. This
//      preserves the operator-useful "last time we KNEW it was alive"
//      semantic.
//
// The decision flow is explicit (no early returns) so the structured
// log at the bottom always records the full before→after transition.

// before: 55 — after: 300 (belt with hibernation / reconcile cron routes)
export const maxDuration = 300

// Debounce thresholds. Mutation tests in
//   src/app/api/cron/health-monitor/__tests__/route.test.ts
// guard each numeric constant: flipping UNHEALTHY_THRESHOLD to 1 or
// ERROR_THRESHOLD to 4 must break a regression test.
const UNHEALTHY_THRESHOLD = 2
const ERROR_THRESHOLD = 5
const ADMIN_RPC_TIMEOUT_MS = 5_000
// PR-4b: the /healthz liveness confirmation (only fired on the ambiguous 404
// branch) gets a tighter budget than the admin-rpc probe — it's a trivial
// plugin-independent endpoint, and we don't want the disambiguation to double
// the worst-case per-workspace probe time.
const HEALTHZ_TIMEOUT_MS = 3_000

type ProbeResult =
  | { kind: "healthy" }
  | { kind: "degraded"; reason: "plugin-errors" | "no-agents" | "bad-token" | "plugin-not-loaded" }
  | { kind: "failure"; reason: "no-container" | "envelope-failed" | "http-5xx" | "http-other" | "timeout" | "network" | "no-route" }

type WorkspaceRow = {
  id: string
  status: WorkspaceStatus
  healthStatus: HealthStatus
  consecutiveHealthFailures: number
  containerId: string | null
  containerHost: string | null
  gatewayToken: string | null
  activitySilenceDetectedAt: Date | null
  stateSyncStaleDetectedAt: Date | null
  agents?: Array<{ heartbeatFrequency: string | null }>
  containerState?: { runtimeStateUpdatedAt: Date | null } | null
  deployments?: Array<{ completedAt: Date | null }>
}

type HealthPayload = {
  agents?: unknown[]
  plugins?: { errors?: unknown[] }
}

type AdminRpcEnvelope = {
  ok?: boolean
  payload?: HealthPayload
  error?: { code?: string; message?: string }
}

// PR-4b: a 401 is only trusted as `bad-token` (alive-but-stale-token config
// drift, heal-eligible) when it carries OUR gateway's auth-failure envelope:
// sendUnauthorized() emits { error: { type: "unauthorized" } }. A bare/edge
// 401 (text, HTML, or a different JSON shape) is NOT trustworthy → the caller
// treats it as a no-route failure. Reads the body; any parse failure or shape
// mismatch returns false (fail closed).
async function isGatewayUnauthorized(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { error?: { type?: unknown } }
    return body?.error?.type === "unauthorized"
  } catch {
    return false
  }
}

// PR-4b: disambiguate an ambiguous 404 from POST /api/v1/admin/rpc. Our
// gateway returns 404 text/plain "Not Found" when the admin-http-rpc plugin
// is disabled (config drift — the container is ALIVE). But an edge/CDN/dead
// service can also 404. /healthz is a plugin-independent, auth-free gateway
// liveness route returning 200 {"ok":true,"status":"live"}. FAIL CLOSED: only
// a clean HTTP 200 confirms our gateway is up; any non-200, timeout, network
// error → not confirmed (caller treats the 404 as a no-route failure). We
// intentionally check ONLY the status code, not the body — any 200 from
// /healthz is good enough (a dead service can't 200 this path).
async function confirmGatewayLive(host: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTHZ_TIMEOUT_MS)
  try {
    const res = await fetch(`https://${host}/healthz`, {
      method: "GET",
      signal: controller.signal,
    })
    return res.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Audit-mapped probe. Pure(-ish): observable side effects are only the
// HTTP call(s). Decision about DB writes happens in the caller.
async function probeWorkspace(ws: WorkspaceRow): Promise<{ result: ProbeResult; httpStatus: number | null }> {
  if (!ws.containerId || !ws.containerHost || !ws.gatewayToken) {
    return { result: { kind: "failure", reason: "no-container" }, httpStatus: null }
  }

  let token: string
  try {
    token = decrypt(ws.gatewayToken)
  } catch (err) {
    log.error("health-monitor: gatewayToken decrypt failed — treating as network failure", {
      workspaceId: ws.id,
      error: String(err),
    })
    return { result: { kind: "failure", reason: "network" }, httpStatus: null }
  }

  const url = `https://${ws.containerHost}/api/v1/admin/rpc`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ADMIN_RPC_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method: "health" }),
    })
  } catch (err) {
    const isTimeout = controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
    return {
      result: { kind: "failure", reason: isTimeout ? "timeout" : "network" },
      httpStatus: null,
    }
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    // PR-4b: gate on the gateway's auth-failure envelope. Only a recognizable
    // { error: { type: "unauthorized" } } proves it's OUR gateway rejecting a
    // stale token (config drift, heal-eligible). Anything else → no-route.
    const gatewayAuth = await isGatewayUnauthorized(res)
    return gatewayAuth
      ? { result: { kind: "degraded", reason: "bad-token" }, httpStatus: 401 }
      : { result: { kind: "failure", reason: "no-route" }, httpStatus: 401 }
  }
  if (res.status === 404) {
    // PR-4b: a 404 is ambiguous (our plugin-disabled gateway vs an edge/dead
    // service). Confirm liveness via the plugin-independent /healthz before
    // healing. Fail closed: only a confirmed-live gateway → plugin-not-loaded.
    const live = await confirmGatewayLive(ws.containerHost)
    return live
      ? { result: { kind: "degraded", reason: "plugin-not-loaded" }, httpStatus: 404 }
      : { result: { kind: "failure", reason: "no-route" }, httpStatus: 404 }
  }
  if (res.status >= 500) {
    return { result: { kind: "failure", reason: "http-5xx" }, httpStatus: res.status }
  }
  if (res.status !== 200) {
    return { result: { kind: "failure", reason: "http-other" }, httpStatus: res.status }
  }

  let body: AdminRpcEnvelope
  try {
    body = (await res.json()) as AdminRpcEnvelope
  } catch {
    return { result: { kind: "failure", reason: "http-other" }, httpStatus: res.status }
  }

  if (body.ok !== true) {
    return { result: { kind: "failure", reason: "envelope-failed" }, httpStatus: res.status }
  }

  const payload = body.payload ?? {}
  const agentsCount = Array.isArray(payload.agents) ? payload.agents.length : 0
  const pluginErrors = Array.isArray(payload.plugins?.errors) ? payload.plugins!.errors!.length : 0

  if (pluginErrors > 0) {
    return { result: { kind: "degraded", reason: "plugin-errors" }, httpStatus: 200 }
  }
  if (agentsCount === 0) {
    return { result: { kind: "degraded", reason: "no-agents" }, httpStatus: 200 }
  }
  return { result: { kind: "healthy" }, httpStatus: 200 }
}

// The DB-persisted classification string for a probe result. Written to
// Workspace.lastHealthReason every pass so the dashboard can pick the right
// banner. PR-4a: a fully-healthy probe records `null` (no remaining issue to
// flag); only degraded/failure outcomes carry a reason discriminant.
export type HealthReason =
  | "plugin-errors"
  | "no-agents"
  | "bad-token"
  | "plugin-not-loaded"
  | "no-container"
  | "envelope-failed"
  | "http-5xx"
  | "http-other"
  | "timeout"
  | "network"
  | "no-route"

function probeReason(result: ProbeResult): HealthReason | null {
  return result.kind === "healthy" ? null : result.reason
}

const ACTIVITY_SILENCE_MIN_THRESHOLD_MS = 30 * 60 * 1000
const STATE_SYNC_STALE_THRESHOLD_MS = 15 * 60 * 1000

function heartbeatIntervalMs(frequency: string | null | undefined): number | null {
  switch (frequency) {
    case "test_5min":
      return 5 * 60 * 1000
    case "hourly":
      return 60 * 60 * 1000
    case "every_6h":
      return 6 * 60 * 60 * 1000
    case "every_12h":
      return 12 * 60 * 60 * 1000
    case "daily":
    case "weekday":
      return 24 * 60 * 60 * 1000
    default:
      return null
  }
}

function workspaceHeartbeatIntervalMs(ws: Pick<WorkspaceRow, "agents">): number | null {
  const frequency = ws.agents?.find((agent) => {
    const f = agent.heartbeatFrequency
    return typeof f === "string" && f.trim() && f !== "off"
  })?.heartbeatFrequency
  return heartbeatIntervalMs(frequency)
}

export function decideActivitySilence(args: {
  status: WorkspaceStatus
  healthStatus: HealthStatus
  heartbeatIntervalMs: number | null
  latestActivityAt: Date | null
  currentFlag: Date | null
  nowMs: number
}): Date | null | undefined {
  const clearIfSet = args.currentFlag ? null : undefined
  if (args.status !== "RUNNING") return clearIfSet
  if (args.healthStatus !== "HEALTHY") return clearIfSet
  if (args.heartbeatIntervalMs === null) return clearIfSet

  const thresholdMs = Math.max(args.heartbeatIntervalMs * 2, ACTIVITY_SILENCE_MIN_THRESHOLD_MS)
  const latestMs = args.latestActivityAt?.getTime() ?? null
  const isSilent = latestMs === null || args.nowMs - latestMs > thresholdMs
  if (!isSilent) return clearIfSet

  return args.currentFlag ?? new Date(args.nowMs)
}

export function decideStateSyncStale(args: {
  status: WorkspaceStatus
  healthStatus: HealthStatus
  runtimeStateUpdatedAt: Date | null
  latestDeploymentCompletedAt: Date | null
  currentFlag: Date | null
  nowMs: number
}): Date | null | undefined {
  const clearIfSet = args.currentFlag ? null : undefined
  if (args.status !== "RUNNING") return clearIfSet
  if (args.healthStatus !== "HEALTHY") return clearIfSet

  const deployedMs = args.latestDeploymentCompletedAt?.getTime() ?? null
  if (deployedMs !== null && args.nowMs - deployedMs < STATE_SYNC_STALE_THRESHOLD_MS) {
    return clearIfSet
  }

  const snapshotMs = args.runtimeStateUpdatedAt?.getTime() ?? null
  const isStale = snapshotMs === null || args.nowMs - snapshotMs > STATE_SYNC_STALE_THRESHOLD_MS
  if (!isStale) return clearIfSet

  return args.currentFlag ?? new Date(args.nowMs)
}

// Pure function: takes the workspace as it is + a probe result, returns
// the DB write payload. Extracted so unit tests can assert the mapping
// table without faking the network. Mutation tests live alongside.
export function decideUpdate(
  ws: Pick<WorkspaceRow, "status" | "healthStatus" | "consecutiveHealthFailures">,
  result: ProbeResult,
  nowMs: number,
): {
  status: WorkspaceStatus
  healthStatus: HealthStatus
  consecutiveHealthFailures: number
  lastHealthCheck: Date | null
  lastHealthReason: HealthReason | null
} {
  const lastHealthReason = probeReason(result)

  if (result.kind === "healthy" || result.kind === "degraded") {
    // PR-4: ANY HTTP response (200 / 401 / 404) proves the container is
    // alive. So every healthy/degraded probe resets the failure counter to 0
    // and refreshes lastHealthCheck=now — including the 4xx config-drift
    // cases (bad-token / plugin-not-loaded), which PR-3 wrongly counted
    // toward status=ERROR. A misconfigured-but-running container must never
    // read as "not responding".
    const nextHealth: HealthStatus = result.kind === "healthy" ? "HEALTHY" : "DEGRADED"

    // PR-4a SYMMETRIC SELF-HEAL: a workspace stuck at status=ERROR self-heals
    // back to RUNNING on ANY successful HTTP response — healthy, 4xx config
    // drift (bad-token / plugin-not-loaded), or 200-degraded (plugin-errors /
    // no-agents). All of them prove the container is reachable. PR-4 healed
    // only degraded; that left a perverse asymmetry (a fully-healthy container
    // stuck at ERROR while a degraded one healed). PR-4a removes it: "any
    // successful response heals ERROR" is a simpler invariant than "degraded
    // heals but healthy doesn't". The PR-3 "operator acknowledges" trace is
    // preserved by lastHealthReason + lastHealthCheck recording what happened.
    // A genuinely broken container returns 5xx/timeout/network (a `failure`,
    // handled below) and re-escalates, so this never papers over a real outage.
    const reclassifyErrorToRunning = ws.status === "ERROR"

    return {
      status: reclassifyErrorToRunning ? "RUNNING" : ws.status,
      healthStatus: nextHealth,
      consecutiveHealthFailures: 0,
      lastHealthCheck: new Date(nowMs),
      // On full recovery (healthy) lastHealthReason is null — nothing left to
      // flag. Degraded keeps its reason so the dashboard banner can explain.
      lastHealthReason,
    }
  }

  // failure: NO usable HTTP response (5xx / timeout / network / no-container /
  // envelope-failed / http-other). These count toward escalation and preserve
  // the "last time we KNEW it was alive" anchor by not touching lastHealthCheck.
  const nextCounter = ws.consecutiveHealthFailures + 1
  const escalateUnhealthy = nextCounter >= UNHEALTHY_THRESHOLD
  const escalateError = nextCounter >= ERROR_THRESHOLD
  return {
    status: escalateError ? "ERROR" : ws.status,
    healthStatus: escalateUnhealthy ? "UNHEALTHY" : ws.healthStatus,
    consecutiveHealthFailures: nextCounter,
    lastHealthCheck: null,
    lastHealthReason,
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const startedAt = Date.now()

  // PR-4a: probe RUNNING **and** ERROR workspaces. ERROR is included so a
  // workspace stuck at ERROR can SELF-HEAL the moment its container is
  // reachable again (the PR-4 reclassify in decideUpdate is unreachable
  // otherwise — an ERROR workspace would never be re-probed). PAUSED /
  // HIBERNATED / STOPPED / DRAFT / SETUP_INCOMPLETE / DEPLOYING / WAKING stay
  // excluded — those are deliberately off or transient.
  //
  // Cost note: genuinely-dead ERROR workspaces are now re-probed every 2 min
  // indefinitely (until redeployed or deleted). The cost is ~5s timeout + 1 DB
  // write per workspace per pass — bounded and acceptable. Stop-probing-after-
  // N-ERROR-passes is a possible optimization but not worth the complexity for
  // current scale.
  const candidates = await prisma.workspace.findMany({
    where: { status: { in: ["RUNNING", "ERROR"] } },
    select: {
      id: true,
      status: true,
      healthStatus: true,
      consecutiveHealthFailures: true,
      containerId: true,
      containerHost: true,
      gatewayToken: true,
      activitySilenceDetectedAt: true,
      stateSyncStaleDetectedAt: true,
      heartbeatMissedAt: true,
      containerState: {
        select: {
          runtimeStateUpdatedAt: true,
          containerPhase: true,
          heartbeatCronExpressions: true,
        },
      },
      deployments: {
        where: { completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
        take: 1,
      },
      agents: {
        where: { role: "ORCHESTRATOR" },
        select: { heartbeatFrequency: true },
        take: 1,
      },
    },
  })

  let healthy = 0
  let degraded = 0
  let failed = 0
  let escalatedUnhealthy = 0
  let escalatedError = 0
  let reclassified = 0
  const errors: string[] = []

  for (const ws of candidates) {
    const before = {
      status: ws.status,
      healthStatus: ws.healthStatus,
      consecutiveHealthFailures: ws.consecutiveHealthFailures,
    }

    let probe: { result: ProbeResult; httpStatus: number | null }
    try {
      probe = await probeWorkspace(ws)
    } catch (err) {
      probe = { result: { kind: "failure", reason: "network" }, httpStatus: null }
      errors.push(`${ws.id}: probe threw ${String(err)}`)
    }

    const update = decideUpdate(before, probe.result, startedAt)
    const heartbeatMs = workspaceHeartbeatIntervalMs(ws)
    const latestActivity = heartbeatMs === null
      ? null
      : await prisma.activityLog.findFirst({
          where: { workspaceId: ws.id },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        })
    const activitySilenceDetectedAt = decideActivitySilence({
      status: update.status,
      healthStatus: update.healthStatus,
      heartbeatIntervalMs: heartbeatMs,
      latestActivityAt: latestActivity?.timestamp ?? null,
      currentFlag: ws.activitySilenceDetectedAt,
      nowMs: startedAt,
    })
    const stateSyncStaleDetectedAt = decideStateSyncStale({
      status: update.status,
      healthStatus: update.healthStatus,
      runtimeStateUpdatedAt: ws.containerState?.runtimeStateUpdatedAt ?? null,
      latestDeploymentCompletedAt: ws.deployments?.[0]?.completedAt ?? null,
      currentFlag: ws.stateSyncStaleDetectedAt,
      nowMs: startedAt,
    })

    // Lifecycle P2 Watchtower: missed cron heartbeat window (ops-gap).
    // Distinct from activity-silence — both flags may coexist.
    let heartbeatMissedAt: Date | null | undefined = undefined
    const phase = ws.containerState?.containerPhase
    const cronExprs = ws.containerState?.heartbeatCronExpressions
    if (phase === "RUNNING" || phase === "WARM") {
      const expected = lastExpectedCronFire(cronExprs, new Date(startedAt))
      let hasEvidence = false
      if (expected) {
        const windowEnd = new Date(expected.getTime() + HEARTBEAT_MISS_GRACE_MS)
        const evidence = await prisma.activityLog.findFirst({
          where: {
            workspaceId: ws.id,
            timestamp: { gte: expected, lte: windowEnd },
            OR: heartbeatEvidenceOrClause(),
          },
          select: { id: true },
        })
        hasEvidence = evidence !== null
      }
      heartbeatMissedAt = decideHeartbeatMissed({
        containerPhase: phase,
        heartbeatCronExpressions: cronExprs,
        hasHeartbeatEvidenceInWindow: hasEvidence,
        currentFlag: ws.heartbeatMissedAt,
        nowMs: startedAt,
      })
      // First transition into miss → ActivityLog ERROR (Watchtower signal).
      if (
        heartbeatMissedAt instanceof Date &&
        ws.heartbeatMissedAt === null &&
        expected
      ) {
        try {
          await prisma.activityLog.create({
            data: {
              workspaceId: ws.id,
              action: "Heartbeat missed",
              detail: `No HEARTBEAT/poll-marker evidence in [${expected.toISOString()}, ${new Date(expected.getTime() + HEARTBEAT_MISS_GRACE_MS).toISOString()}]`,
              actionType: "ERROR",
              timestamp: new Date(startedAt),
              metadata: JSON.stringify({
                eventKind: "heartbeat_missed",
                expectedAt: expected.toISOString(),
                graceMs: HEARTBEAT_MISS_GRACE_MS,
                pollMarker: OPENCLAW_HEARTBEAT_POLL_MARKER,
              }),
            },
          })
        } catch (err) {
          errors.push(`${ws.id}: heartbeat-miss ActivityLog failed ${String(err)}`)
        }
      }
    }

    if (probe.result.kind === "healthy") healthy++
    else if (probe.result.kind === "degraded") degraded++
    else failed++

    if (update.healthStatus === "UNHEALTHY" && before.healthStatus !== "UNHEALTHY") escalatedUnhealthy++
    if (update.status === "ERROR" && before.status !== "ERROR") escalatedError++
    // PR-4: count the config-drift self-heal (ERROR → RUNNING on a 4xx probe).
    const wasReclassified = before.status === "ERROR" && update.status === "RUNNING"
    if (wasReclassified) reclassified++

    try {
      await prisma.workspace.update({
        where: { id: ws.id },
        data: {
          status: update.status,
          healthStatus: update.healthStatus,
          consecutiveHealthFailures: update.consecutiveHealthFailures,
          lastHealthReason: update.lastHealthReason,
          ...(update.lastHealthCheck ? { lastHealthCheck: update.lastHealthCheck } : {}),
          ...(activitySilenceDetectedAt !== undefined ? { activitySilenceDetectedAt } : {}),
          ...(stateSyncStaleDetectedAt !== undefined ? { stateSyncStaleDetectedAt } : {}),
          ...(heartbeatMissedAt !== undefined ? { heartbeatMissedAt } : {}),
        },
      })
    } catch (err) {
      errors.push(`${ws.id}: update failed ${String(err)}`)
    }

    log.info("health-monitor: probed workspace", {
      workspaceId: ws.id,
      probeKind: probe.result.kind,
      probeReason: update.lastHealthReason,
      httpStatus: probe.httpStatus,
      statusBefore: before.status,
      statusAfter: update.status,
      healthBefore: before.healthStatus,
      healthAfter: update.healthStatus,
      counterBefore: before.consecutiveHealthFailures,
      counterAfter: update.consecutiveHealthFailures,
      lastHealthCheckTouched: update.lastHealthCheck !== null,
      reclassifiedFromError: wasReclassified,
    })
  }

  // Lifecycle P2.1: missed-wake for HIBERNATED claws (fixture July shape).
  // Distinct from RUNNING/WARM Watchtower — hibernated claws are not probed above.
  let missedWakeFlagged = 0
  const graceCutoff = new Date(startedAt - HEARTBEAT_MISS_GRACE_MS)
  try {
    const hibernatedArmed = await prisma.workspace.findMany({
      where: {
        status: "HIBERNATED",
        containerState: {
          // P2.3: ≤ so grace-edge (exactly now−grace) is eligible for the detector.
          nextHeartbeatAt: { lte: graceCutoff },
        },
      },
      select: {
        id: true,
        status: true,
        heartbeatMissedAt: true,
        containerState: {
          select: { nextHeartbeatAt: true },
        },
      },
    })

    for (const ws of hibernatedArmed) {
      const nextAt = ws.containerState?.nextHeartbeatAt ?? null
      if (!nextAt) continue

      let hasBoot = false
      try {
        const boot = await prisma.activityLog.findFirst({
          where: {
            workspaceId: ws.id,
            timestamp: { gte: nextAt },
            OR: [
              ...heartbeatEvidenceOrClause(),
              {
                actionType: "TASK_START",
                metadata: { contains: "overlay_boot" },
              },
            ],
          },
          select: { id: true },
        })
        hasBoot = boot !== null
      } catch (err) {
        errors.push(`${ws.id}: missed-wake boot lookup failed ${String(err)}`)
        continue
      }

      const heartbeatMissedAt = decideMissedWake({
        workspaceStatus: ws.status,
        nextHeartbeatAt: nextAt,
        hasBootSinceExpected: hasBoot,
        currentFlag: ws.heartbeatMissedAt,
        nowMs: startedAt,
      })

      if (heartbeatMissedAt === undefined) continue

      try {
        await prisma.workspace.update({
          where: { id: ws.id },
          data: { heartbeatMissedAt },
        })
      } catch (err) {
        errors.push(`${ws.id}: missed-wake update failed ${String(err)}`)
        continue
      }

      if (heartbeatMissedAt instanceof Date && ws.heartbeatMissedAt === null) {
        missedWakeFlagged++
        try {
          await prisma.activityLog.create({
            data: {
              workspaceId: ws.id,
              action: "Heartbeat missed",
              detail: `Missed wake: HIBERNATED past nextHeartbeatAt=${nextAt.toISOString()} with no boot since`,
              actionType: "ERROR",
              timestamp: new Date(startedAt),
              metadata: JSON.stringify({
                eventKind: "heartbeat_missed_wake",
                nextHeartbeatAt: nextAt.toISOString(),
                graceMs: HEARTBEAT_MISS_GRACE_MS,
              }),
            },
          })
        } catch (err) {
          errors.push(`${ws.id}: missed-wake ActivityLog failed ${String(err)}`)
        }
      }
    }
  } catch (err) {
    errors.push(`missed-wake pass: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Lifecycle: WOKE-LATE-NEVER-BEAT — post-cron boot without beat by boot+grace′.
  // Distinct from missed-wake (no boot) and Watchtower (RUNNING evidence window).
  let wokeLateNeverBeatFlagged = 0
  try {
    const cronArmed = await prisma.workspace.findMany({
      where: {
        containerState: {
          heartbeatCronExpressions: { not: null },
        },
      },
      select: {
        id: true,
        heartbeatMissedAt: true,
        containerState: {
          select: { heartbeatCronExpressions: true },
        },
      },
    })

    const horizonStart = new Date(startedAt - HEARTBEAT_MISS_MAX_AGE_MS)

    for (const ws of cronArmed) {
      const cronExprs = ws.containerState?.heartbeatCronExpressions
      if (!cronExprs || cronExprs === "[]") continue

      const expected = lastExpectedCronFire(cronExprs, new Date(startedAt))
      if (!expected) continue
      if (expected.getTime() < horizonStart.getTime()) continue

      let bootAt: Date | null = null
      try {
        const boot = await prisma.activityLog.findFirst({
          where: {
            workspaceId: ws.id,
            timestamp: { gte: expected },
            actionType: "TASK_START",
            metadata: { contains: "overlay_boot" },
          },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true },
        })
        bootAt = boot?.timestamp ?? null
      } catch (err) {
        errors.push(`${ws.id}: woke-late boot lookup failed ${String(err)}`)
        continue
      }
      if (!bootAt) continue

      const graceMs = WOKE_LATE_CATCHUP_GRACE_MS
      const deadline = new Date(bootAt.getTime() + graceMs)
      let hasBeatByDeadline = false
      try {
        const beat = await prisma.activityLog.findFirst({
          where: {
            workspaceId: ws.id,
            timestamp: { gte: expected, lte: deadline },
            OR: heartbeatEvidenceOrClause(),
          },
          select: { id: true },
        })
        hasBeatByDeadline = beat !== null
      } catch (err) {
        errors.push(`${ws.id}: woke-late beat lookup failed ${String(err)}`)
        continue
      }

      const heartbeatMissedAt = decideWokeLateNeverBeat({
        expectedAt: expected,
        bootAt,
        hasBeatEvidenceByDeadline: hasBeatByDeadline,
        currentFlag: ws.heartbeatMissedAt,
        nowMs: startedAt,
        graceMs,
      })

      if (heartbeatMissedAt === undefined) continue
      if (ws.heartbeatMissedAt !== null) continue

      try {
        await prisma.workspace.update({
          where: { id: ws.id },
          data: { heartbeatMissedAt },
        })
      } catch (err) {
        errors.push(`${ws.id}: woke-late update failed ${String(err)}`)
        continue
      }

      wokeLateNeverBeatFlagged++
      try {
        await prisma.activityLog.create({
          data: {
            workspaceId: ws.id,
            action: "Heartbeat missed",
            detail: `Woke late never beat: expected=${expected.toISOString()} boot=${bootAt.toISOString()} deadline=${deadline.toISOString()}`,
            actionType: "ERROR",
            timestamp: new Date(startedAt),
            metadata: JSON.stringify({
              eventKind: "heartbeat_woke_late_never_beat",
              expectedAt: expected.toISOString(),
              bootAt: bootAt.toISOString(),
              graceMs,
            }),
          },
        })
      } catch (err) {
        errors.push(`${ws.id}: woke-late ActivityLog failed ${String(err)}`)
      }
    }
  } catch (err) {
    errors.push(
      `woke-late pass: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Lifecycle P4: stranded GENERATING/PROVISIONING adopter (sibling cadence).
  let strandedAdopted = 0
  try {
    const stranded = await adoptStrandedDeployments(startedAt)
    strandedAdopted = stranded.adopted
    errors.push(...stranded.errors)
  } catch (err) {
    errors.push(`stranded-adopter: ${err instanceof Error ? err.message : String(err)}`)
  }

  const durationMs = Date.now() - startedAt
  log.info("health-monitor: pass complete", {
    workspacesProbed: candidates.length,
    healthy,
    degraded,
    failed,
    escalatedUnhealthy,
    escalatedError,
    reclassified,
    missedWakeFlagged,
    wokeLateNeverBeatFlagged,
    strandedAdopted,
    errorCount: errors.length,
    durationMs,
  })

  return Response.json({
    success: true,
    data: {
      workspacesProbed: candidates.length,
      healthy,
      degraded,
      failed,
      escalatedUnhealthy,
      escalatedError,
      reclassified,
      missedWakeFlagged,
      wokeLateNeverBeatFlagged,
      strandedAdopted,
      errorCount: errors.length,
      durationMs,
    },
  })
}

// Exposed for tests only.
export const __internal = {
  probeWorkspace,
  decideUpdate,
  decideActivitySilence,
  decideStateSyncStale,
  decideHeartbeatMissed,
  decideMissedWake,
  decideWokeLateNeverBeat,
  heartbeatIntervalMs,
  UNHEALTHY_THRESHOLD,
  ERROR_THRESHOLD,
  ACTIVITY_SILENCE_MIN_THRESHOLD_MS,
  STATE_SYNC_STALE_THRESHOLD_MS,
  HEARTBEAT_MISS_GRACE_MS,
  WOKE_LATE_CATCHUP_GRACE_MS,
}
