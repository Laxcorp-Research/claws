import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getComposio } from "@/lib/composio"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { IMPLEMENTED_SLUGS, hasValidator, validateToolKey, type ValidationResult } from "@/lib/tools/validators"

export const maxDuration = 55

const CONNECTION_HEALTH_BATCH_LIMIT = 50
const MCP_SESSION_HEALTH_BATCH_LIMIT = 25
const NATIVE_API_KEY_BATCH_LIMIT = 10
const NATIVE_API_KEY_RECHECK_INTERVAL_MS = 20 * 60 * 60 * 1000

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

type McpSessionHealthDecision =
  | { kind: "healthy"; status: "HEALTHY" }
  | { kind: "dead"; status: "DEAD"; error: string }
  | { kind: "unreachable"; status: "UNREACHABLE"; error: string }

type NativeApiKeyHealthDecision =
  | { kind: "healthy"; result: "HEALTHY" }
  | { kind: "dead"; result: "EXPIRED"; error: string }
  | { kind: "unreachable"; result: "UNREACHABLE"; reason: string }

interface ToolRouterSessionRetrieveClient {
  client?: {
    toolRouter?: {
      session?: {
        retrieve(sessionId: string): Promise<unknown>
      }
    }
  }
}

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null
  const record = err as Record<string, unknown>
  for (const key of ["status", "statusCode", "code"]) {
    const value = record[key]
    if (typeof value === "number") return value
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value)
  }
  return null
}

function isDeadSessionError(err: unknown): boolean {
  const status = errorStatus(err)
  if (status === 404) return true
  return /404|not\s*found|unknown\s*session|dead\s*session|invalid\s*session/i.test(errorMessage(err))
}

async function retrieveToolRouterSession(composio: unknown, sessionId: string): Promise<McpSessionHealthDecision> {
  try {
    const rawClient = (composio as ToolRouterSessionRetrieveClient).client
    const session = await rawClient?.toolRouter?.session?.retrieve(sessionId)
    if (!session || typeof session !== "object") {
      return { kind: "dead", status: "DEAD", error: "Tool Router session retrieve returned no session" }
    }
    const retrievedId = (session as { session_id?: unknown }).session_id
    if (typeof retrievedId !== "string" || !retrievedId.trim()) {
      return { kind: "dead", status: "DEAD", error: "Tool Router session retrieve returned no session_id" }
    }
    return { kind: "healthy", status: "HEALTHY" }
  } catch (err) {
    if (isDeadSessionError(err)) {
      return { kind: "dead", status: "DEAD", error: errorMessage(err) }
    }
    return { kind: "unreachable", status: "UNREACHABLE", error: errorMessage(err) }
  }
}

function parseEncryptedCredentials(encryptedCredentials: string): Record<string, string> {
  const plaintext = decrypt(encryptedCredentials)
  const parsed = JSON.parse(plaintext)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("encryptedCredentials plaintext is not a JSON object")
  }
  return parsed as Record<string, string>
}

