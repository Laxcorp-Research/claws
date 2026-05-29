import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import type { WorkspaceStatus, HealthStatus } from "@/generated/prisma/client"

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

export const maxDuration = 55

// Debounce thresholds. Mutation tests in
//   src/app/api/cron/health-monitor/__tests__/route.test.ts
// guard each numeric constant: flipping UNHEALTHY_THRESHOLD to 1 or
// ERROR_THRESHOLD to 4 must break a regression test.
const UNHEALTHY_THRESHOLD = 2
const ERROR_THRESHOLD = 5
const ADMIN_RPC_TIMEOUT_MS = 5_000

type ProbeResult =
  | { kind: "healthy" }
  | { kind: "degraded"; reason: "plugin-errors" | "no-agents" | "bad-token" | "plugin-not-loaded" }
  | { kind: "failure"; reason: "no-container" | "envelope-failed" | "http-5xx" | "http-other" | "timeout" | "network" }

type WorkspaceRow = {
  id: string
  status: WorkspaceStatus
  healthStatus: HealthStatus
  consecutiveHealthFailures: number
  containerId: string | null
  containerHost: string | null
  gatewayToken: string | null
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

// Audit-mapped probe. Pure(-ish): observable side effects are only the
// HTTP call. Decision about DB writes happens in the caller.
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
    return { result: { kind: "degraded", reason: "bad-token" }, httpStatus: 401 }
  }
  if (res.status === 404) {
    return { result: { kind: "degraded", reason: "plugin-not-loaded" }, httpStatus: 404 }
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

// Pure function: takes the workspace as it is + a probe result, returns
// the DB write payload. Extracted so unit tests can assert the mapping
// table without faking the network. Mutation tests live alongside.
export function decideUpdate(
  ws: Pick<WorkspaceRow, "status" | "healthStatus" | "consecutiveHealthFailures">,
  result: ProbeResult,
  nowMs: number,
): { status: WorkspaceStatus; healthStatus: HealthStatus; consecutiveHealthFailures: number; lastHealthCheck: Date | null } {
  if (result.kind === "healthy" || result.kind === "degraded") {
    const success = result.kind === "healthy"
    const nextHealth: HealthStatus = success ? "HEALTHY" : "DEGRADED"
    // bad-token / plugin-not-loaded count as failures for debounce purposes
    // (the operator must intervene) but we already classified them as
    // DEGRADED above so the dashboard surfaces them distinctly from a
    // hard network failure. Touching the failure counter on these would
    // promote them to status=ERROR after 10 min which is the right
    // pressure — they are not normal blips.
    const counterDelta =
      result.kind === "degraded" && (result.reason === "bad-token" || result.reason === "plugin-not-loaded")
        ? ws.consecutiveHealthFailures + 1
        : 0

    let nextStatus: WorkspaceStatus = ws.status
    let nextHealthAfterEscalation: HealthStatus = nextHealth
    if (counterDelta >= UNHEALTHY_THRESHOLD) {
      nextHealthAfterEscalation = "UNHEALTHY"
    }
    if (counterDelta >= ERROR_THRESHOLD) {
      nextStatus = "ERROR"
    }

    return {
      status: nextStatus,
      healthStatus: nextHealthAfterEscalation,
      consecutiveHealthFailures: counterDelta,
      // Only update lastHealthCheck on a clean HEALTHY/DEGRADED with
      // counter=0 (the gateway returned a real answer about its own
      // state). On bad-token / plugin-not-loaded we got a 4xx envelope
      // but we did NOT get a state-of-the-gateway answer, so preserve
      // the operator's "last time we KNEW it was alive" anchor.
      lastHealthCheck: counterDelta === 0 ? new Date(nowMs) : null,
    }
  }

  const nextCounter = ws.consecutiveHealthFailures + 1
  const escalateUnhealthy = nextCounter >= UNHEALTHY_THRESHOLD
  const escalateError = nextCounter >= ERROR_THRESHOLD
  return {
    status: escalateError ? "ERROR" : ws.status,
    healthStatus: escalateUnhealthy ? "UNHEALTHY" : ws.healthStatus,
    consecutiveHealthFailures: nextCounter,
    lastHealthCheck: null,
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const startedAt = Date.now()

  const candidates = await prisma.workspace.findMany({
    where: { status: "RUNNING" },
    select: {
      id: true,
      status: true,
      healthStatus: true,
      consecutiveHealthFailures: true,
      containerId: true,
      containerHost: true,
      gatewayToken: true,
    },
  })

  let healthy = 0
  let degraded = 0
  let failed = 0
  let escalatedUnhealthy = 0
  let escalatedError = 0
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

    if (probe.result.kind === "healthy") healthy++
    else if (probe.result.kind === "degraded") degraded++
    else failed++

    if (update.healthStatus === "UNHEALTHY" && before.healthStatus !== "UNHEALTHY") escalatedUnhealthy++
    if (update.status === "ERROR" && before.status !== "ERROR") escalatedError++

    try {
      await prisma.workspace.update({
        where: { id: ws.id },
        data: {
          status: update.status,
          healthStatus: update.healthStatus,
          consecutiveHealthFailures: update.consecutiveHealthFailures,
          ...(update.lastHealthCheck ? { lastHealthCheck: update.lastHealthCheck } : {}),
        },
      })
    } catch (err) {
      errors.push(`${ws.id}: update failed ${String(err)}`)
    }

    log.info("health-monitor: probed workspace", {
      workspaceId: ws.id,
      probeKind: probe.result.kind,
      probeReason: probe.result.kind === "healthy" ? null : probe.result.reason,
      httpStatus: probe.httpStatus,
      statusBefore: before.status,
      statusAfter: update.status,
      healthBefore: before.healthStatus,
      healthAfter: update.healthStatus,
      counterBefore: before.consecutiveHealthFailures,
      counterAfter: update.consecutiveHealthFailures,
      lastHealthCheckTouched: update.lastHealthCheck !== null,
    })
  }

  const durationMs = Date.now() - startedAt
  log.info("health-monitor: pass complete", {
    workspacesProbed: candidates.length,
    healthy,
    degraded,
    failed,
    escalatedUnhealthy,
    escalatedError,
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
      errorCount: errors.length,
      durationMs,
    },
  })
}

// Exposed for tests only.
export const __internal = {
  probeWorkspace,
  decideUpdate,
  UNHEALTHY_THRESHOLD,
  ERROR_THRESHOLD,
}
