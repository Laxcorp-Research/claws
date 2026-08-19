// PR-9/A-vercel: dashboard chat send endpoint.
//
// POST /api/workspaces/[id]/chat {message} → 202 {runId}
//
// Fire-and-forget by design (Option B, docs/OPENCLAW_GATEWAY_PROTOCOL.md §7):
// the gateway ack is acceptance-time (<500ms live), the Orchestrator's reply
// lands in ActivityLog minutes later via the PR-9/A-container reporter
// extension and reaches the dashboard over the existing SSE stream. THIS
// ROUTE WRITES NO ActivityLog ROW — the container's message_received hook
// writes the canonical MESSAGE_RECEIVED (metadata.messageId = the runId we
// return), and a route-side write would double-log every message (V3).
//
// Status gate (V2, amendment 2): Workspace.status is the primary gate —
// matching every existing container-contact route (health-monitor, restart,
// reconcile cron); ContainerPhase is the hibernation scheduler's domain and
// deliberately NOT consulted. A RUNNING workspace missing containerHost or
// gatewayToken cannot be contacted → GATEWAY_UNREACHABLE (the health
// monitor's "no-container" failure kind proves the state exists).

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { chatRateLimit } from "@/lib/rate-limit"
import { log } from "@/lib/logger"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import {
  generateDeviceIdentity,
  encryptDeviceIdentity,
  decryptDeviceIdentity,
  type ChatDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import {
  sendChatMessage,
  type ChatSocketFactory,
  type SendChatResult,
} from "@/lib/openclaw/gateway-chat-client"
import crypto from "node:crypto"

// V1 p95 target is 5s; the function budget leaves headroom for the lazy
// pairing path (connect → approve → reconnect → send) without a runaway
// function. The client enforces its own ~10s internal cap.
export const maxDuration = 30

// Mirror of the reporter's DETAIL_MAX: a longer message would be truncated
// in the activity feed anyway, and the gateway has its own payload caps.
const MESSAGE_MAX_CHARS = 4000

// Test seam: route tests inject a fake client + socket factory. Production
// always uses the real implementations.
export interface ChatRouteDeps {
  send: typeof sendChatMessage
  socketFactory?: ChatSocketFactory
}
const defaultDeps: ChatRouteDeps = { send: sendChatMessage }
let deps: ChatRouteDeps = defaultDeps
export function __setChatRouteDepsForTests(next: ChatRouteDeps | null) {
  deps = next ?? defaultDeps
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  // Per-workspace send limit (after ownership so the key can't be probed
  // cross-tenant). Fail-open on Redis errors like the middleware limiter.
  try {
    const { success } = await chatRateLimit.limit(`${user.id}:${id}`)
    if (!success) {
      return apiError("RATE_LIMITED", "Too many chat messages — slow down a little.", 429)
    }
  } catch {
    // Redis unavailable — proceed (fail-open, consistent with middleware).
  }

  let body: { message?: unknown }
  try {
    body = (await req.json()) as { message?: unknown }
  } catch {
    return ERRORS.VALIDATION("Request body must be JSON")
  }
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message) return ERRORS.VALIDATION("message is required and must be a non-empty string")
  if (message.length > MESSAGE_MAX_CHARS) {
    return ERRORS.VALIDATION(`message exceeds ${MESSAGE_MAX_CHARS} characters`)
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
    },
  })

  // ─── Status gate (V2, amendment 1 error codes) ─────────────────────────
  switch (workspace.status) {
    case "RUNNING":
    case "ERROR": // attempt; the client maps the failure honestly (V2)
      break
    case "HIBERNATED":
      return apiError("WORKSPACE_HIBERNATED", "Your Claw is asleep. Wake it to chat.", 409)
    case "STOPPED":
      return apiError("WORKSPACE_STOPPED", "Your Claw is stopped. Redeploy it to chat.", 409)
    case "DEPLOYING":
    case "WAKING":
    case "PROVISIONING_QUEUED":
      return apiError("WORKSPACE_TRANSITIONING", "Your Claw is starting up — try again shortly.", 409)
    default:
      // DRAFT / SETUP_INCOMPLETE / PAUSED (reserved, no writer)
      return apiError("WORKSPACE_TRANSITIONING", `Cannot chat while the workspace is ${workspace.status}.`, 409)
  }

  // Amendment 2: contactability requires host + token even when RUNNING.
  if (!workspace.containerHost || !workspace.gatewayToken) {
    return apiError("GATEWAY_UNREACHABLE", "Your Claw's container is not reachable right now.", 502)
  }

  const connection = await getGatewayConnectionInfo(id)
  if (!connection) {
    return apiError("GATEWAY_UNREACHABLE", "Your Claw's container is not reachable right now.", 502)
  }

  // ─── Lazy device identity (V4): generate + persist on first send ───────
  let deviceKey: ChatDeviceIdentity
  if (workspace.chatDeviceKeyEncrypted) {
    deviceKey = decryptDeviceIdentity(workspace.chatDeviceKeyEncrypted)
  } else {
    deviceKey = generateDeviceIdentity()
    await prisma.workspace.update({
      where: { id },
      data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
    })
  }

  // Session key: the Orchestrator's main session (routing is via the
  // session key — bindings are not consulted; protocol doc §4).
  const orchestrator = await prisma.agent.findFirst({
    where: { workspaceId: id, role: "ORCHESTRATOR" },
    select: { agentSlug: true },
  })
  if (!orchestrator) {
    return apiError("GATEWAY_UNREACHABLE", "This workspace has no orchestrator agent.", 502)
  }
  const sessionKey = `agent:${orchestrator.agentSlug}:main`

  // Server-generated idempotencyKey — it becomes the gateway runId AND the
  // container-side MESSAGE_RECEIVED metadata.messageId (the correlation
  // chain the dashboard uses to reconcile optimistic messages).
  const idempotencyKey = crypto.randomUUID()

  const attempt = () =>
    deps.send({
      wsUrl: connection.wsUrl,
      token: connection.token,
      deviceKey,
      sessionKey,
      message,
      idempotencyKey,
      socketFactory: deps.socketFactory,
    })

  let result: SendChatResult = await attempt()

  // V6: at most ONE retry, SAME idempotencyKey (the gateway dedupes on it —
  // verified by the spike's T5 double-send), and only when no ack was
  // received. A fresh key could double-deliver the message.
  if (!result.ok && result.reason === "unreachable") {
    result = await attempt()
  }

  if (!result.ok) {
    const status = result.reason === "transitioning" ? 409 : 502
    const code = result.reason === "transitioning" ? "WORKSPACE_TRANSITIONING" : "GATEWAY_UNREACHABLE"
    log.warn("chat send failed", { workspaceId: id, reason: result.reason, detail: result.detail })
    return apiError(
      code,
      result.reason === "transitioning"
        ? "Your Claw's gateway is starting up — try again shortly."
        : "Could not reach your Claw. It may be restarting.",
      status,
    )
  }

  return apiSuccess({ runId: result.runId }, 202)
}