function mapNativeValidationResult(result: ValidationResult): NativeApiKeyHealthDecision {
  if (result.valid && !result.warning) {
    return { kind: "healthy", result: "HEALTHY" }
  }

  if (result.valid && result.warning) {
    return { kind: "unreachable", result: "UNREACHABLE", reason: result.warning }
  }

  return {
    kind: "dead",
    result: "EXPIRED",
    error: result.error ?? "Validator reported invalid credentials",
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const composio = getComposio()
  if (!composio) {
    log.info("connection-health: Composio not configured; skipping Composio-backed sweeps", {
      category: "connection_health",
      event: "composio_not_configured",
    })
  }

  const startedAt = Date.now()
  const summary = {
    checked: 0,
    healthy: 0,
    markedDead: 0,
    unreachable: 0,
    errors: 0,
    mcpSessions: {
      checked: 0,
      healthy: 0,
      dead: 0,
      unreachable: 0,
      errors: 0,
    },
    nativeApiKeys: {
      checked: 0,
      healthy: 0,
      markedDead: 0,
      unreachable: 0,
      skippedNoValidator: 0,
      errors: 0,
    },
  }

  const checkedAt = new Date()

  if (composio) {
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
  }

  const nativeRecheckBefore = new Date(startedAt - NATIVE_API_KEY_RECHECK_INTERVAL_MS)
  const nativeApiKeyConnections = await prisma.toolConnection.findMany({
    where: {
      connectionType: "API_KEY",
      status: "CONNECTED",
      encryptedCredentials: { not: null },
      toolSlug: { in: [...IMPLEMENTED_SLUGS] },
      OR: [
        { lastConnectionCheckAt: null },
        { lastConnectionCheckAt: { lt: nativeRecheckBefore } },
      ],
      // CHANNEL_NATIVE rows are deliberately out of scope: their plugin-token
      // semantics differ from local API keys and need a separate R5 design.
      workspace: { status: { in: ["RUNNING", "PAUSED"] } },
    },
    orderBy: [
      { lastConnectionCheckAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
    ],
    take: NATIVE_API_KEY_BATCH_LIMIT,
    select: {
      id: true,
      workspaceId: true,
      toolSlug: true,
      connectionType: true,
      encryptedCredentials: true,
    },
  })

  for (const connection of nativeApiKeyConnections) {
    if (!hasValidator(connection.toolSlug)) {
      summary.nativeApiKeys.skippedNoValidator++
      continue
    }
    if (!connection.encryptedCredentials) continue
    summary.nativeApiKeys.checked++

    let decision: NativeApiKeyHealthDecision
    try {
      const credentials = parseEncryptedCredentials(connection.encryptedCredentials)
      decision = mapNativeValidationResult(await validateToolKey(connection.toolSlug, credentials))
    } catch (err) {
      decision = { kind: "unreachable", result: "UNREACHABLE", reason: errorMessage(err) }
    }

    try {
      if (decision.kind === "healthy") {
        summary.nativeApiKeys.healthy++
        await prisma.toolConnection.update({
          where: { id: connection.id },
          data: {
            lastConnectionCheckAt: checkedAt,
            lastConnectionCheckResult: decision.result,
            lastError: null,
          },
        })
      } else if (decision.kind === "dead") {
        summary.nativeApiKeys.markedDead++
        await prisma.toolConnection.update({
          where: { id: connection.id },
          data: {
            status: "EXPIRED",
            lastConnectionCheckAt: checkedAt,
            lastConnectionCheckResult: decision.result,
            lastError: decision.error,
          },
        })
        log.warn("connection-health: marked expired native API-key connection", {
          category: "connection_health",
          event: "native_api_key_expired",
          workspaceId: connection.workspaceId,
          toolSlug: connection.toolSlug,
          connectionType: connection.connectionType,
        })
      } else {
        // Third-party outages, validator timeouts, 5xxs, and 429s are
        // outage-safe: write check metadata only. Mutation guard: changing
        // this branch to write `status` must fail the native outage test.
        summary.nativeApiKeys.unreachable++
        await prisma.toolConnection.update({
          where: { id: connection.id },
          data: {
            lastConnectionCheckAt: checkedAt,
            lastConnectionCheckResult: decision.result,
          },
        })
        log.warn("connection-health: native API-key check unreachable", {
          category: "connection_health",
          event: "native_api_key_unreachable",
          workspaceId: connection.workspaceId,
          toolSlug: connection.toolSlug,
          reason: decision.reason,
        })
      }
    } catch (err) {
      summary.nativeApiKeys.errors++
      log.error("connection-health: failed to persist native API-key check", {
        category: "connection_health",
        event: "native_api_key_persist_failed",
        workspaceId: connection.workspaceId,
        toolSlug: connection.toolSlug,
        error: errorMessage(err),
      })
    }
  }

  if (composio) {
    const sessionWorkspaces = await prisma.workspace.findMany({
      where: {
        status: { in: ["RUNNING", "PAUSED"] },
        composioToolRouterSessionId: { not: null },
      },
      orderBy: [
        { mcpSessionCheckedAt: { sort: "asc", nulls: "first" } },
        { updatedAt: "asc" },
      ],
      take: MCP_SESSION_HEALTH_BATCH_LIMIT,
      select: {
        id: true,
        composioToolRouterSessionId: true,
      },
    })

    for (const workspace of sessionWorkspaces) {
      const sessionId = workspace.composioToolRouterSessionId
      if (!sessionId) continue
      summary.mcpSessions.checked++

      // Retrieve-only by design: it is a cheap subsecond server-side session
      // check. An endpoint-dead-with-healthy-retrieve gap is still caught by the
      // deploy boot probe or by runtime/tool-call failures; direct MCP probes stay
      // out of this hourly sweep so RUNNING workspaces cannot exhaust maxDuration.
      const decision = await retrieveToolRouterSession(composio, sessionId)
      try {
        if (decision.kind === "healthy") {
          summary.mcpSessions.healthy++
          await prisma.workspace.update({
            where: { id: workspace.id },
            data: {
              mcpSessionHealthStatus: "HEALTHY",
              mcpSessionCheckedAt: checkedAt,
              mcpSessionLastError: null,
            },
          })
        } else if (decision.kind === "dead") {
          summary.mcpSessions.dead++
          await prisma.workspace.update({
            where: { id: workspace.id },
            data: {
              mcpSessionHealthStatus: "DEAD",
              mcpSessionCheckedAt: checkedAt,
              mcpSessionLastError: decision.error,
            },
          })
          log.warn("connection-health: marked dead Tool Router session", {
            category: "connection_health",
            event: "mcp_session_dead",
            workspaceId: workspace.id,
            sessionIdTail: sessionId.slice(-8),
            error: decision.error,
          })
        } else {
          summary.mcpSessions.unreachable++
          await prisma.workspace.update({
            where: { id: workspace.id },
            data: {
              mcpSessionHealthStatus: "UNREACHABLE",
              mcpSessionCheckedAt: checkedAt,
              mcpSessionLastError: decision.error,
            },
          })
          log.warn("connection-health: Tool Router session check unreachable", {
            category: "connection_health",
            event: "mcp_session_unreachable",
            workspaceId: workspace.id,
            sessionIdTail: sessionId.slice(-8),
            error: decision.error,
          })
        }
      } catch (err) {
        summary.mcpSessions.errors++
        log.error("connection-health: failed to persist Tool Router session check", {
          category: "connection_health",
          event: "mcp_session_persist_failed",
          workspaceId: workspace.id,
          error: errorMessage(err),
        })
      }
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
  MCP_SESSION_HEALTH_BATCH_LIMIT,
  NATIVE_API_KEY_BATCH_LIMIT,
  NATIVE_API_KEY_RECHECK_INTERVAL_MS,
  DEAD_CONNECTION_STATUS,
  mapConnectedAccountStatus,
  mapNativeValidationResult,
  retrieveToolRouterSession,
}
