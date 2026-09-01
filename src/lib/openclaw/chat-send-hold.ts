import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { sendChatMessage } from "@/lib/openclaw/gateway-chat-client"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import {
  CHAT_SEND_HELD_ACTION,
  CHAT_SEND_HELD_EVENT_KIND,
} from "@/lib/openclaw/chat-send-events"

export { CHAT_SEND_HELD_ACTION, CHAT_SEND_HELD_EVENT_KIND }

export const HOLDABLE_CHAT_STATUSES = new Set([
  "HIBERNATED",
  "WAKING",
  "DEPLOYING",
  "PROVISIONING_QUEUED",
])

export function isHoldableChatStatus(status: string): boolean {
  return HOLDABLE_CHAT_STATUSES.has(status)
}

/** Flush sends the held body as-is. Do not wrap it in an envelope header:
 *  the agent treats that as untrusted metadata. Owner identity is the
 *  webchat-ui connect client, not a prefix. */
export function heldFlushOwnerMessage(message: string): string {
  return message
}

export async function ledgerChatSendHeld(args: {
  workspaceId: string
  message: string
  runId: string
  holdReason: string
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      action: CHAT_SEND_HELD_ACTION,
      actionType: "SYSTEM",
      detail: args.message,
      metadata: JSON.stringify({
        eventKind: CHAT_SEND_HELD_EVENT_KIND,
        holdStatus: "held",
        holdReason: args.holdReason,
        runId: args.runId,
      }),
    },
  })
}

function parseHeldMetadata(raw: string | null): {
  eventKind: string | null
  holdStatus: string | null
  runId: string | null
} {
  if (!raw) return { eventKind: null, holdStatus: null, runId: null }
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    return {
      eventKind: typeof m.eventKind === "string" ? m.eventKind : null,
      holdStatus: typeof m.holdStatus === "string" ? m.holdStatus : null,
      runId: typeof m.runId === "string" ? m.runId : null,
    }
  } catch {
    return { eventKind: null, holdStatus: null, runId: null }
  }
}

export async function flushHeldChatSends(workspaceId: string): Promise<{ flushed: number; failed: number }> {
  const summary = { flushed: 0, failed: 0 }
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      metadata: { contains: `"eventKind":"${CHAT_SEND_HELD_EVENT_KIND}"` },
    },
    orderBy: { timestamp: "asc" },
    take: 20,
  })

  const held = rows.filter((row) => {
    const meta = parseHeldMetadata(row.metadata)
    return meta.eventKind === CHAT_SEND_HELD_EVENT_KIND && meta.holdStatus === "held"
  })
  if (held.length === 0) return summary

  const connection = await getGatewayConnectionInfo(workspaceId)
  if (!connection) {
    log.info("held chat flush skipped: no gateway", { workspaceId })
    return summary
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { chatDeviceKeyEncrypted: true, status: true },
  })
  if (!workspace || workspace.status !== "RUNNING") return summary

  let deviceKey = workspace.chatDeviceKeyEncrypted
    ? decryptDeviceIdentity(workspace.chatDeviceKeyEncrypted)
    : generateDeviceIdentity()
  if (!workspace.chatDeviceKeyEncrypted) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
    })
  }

  const orchestrator = await prisma.agent.findFirst({
    where: { workspaceId, role: "ORCHESTRATOR" },
    select: { agentSlug: true },
  })
  if (!orchestrator) return summary
  const sessionKey = `agent:${orchestrator.agentSlug}:main`

  for (const row of held) {
    const meta = parseHeldMetadata(row.metadata)
    const message = row.detail ?? ""
    if (!message || !meta.runId) continue
    try {
      const result = await sendChatMessage({
        wsUrl: connection.wsUrl,
        token: connection.token,
        deviceKey,
        sessionKey,
        message: heldFlushOwnerMessage(message),
        idempotencyKey: meta.runId,
      })
      if (!result.ok) {
        summary.failed += 1
        continue
      }
      await prisma.activityLog.update({
        where: { id: row.id },
        data: {
          metadata: JSON.stringify({
            eventKind: CHAT_SEND_HELD_EVENT_KIND,
            holdStatus: "flushed",
            runId: meta.runId,
          }),
        },
      })
      summary.flushed += 1
    } catch (err) {
      summary.failed += 1
      log.warn("held chat flush failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return summary
}
