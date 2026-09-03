import { after } from "next/server"
import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sidecarPathFor, titleFromDeliverablePath } from "@/lib/artifacts/deliverable-kind"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { sendChatMessage, type SendChatResult } from "@/lib/openclaw/gateway-chat-client"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { flushHeldChatSends, isHoldableChatStatus, ledgerChatSendHeld } from "@/lib/openclaw/chat-send-hold"
import { wakeWorkspace } from "@/lib/hibernation/manager"

export type HumanDecisionKind = "APPROVED" | "REJECTED" | "EDITED"

export type DecisionPushSchedule = (fn: () => void | Promise<void>) => void

export type DecisionPushDeps = {
  send: typeof sendChatMessage
  schedule: DecisionPushSchedule
  wake: (workspaceId: string) => Promise<unknown>
  flushHeld: (workspaceId: string) => Promise<unknown>
}

const defaultDeps: DecisionPushDeps = {
  send: sendChatMessage,
  schedule: (fn) => {
    after(fn)
  },
  wake: wakeWorkspace,
  flushHeld: flushHeldChatSends,
}

let deps: DecisionPushDeps = defaultDeps

export function __setDecisionPushDepsForTests(next: Partial<DecisionPushDeps> | null): void {
  deps = next ? { ...defaultDeps, ...next } : defaultDeps
}

export function formatDecisionClock(at: Date): string {
  const hh = String(at.getUTCHours()).padStart(2, "0")
  const mm = String(at.getUTCMinutes()).padStart(2, "0")
  return `${hh}:${mm}Z`
}

export function formatDecisionPushLine(args: {
  logicalPath: string
  version: number | null
  decision: HumanDecisionKind
  at: Date
}): string {
  const stem = titleFromDeliverablePath(args.logicalPath)
  const ver = args.version != null ? ` v${args.version}` : ""
  return `Human decision: ${stem}${ver} ${args.decision} at ${formatDecisionClock(args.at)}`
}

export function formatDecisionPushMessage(args: {
  logicalPath: string
  version: number | null
  decision: HumanDecisionKind
  at: Date
}): string {
  const line = formatDecisionPushLine(args)
  const sidecar = sidecarPathFor(args.logicalPath)
  return [
    line,
    "",
    `Sidecar ${sidecar} is the source of truth. Relabel HELD/QUEUED on this file to ${args.decision}, write a memory line, reply with one ack line. Do not start a mission. Do not post.`,
  ].join("\n")
}

export type DecisionPushResult = {
  runId: string
  held: boolean
  pushed: boolean
}

/**
 * Deliver a human approve/edit/reject into the claw as an owner webchat
 * turn. Sidecar write is not enough: without this inject the agent never
 * sees the decision. Asleep claws queue via held-flush. Never resumes a
 * mission window.
 */
export async function pushDecisionToClaw(args: {
  workspaceId: string
  logicalPath: string
  version: number | null
  decision: HumanDecisionKind
  at?: Date
}): Promise<DecisionPushResult> {
  const at = args.at ?? new Date()
  const message = formatDecisionPushMessage({
    logicalPath: args.logicalPath,
    version: args.version,
    decision: args.decision,
    at,
  })
  const runId = crypto.randomUUID()

  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
    },
  })
  if (!workspace) {
    log.warn("decision push: workspace missing", { workspaceId: args.workspaceId })
    return { runId, held: false, pushed: false }
  }

  if (isHoldableChatStatus(workspace.status)) {
    await ledgerChatSendHeld({
      workspaceId: args.workspaceId,
      message,
      runId,
      holdReason: workspace.status,
    })
    if (workspace.status === "HIBERNATED") {
      void deps
        .wake(args.workspaceId)
        .then(() => deps.flushHeld(args.workspaceId))
        .catch((err) => {
          log.warn("decision push: wake/flush failed", {
            workspaceId: args.workspaceId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
    return { runId, held: true, pushed: true }
  }

  if (workspace.status !== "RUNNING" && workspace.status !== "ERROR") {
    log.info("decision push: claw not sendable, sidecar stands", {
      workspaceId: args.workspaceId,
      status: workspace.status,
    })
    return { runId, held: false, pushed: false }
  }

  deps.schedule(() =>
    deliverDecisionTurn({
      workspaceId: args.workspaceId,
      message,
      runId,
      chatDeviceKeyEncrypted: workspace.chatDeviceKeyEncrypted,
    }),
  )
  return { runId, held: false, pushed: true }
}

async function deliverDecisionTurn(args: {
  workspaceId: string
  message: string
  runId: string
  chatDeviceKeyEncrypted: string | null
}): Promise<void> {
  const connection = await getGatewayConnectionInfo(args.workspaceId)
  if (!connection) {
    log.warn("decision push: gateway unreachable", { workspaceId: args.workspaceId })
    return
  }

  let deviceKey = args.chatDeviceKeyEncrypted
    ? decryptDeviceIdentity(args.chatDeviceKeyEncrypted)
    : generateDeviceIdentity()
  if (!args.chatDeviceKeyEncrypted) {
    await prisma.workspace.update({
      where: { id: args.workspaceId },
      data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
    })
  }

  const orchestrator = await prisma.agent.findFirst({
    where: { workspaceId: args.workspaceId, role: "ORCHESTRATOR" },
    select: { agentSlug: true },
  })
  if (!orchestrator) {
    log.warn("decision push: no orchestrator", { workspaceId: args.workspaceId })
    return
  }

  const attempt = () =>
    deps.send({
      wsUrl: connection.wsUrl,
      token: connection.token,
      deviceKey,
      sessionKey: `agent:${orchestrator.agentSlug}:main`,
      message: args.message,
      idempotencyKey: args.runId,
    })

  let result: SendChatResult = await attempt()
  if (!result.ok && result.reason === "unreachable") {
    result = await attempt()
  }
  if (!result.ok) {
    log.warn("decision push: send failed", {
      workspaceId: args.workspaceId,
      reason: result.reason,
      detail: result.detail,
    })
  }
}
