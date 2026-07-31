import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { parseChannelConfigBlob } from "@/lib/openclaw/channel-config"
import { telegramSendMessage } from "@/lib/channels/telegram-bot-api"
import {
  computeDigestStats,
  DAILY_DIGEST_EVENT_KIND,
  formatDailyDigestMessage,
} from "@/lib/digest/daily-health-digest"
import {
  digestCandidateWhere,
  hasConnectedTelegramForDigest,
  parseDigestWorkspaceIdOverride,
} from "@/lib/digest/digest-eligibility"

export const maxDuration = 55

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const overrideIds = parseDigestWorkspaceIdOverride(
    process.env.DAILY_DIGEST_WORKSPACE_IDS,
  )

  const workspaces = await prisma.workspace.findMany({
    where: digestCandidateWhere(overrideIds),
    select: {
      id: true,
      name: true,
      channelConfigEncrypted: true,
      user: { select: { email: true } },
      containerState: {
        select: {
          lastSyncIncompleteAt: true,
          containerPhase: true,
        },
      },
    },
  })

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const ws of workspaces) {
    try {
      if (!ws.channelConfigEncrypted) {
        skipped++
        continue
      }
      let config
      try {
        config = parseChannelConfigBlob(ws.channelConfigEncrypted, decrypt)
      } catch {
        skipped++
        continue
      }
      if (!hasConnectedTelegramForDigest(config, ws.user?.email ?? null)) {
        skipped++
        continue
      }

      // Re-resolve botToken/chatId for send (hasConnectedTelegram already gated).
      const telegram = config.telegram
      const chatId = telegram?.allowFrom?.[0]
      if (!telegram?.botToken || chatId === undefined || chatId === null) {
        skipped++
        continue
      }

      const rows = await prisma.activityLog.findMany({
        where: { workspaceId: ws.id, timestamp: { gte: since, lte: now } },
        select: { actionType: true, action: true, metadata: true },
        orderBy: { timestamp: "asc" },
      })

      const costAgg = await prisma.creditUsageRecord.aggregate({
        where: {
          workspaceId: ws.id,
          createdAt: { gte: since, lte: now },
        },
        _sum: { costCents: true },
      })

      const stats = computeDigestStats({
        rows,
        costCents24h: costAgg._sum.costCents ?? 0,
        strandOpen: ws.containerState?.lastSyncIncompleteAt != null,
      })

      const text = formatDailyDigestMessage({
        workspaceName: ws.name || "Unnamed Claw",
        asOfUtc: now.toISOString(),
        stats,
      })

      const ok = await telegramSendMessage({
        botToken: telegram.botToken,
        chatId,
        text,
      })

      await prisma.activityLog.create({
        data: {
          workspaceId: ws.id,
          action: "Daily digest sent",
          detail: ok ? null : "telegram-send-failed",
          actionType: "SYSTEM",
          timestamp: now,
          metadata: JSON.stringify({
            eventKind: DAILY_DIGEST_EVENT_KIND,
            channel: "telegram",
            delivered: ok,
            stats,
          }),
        },
      })

      if (ok) sent++
      else errors++
    } catch (err) {
      errors++
      log.error("daily-digest: workspace failed", {
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  log.info("daily-digest: pass complete", {
    candidates: workspaces.length,
    sent,
    skipped,
    errors,
    override: overrideIds != null,
  })

  return Response.json({
    success: true,
    data: { candidates: workspaces.length, sent, skipped, errors },
  })
}
