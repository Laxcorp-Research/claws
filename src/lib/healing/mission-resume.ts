import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { HEAL_ATTEMPT_EVENT_KIND, ledgerHealAttempt } from "@/lib/healing/ledger"
import {
  isInsideMissionWindow,
  loadInFlightWork,
} from "@/lib/hibernation/mission-idle"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { sendChatMessage } from "@/lib/openclaw/gateway-chat-client"

export const MISSION_RESUME_PROMPT =
  "Resume the interrupted mission window. Re-run the HEARTBEAT section that matches now. Write drafts and decisions to shared/deliverables/. Do not paste files into chat."

export const MISSION_RESUME_FAIL_NOTE =
  "I could not auto-resume the interrupted mission after two tries. Open chat and ask me to finish the last window."

/**
 * Ledger mission_interrupted when a running claw dies mid-window.
 * Silent to the user until resume fails twice.
 */
export async function maybeLedgerMissionInterrupted(args: {
  workspaceId: string
  heartbeatCronExpressions: string | null | undefined
  now?: Date
}): Promise<boolean> {
  const now = args.now ?? new Date()
  const inside = isInsideMissionWindow({
    heartbeatCronExpressions: args.heartbeatCronExpressions,
    now,
  })
  const { hasInFlightRuns } = await loadInFlightWork(args.workspaceId, now)
  if (!inside && !hasInFlightRuns) return false

  await ledgerHealAttempt({
    workspaceId: args.workspaceId,
    condition: "mission_interrupted",
    outcome: "failed",
    detail: inside
      ? "container died inside mission window"
      : "container died with in-flight runs",
  })
  return true
}

export async function countMissionResumeFailures(workspaceId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: since },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: '"condition":"mission_interrupted"' } },
        { metadata: { contains: '"outcome":"failed"' } },
      ],
      detail: { startsWith: "resume:" },
    },
    select: { id: true },
  })
  return Array.isArray(rows) ? rows.length : 0
}

export async function hasPendingMissionInterrupt(workspaceId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const pending = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: since },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: '"condition":"mission_interrupted"' } },
        { metadata: { contains: '"outcome":"failed"' } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { id: true, timestamp: true },
  })
  if (!pending) return false
  const cleared = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gt: pending.timestamp },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: '"condition":"mission_interrupted"' } },
        {
          OR: [
            { metadata: { contains: '"outcome":"healed"' } },
            { metadata: { contains: '"outcome":"cleared"' } },
          ],
        },
      ],
    },
    select: { id: true },
  })
  return !cleared
}

/**
 * On wake: silently re-run the interrupted window. Tell the user only
 * after two failed resume attempts.
 */
export async function maybeResumeInterruptedMission(workspaceId: string): Promise<void> {
  if (!(await hasPendingMissionInterrupt(workspaceId))) return

  try {
    const connection = await getGatewayConnectionInfo(workspaceId)
    if (!connection) throw new Error("no gateway connection")

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { chatDeviceKeyEncrypted: true },
    })
    const deviceKey = ws?.chatDeviceKeyEncrypted
      ? decryptDeviceIdentity(ws.chatDeviceKeyEncrypted)
      : generateDeviceIdentity()
    if (ws && !ws.chatDeviceKeyEncrypted) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
      })
    }

    const result = await sendChatMessage({
      wsUrl: connection.wsUrl,
      token: connection.token,
      deviceKey,
      sessionKey: "main",
      message: MISSION_RESUME_PROMPT,
      idempotencyKey: `mission-resume:${workspaceId}:${Date.now()}`,
    })
    if (!result.ok) throw new Error(result.detail ?? result.reason)

    await ledgerHealAttempt({
      workspaceId,
      condition: "mission_interrupted",
      outcome: "healed",
      detail: "auto-resume injected",
    })
  } catch (err) {
    const fails = (await countMissionResumeFailures(workspaceId)) + 1
    await ledgerHealAttempt({
      workspaceId,
      condition: "mission_interrupted",
      outcome: "failed",
      detail: `resume:${err instanceof Error ? err.message : String(err)}`,
    })
    log.warn("mission-resume failed", { workspaceId, fails, error: String(err) })
    if (fails >= 2) {
      await prisma.activityLog.create({
        data: {
          workspaceId,
          action: MISSION_RESUME_FAIL_NOTE,
          detail: MISSION_RESUME_FAIL_NOTE,
          actionType: "MESSAGE_SENT",
          timestamp: new Date(),
          metadata: JSON.stringify({
            eventKind: "mission_resume_user_notice",
            attempts: fails,
          }),
        },
      })
    }
  }
}
