/**
 * Watchtower: after 06:10 UTC, a morning digest that never landed is an
 * owner-plane miss. Cron at 06:00Z can send 0 forever (Telegram-only) or
 * never fire; health-monitor catches both.
 *
 * Dedup: ActivityLog metadata.condition=digest-missed since utcDigestDayStart.
 */

import { prisma } from "@/lib/db"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import { ledgerHealAttempt } from "@/lib/healing/ledger"
import { DAILY_DIGEST_EVENT_KIND, utcDigestDayStart } from "@/lib/digest/daily-health-digest"
import {
  digestCandidateWhere,
  parseDigestWorkspaceIdOverride,
} from "@/lib/digest/digest-eligibility"

export const DIGEST_MISS_AFTER_UTC_MINUTES = 6 * 60 + 10

export function isAfterDigestMissWatch(now: Date): boolean {
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= DIGEST_MISS_AFTER_UTC_MINUTES
}

export async function watchDigestMissed(
  now: Date = new Date(),
): Promise<{ alerted: boolean; reason?: string }> {
  if (!isAfterDigestMissWatch(now)) {
    return { alerted: false, reason: "before-watch" }
  }

  const overrideIds = parseDigestWorkspaceIdOverride(
    process.env.DAILY_DIGEST_WORKSPACE_IDS,
  )
  const where = digestCandidateWhere(overrideIds)
  const candidateCount = await prisma.workspace.count({ where })
  if (candidateCount === 0) {
    return { alerted: false, reason: "no-candidates" }
  }

  const dayStart = utcDigestDayStart(now)
  const delivered = await prisma.activityLog.findFirst({
    where: {
      timestamp: { gte: dayStart, lte: now },
      AND: [
        { metadata: { contains: `"eventKind":"${DAILY_DIGEST_EVENT_KIND}"` } },
        { metadata: { contains: '"delivered":true' } },
      ],
    },
    select: { id: true },
  })
  if (delivered) {
    return { alerted: false, reason: "delivered" }
  }

  const already = await prisma.activityLog.findFirst({
    where: {
      timestamp: { gte: dayStart, lte: now },
      metadata: { contains: '"condition":"digest-missed"' },
    },
    select: { id: true },
  })
  if (already) {
    return { alerted: false, reason: "already-alerted" }
  }

  const first = await prisma.workspace.findFirst({
    where,
    select: { id: true },
    orderBy: { id: "asc" },
  })
  if (!first) {
    return { alerted: false, reason: "no-candidates" }
  }

  await sendOwnerAlert({
    alertKey: "digest-missed",
    title: "Daily digest missed",
    detail: `No delivered daily_digest_sent since ${dayStart.toISOString()} for ${candidateCount} candidate(s).`,
    workspaceId: first.id,
  })
  await ledgerHealAttempt({
    workspaceId: first.id,
    condition: "digest-missed",
    outcome: "failed",
    detail: `no delivered digest after 06:10 UTC; candidates=${candidateCount}`,
  })
  return { alerted: true }
}
