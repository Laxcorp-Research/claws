import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getComposio } from "@/lib/composio"
import { log } from "@/lib/logger"

export const maxDuration = 55

const CONNECTION_HEALTH_BATCH_LIMIT = 50

// @composio/core v0.6.8 connected-account statuses in the local type defs:
// INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE. REVOKED is not in those
// types, but the existing OAuth poll path already handles it defensively for
// provider-side revocation reports, so the sweep preserves that branch.
const DEAD_CONNECTION_STATUS = {
  INITIATED: "ERROR",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  FAILED: "ERROR",
  INACTIVE: "ERROR",
} as const

type DeadComposioStatus = keyof typeof DEAD_CONNECTION_STATUS
type DeadDbStatus = (typeof DEAD_CONNECTION_STATUS)[DeadComposioStatus]

type ConnectionHealthDecision =
  | { kind: "healthy"; result: "HEALTHY" }
  | { kind: "dead"; result: DeadComposioStatus; status: DeadDbStatus }
  | { kind: "unreachable"; result: "UNREACHABLE"; reason: string }

export function mapConnectedAccountStatus(rawStatus: unknown): ConnectionHealthDecision {
  const status = typeof rawStatus === "string" ? rawStatus.trim().toUpperCase() : ""

  if (status === "ACTIVE") {
    return { kind: "healthy", result: "HEALTHY" }
  }

  if (status in DEAD_CONNECTION_STATUS) {
    const result = status as DeadComposioStatus
    return { kind: "dead", result, status: DEAD_CONNECTION_STATUS[result] }
  }

  return {
    kind: "unreachable",
    result: "UNREACHABLE",
    reason: status ? `unknown-status:${status}` : "missing-status",
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const composio = getComposio()
  if (!composio) {
    log.info("connection-health: Composio not configured; skipping sweep", {
      category: "connection_health",
      event: "composio_not_configured",
    })
    return Response.json({ success: true, data: { checked: 0, healthy: 0, markedDead: 0, unreachable: 0 } })
  }

  const startedAt = Date.now()
  const summary = {
    checked: 0,
    healthy: 0,
    markedDead: 0,
    unreachable: 0,
    errors: 0,
  }

  const connections = await prisma.toolConnection.findMany({
    where: {
      composioConnectionId: { not: null },
      status: "CONNECTED",
      // RUNNING and PAUSED containers can still be resumed without a deploy,
      // so their tool health must stay fresh. DRAFT/SETUP_INCOMPLETE are
      // validated before first deploy and have no runtime user impact yet.
      workspace: { status: { in: ["RUNNING", "PAUSED"] } },
    },
    orderBy: [
      { lastConnectionCheckAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
    ],
    take: CONNECTION_HEALTH_BATCH_LIMIT,
    select: {
      id: true,
      workspaceId: true,
      toolSlug: true,
      connectionType: true,
      composioConnectionId: true,
    },
  })

  const checkedAt = new Date()

  for (const connection of connections) {
    const connectionId = connection.composioConnectionId
    if (!connectionId) continue
    summary.checked++

    let decision: ConnectionHealthDecision
    try {
      const account = await composio.connectedAccounts.get(connectionId)
      decision = mapConnectedAccountStatus((account as { status?: unknown }).status)
    } catch (err) {
      decision = {
        kind: "unreachable",
        result: "UNREACHABLE",
        reason: err instanceof Error ? err.message : String(err),
      }
    }

    try {
      if (decision.kind === "healthy") {
        summary.healthy++
        await prisma.toolConnection.update({
          where: { id: connection.id },
          data: {
            lastConnectionCheckAt: checkedAt,
            lastConnectionCheckResult: decision.result,
          },
        })
        continue
      }

      if (decision.kind === "dead") {
        summary.markedDead++
        await prisma.toolConnection.update({
          where: { id: connection.id },
          data: {
            status: decision.status,
            lastConnectionCheckAt: checkedAt,
            lastConnectionCheckResult: decision.result,
            lastError: `Composio connected account status: ${decision.result}`,
          },
        })
        log.warn("connection-health: marked dead tool connection", {
          category: "connection_health",
          event: "marked_dead",
          workspaceId: connection.workspaceId,
          toolSlug: connection.toolSlug,
          connectionType: connection.connectionType,
          result: decision.result,
          status: decision.status,
        })
        continue
      }

      // Composio/platform failures, 429s, 5xxs, SDK throws, and unknown
      // status shapes are outage-safe: record health metadata only. Mutation
      // guard: changing this branch to write `status` must fail the outage
      // regression test.
      summary.unreachable++
      await prisma.toolConnection.update({
        where: { id: connection.id },
        data: {
          lastConnectionCheckAt: checkedAt,
          lastConnectionCheckResult: decision.result,
        },
      })
      log.warn("connection-health: connection check unreachable", {
        category: "connection_health",
        event: "unreachable",
        workspaceId: connection.workspaceId,
        toolSlug: connection.toolSlug,
        reason: decision.reason,
      })
    } catch (err) {
      summary.errors++
      log.error("connection-health: failed to persist check result", {
        category: "connection_health",
        event: "persist_failed",
        workspaceId: connection.workspaceId,
        toolSlug: connection.toolSlug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const durationMs = Date.now() - startedAt
  log.info("connection-health: sweep complete", {
    category: "connection_health",
    event: "run_complete",
    durationMs,
    ...summary,
  })

  return Response.json({ success: true, data: { ...summary, durationMs } })
}

export const __internal = {
  CONNECTION_HEALTH_BATCH_LIMIT,
  DEAD_CONNECTION_STATUS,
  mapConnectedAccountStatus,
}
