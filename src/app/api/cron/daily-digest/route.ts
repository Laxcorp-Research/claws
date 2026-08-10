import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import {
  parseChannelConfigBlob,
  preferNumericTelegramAllowFrom,
} from "@/lib/openclaw/channel-config"
import { telegramSendMessage } from "@/lib/channels/telegram-bot-api"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import {
  computeDigestStats,
  DAILY_DIGEST_EVENT_KIND,
  formatDailyDigestMessage,
  utcDigestDayStart,
} from "@/lib/digest/daily-health-digest"
import {
  loadDigestActivityCostWindow,
  resolveDigestCostCents,
} from "@/lib/digest/digest-cost"
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
  const dayStart = utcDigestDayStart(now)
  const overrideIds = parseDigestWorkspaceIdOverride(
    process.env.DAILY_DIGEST_WORKSPACE_IDS,
  )

  const workspaces = await prisma.workspace.findMany({
    where: digestCandidateWhere(overrideIds),
    select: {
      id: true,
      name: true,
      channelConfigEncrypted: true,
      apiKeySourceOverride: true,
      user: { select: { email: true, apiKeySource: true } },
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
      // Prefer numeric chat id when username + id both exist (message-tool safety).
      const telegram = config.telegram
      const chatId = preferNumericTelegramAllowFrom(telegram?.allowFrom)?.[0]
      if (!telegram?.botToken || chatId === undefined || chatId === null) {
        skipped++
        continue
      }

      // IDEMPOTENCY: skip+ledger if a delivered digest already exists today (UTC).
      const already = await prisma.activityLog.findFirst({
        where: {
          workspaceId: ws.id,
          timestamp: { gte: dayStart, lte: now },
          AND: [
            { metadata: { contains: `"eventKind":"${DAILY_DIGEST_EVENT_KIND}"` } },
            { metadata: { contains: '"delivered":true' } },
          ],
        },
        select: { id: true },
      })
      if (already) {
        await prisma.activityLog.create({
          data: {
            workspaceId: ws.id,
            action: "Daily digest skipped",
            detail: "already-sent-today",
            actionType: "SYSTEM",
            timestamp: now,
            metadata: JSON.stringify({
              eventKind: DAILY_DIGEST_EVENT_KIND,
              channel: "telegram",
              delivered: false,
              skipped: true,
              reason: "already-sent-today",
            }),
          },
        })
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

      const apiKeySource = getApiKeySource(
        { apiKeySourceOverride: ws.apiKeySourceOverride },
        ws.user,
      )
      const activityCost = await loadDigestActivityCostWindow({
        workspaceId: ws.id,
        since,
        now,
      })
      const costResolved = resolveDigestCostCents({
        apiKeySource,
        creditCents: costAgg._sum.costCents ?? 0,
        activityDollars: activityCost.totalDollars,
        activityIsEstimate: activityCost.isEstimate,
      })

      const stats = computeDigestStats({
        rows,
        costCents24h: costResolved.costCents24h,
        costIsEstimate: costResolved.costIsEstimate,
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
            costSource: costResolved.source,
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
