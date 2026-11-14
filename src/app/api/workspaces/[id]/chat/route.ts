// PR-9/A-vercel: dashboard chat send endpoint.
//
// POST /api/workspaces/[id]/chat {message} → 202 {runId}
//
// Fire-and-forget by design (Option B, docs/OPENCLAW_GATEWAY_PROTOCOL.md §7):
// the gateway ack is acceptance-time (<500ms live), the Orchestrator's reply
// lands in ActivityLog minutes later via the PR-9/A-container reporter
// extension and reaches the dashboard over the existing SSE stream. A live
// RUNNING send writes NO MESSAGE_RECEIVED row (V3) - the container hook owns
// that canonical row. Boot/sleep holds persist a SYSTEM chat_send_held ledger
// so the text does not vanish before flush.
//
// Status gate (V2, amendment 2): Workspace.status is the primary gate -
// matching every existing container-contact route (health-monitor, restart,
// reconcile cron); ContainerPhase is the hibernation scheduler's domain and
// deliberately NOT consulted. A RUNNING workspace missing containerHost or
// gatewayToken cannot be contacted → GATEWAY_UNREACHABLE (the health
// monitor's "no-container" failure kind proves the state exists).

import { after, NextRequest } from "next/server"
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
import { ledgerChatSendRejected } from "@/lib/openclaw/chat-send-reject"
import { flushHeldChatSends, isHoldableChatStatus, ledgerChatSendHeld } from "@/lib/openclaw/chat-send-hold"
import { wakeWorkspace } from "@/lib/hibernation/manager"
import { canWakeHibernatedWorkspace } from "@/lib/trial/wake-entitlement"
import { isSelfHost } from "@/lib/profile"
import { noteSelfHostGatewayRejection } from "@/lib/openclaw/docker-live-status"
import { noteMissingProviderAuth } from "@/lib/openclaw/provider-auth-turn"
import {
  GATEWAY_LISTEN_TIMEOUT_MS,
  isColdStartChatFailure,
  probeGatewayListening,
} from "@/lib/openclaw/gateway-ingress"
import crypto from "node:crypto"

// HTTP returns 202 + runId before the gateway turn. Waiting here for
// chat.send (or the reply) is the founder 19:34Z false-fail: the turn
// ran, the reply landed, the client timed the wait into "failed".
export const maxDuration = 120

// Mirror of the reporter's DETAIL_MAX: a longer message would be truncated
// in the activity feed anyway, and the gateway has its own payload caps.
const MESSAGE_MAX_CHARS = 4000

// Test seam: route tests inject a fake client + socket factory. Production
// always uses the real implementations.
export type ChatRouteAfter = (fn: () => void | Promise<void>) => void

export interface ChatRouteDeps {
  send: typeof sendChatMessage
  socketFactory?: ChatSocketFactory
  after?: ChatRouteAfter
  /** Websocket upgrade probe. Production uses the deploy listen probe. */
  probeGateway?: (wsUrl: string) => Promise<{ ok: boolean; status: number; body: string }>
  probeHealth?: (url: string) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}
const defaultDeps: ChatRouteDeps = { send: sendChatMessage, after }
let deps: ChatRouteDeps = defaultDeps
export function __setChatRouteDepsForTests(next: ChatRouteDeps | null) {
  deps = next ?? defaultDeps
}

function healthUrlFromWs(wsUrl: string): string {
  const url = new URL(wsUrl)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = "/healthz"
  url.search = ""
  url.hash = ""
  return url.toString()
}

/**
 * After nap, RUNNING means the container started. The model turn still fails
 * until /healthz and the websocket upgrade both succeed, and a cold start can
 * fail the first agent run after that. Retry against the deploy listen probe
 * until GATEWAY_LISTEN_TIMEOUT_MS, with one idempotency key.
 */
async function sendWhenGatewayListening(args: {
  workspaceId: string
  deviceKey: ChatDeviceIdentity
  sessionKey: string
  message: string
  idempotencyKey: string
}): Promise<SendChatResult> {
  const clock = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = clock() + GATEWAY_LISTEN_TIMEOUT_MS
  let last: SendChatResult = { ok: false, reason: "unreachable", detail: "gateway not listening" }
  while (clock() < deadline) {
    const live = await getGatewayConnectionInfo(args.workspaceId)
    if (!live) {
      await sleep(1000)
      continue
    }
    const probed = await probeGatewayListening({
      healthUrl: healthUrlFromWs(live.wsUrl),
      wsUrl: live.wsUrl,
      probeHealth: deps.probeHealth,
      probeUpgrade: deps.probeGateway,
    })
    if (probed.verdict === "refuse") {
      return {
        ok: false,
        reason: "unreachable",
        detail: probed.upgrade?.body || "gateway refused the upgrade",
      }
    }
    if (probed.verdict !== "ok") {
      await sleep(1000)
      continue
    }
    last = await deps.send({
      wsUrl: live.wsUrl,
      token: live.token,
      deviceKey: args.deviceKey,
      sessionKey: args.sessionKey,
      message: args.message,
      idempotencyKey: args.idempotencyKey,
      awaitReplyMs: 90_000,
      socketFactory: deps.socketFactory,
    })
    if (last.ok || !isColdStartChatFailure(last.detail ?? "")) return last
    await sleep(1000)
  }
  return last
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
      return apiError("RATE_LIMITED", "Too many chat messages - slow down a little.", 429)
    }
  } catch {
    // Redis unavailable - proceed (fail-open, consistent with middleware).
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

  let workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
    },
  })

  // Self-host nap is docker stop. A chat message starts the same container
  // and waits for the reply. Hosted stays on the 202 hold.
  let wokeFromNap = false
  if (isSelfHost() && workspace.status === "HIBERNATED") {
    wokeFromNap = true
    await wakeWorkspace(id)
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          containerHost: true,
          gatewayToken: true,
          chatDeviceKeyEncrypted: true,
        },
      })
      if (workspace.status === "RUNNING" && workspace.containerHost && workspace.gatewayToken) break
      if (workspace.status === "STOPPED" || workspace.status === "ERROR") {
        return apiError("WORKSPACE_STOPPED", "Wake did not bring the Claw back.", 409)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (workspace.status !== "RUNNING") {
      return apiError("GATEWAY_UNREACHABLE", "Wake did not finish in time.", 502)
    }
  } else if (isHoldableChatStatus(workspace.status)) {
    if (workspace.status === "HIBERNATED") {
      const owner = await prisma.workspace.findUnique({
        where: { id },
        select: {
          user: {
            select: {
              trialUsed: true,
              trialStartedAt: true,
              trialEndsAt: true,
              hasActiveSubscription: true,
              subscriptionStatus: true,
              subscriptionOnHoldAt: true,
            },
          },
        },
      })
      const entitlement = owner?.user
        ? canWakeHibernatedWorkspace(owner.user)
        : { allowed: false as const }
      if (!entitlement.allowed) {
        return apiError(
          "SUBSCRIPTION_REQUIRED",
          "Your 3-day trial has ended. Subscribe to wake this Claw.",
          402,
        )
      }
    }
    const runId = crypto.randomUUID()
    await ledgerChatSendHeld({
      workspaceId: id,
      message,
      runId,
      holdReason: workspace.status,
    })
    if (workspace.status === "HIBERNATED") {
      void wakeWorkspace(id)
        .then(() => flushHeldChatSends(id))
        .catch((err) => {
          log.error("chat hold: wake/flush failed", {
            workspaceId: id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
    return apiSuccess({ runId, held: true, holdReason: workspace.status }, 202)
  }
  switch (workspace.status) {
    case "RUNNING":
    case "ERROR": // attempt; the client maps the failure honestly (V2)
      break
    case "STOPPED":
      return apiError("WORKSPACE_STOPPED", "Your Claw is stopped. Redeploy it to chat.", 409)
    default:
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
  // session key - bindings are not consulted; protocol doc §4).
  const orchestrator = await prisma.agent.findFirst({
    where: { workspaceId: id, role: "ORCHESTRATOR" },
    select: { agentSlug: true },
  })
  if (!orchestrator) {
    return apiError("GATEWAY_UNREACHABLE", "This workspace has no orchestrator agent.", 502)
  }
  const sessionKey = `agent:${orchestrator.agentSlug}:main`
  const idempotencyKey = crypto.randomUUID()

  if (isSelfHost()) {
    const result = wokeFromNap
      ? await sendWhenGatewayListening({
          workspaceId: id,
          deviceKey,
          sessionKey,
          message,
          idempotencyKey,
        })
      : await deps.send({
          wsUrl: connection.wsUrl,
          token: connection.token,
          deviceKey,
          sessionKey,
          message,
          idempotencyKey,
          // Long enough for a real model turn. The fixture gateway still returns as soon as it emits chat final.
          awaitReplyMs: 90_000,
          socketFactory: deps.socketFactory,
        })
    if (!result.ok) {
      try {
        await noteSelfHostGatewayRejection(id, result.detail ?? "Chat send failed.")
        await noteMissingProviderAuth(id, result.detail ?? "")
      } catch (err) {
        log.warn("chat: could not record the gateway rejection", {
          workspaceId: id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return apiError("GATEWAY_UNREACHABLE", result.detail ?? "Chat send failed.", 502)
    }
    return apiSuccess({
      runId: result.runId,
      replyText: result.replyText ?? null,
      usage: result.usage ?? null,
    })
  }

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

  const schedule = deps.after ?? after
  schedule(async () => {
    let result: SendChatResult = await attempt()

    // V6: at most ONE retry, SAME idempotencyKey (the gateway dedupes on it -
    // verified by the spike's T5 double-send), and only when no ack was
    // received. A fresh key could double-deliver the message.
    if (!result.ok && result.reason === "unreachable") {
      result = await attempt()
    }

    if (!result.ok) {
      log.warn("chat send failed", { workspaceId: id, reason: result.reason, detail: result.detail })
      await ledgerChatSendRejected({
        workspaceId: id,
        reason: result.reason,
        detail: result.detail,
      })
    }
  })

  return apiSuccess({ runId: idempotencyKey }, 202)
}
