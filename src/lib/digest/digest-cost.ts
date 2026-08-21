/**
 * Digest cost resolution - credit ledger for PLATFORM_CREDIT; ActivityLog
 * aggregator (dashboard Cost-today path) for BYOK / non-credit claws.
 */

import { prisma } from "@/lib/db"
import { aggregateAgentCostRow } from "@/lib/activity-cost-display"
import {
  getApiKeySource,
  isCreditUser,
} from "@/lib/credits/api-key-source"
import type { ApiKeySource } from "@/generated/prisma/client"

export type DigestCostResolution = {
  costCents24h: number
  costIsEstimate: boolean
  source: "credit_usage" | "activity_window"
}

/**
 * Pure chooser. Credit-mode always uses credit cents (even if 0).
 * BYOK / NONE uses the activity-window dollars→cents path.
 * MUTATION: routing BYOK through credit_usage → BYOK stays $0.00.
 */
export function resolveDigestCostCents(args: {
  apiKeySource: ApiKeySource
  creditCents: number
  activityDollars: number
  activityIsEstimate: boolean
}): DigestCostResolution {
  if (isCreditUser(args.apiKeySource)) {
    return {
      costCents24h: Math.max(0, Math.round(args.creditCents)),
      costIsEstimate: false,
      source: "credit_usage",
    }
  }
  const cents = Math.max(0, Math.round(args.activityDollars * 100))
  return {
    costCents24h: cents,
    costIsEstimate: cents > 0 ? args.activityIsEstimate : false,
    source: "activity_window",
  }
}

/**
 * Same aggregation core as dashboard loadCostWindow (TASK_COMPLETE calls +
 * MESSAGE_SENT apiCost), bounded to [since, now].
 */
export async function loadDigestActivityCostWindow(args: {
  workspaceId: string
  since: Date
  now: Date
}): Promise<{ totalDollars: number; isEstimate: boolean }> {
  const agents = await prisma.agent.findMany({
    where: { workspaceId: args.workspaceId },
    select: { agentSlug: true, model: true },
  })
  const agentSlugs = agents.map((a) => a.agentSlug).filter(Boolean) as string[]
  if (agentSlugs.length === 0) {
    return { totalDollars: 0, isEstimate: false }
  }

  const modelBySlug = new Map(agents.map((a) => [a.agentSlug, a.model]))
  const timestampFilter = { gte: args.since, lte: args.now }

  const [callsByAgent, messageSents] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["agentSlug"],
      where: {
        workspaceId: args.workspaceId,
        agentSlug: { in: agentSlugs },
        actionType: "TASK_COMPLETE",
        timestamp: timestampFilter,
      },
      _count: { _all: true },
    }),
    prisma.activityLog.findMany({
      where: {
        workspaceId: args.workspaceId,
        agentSlug: { in: agentSlugs },
        actionType: "MESSAGE_SENT",
        timestamp: timestampFilter,
      },
      select: { agentSlug: true, apiCost: true },
    }),
  ])

  const callsMap = new Map<string, number>()
  for (const row of callsByAgent) {
    if (!row.agentSlug) continue
    callsMap.set(row.agentSlug, row._count._all)
  }
  const sentsBySlug = new Map<string, Array<{ apiCost: number | null }>>()
  for (const row of messageSents) {
    if (!row.agentSlug) continue
    const list = sentsBySlug.get(row.agentSlug) ?? []
    list.push({ apiCost: row.apiCost })
    sentsBySlug.set(row.agentSlug, list)
  }

  const agentRows = agentSlugs.map((slug) => {
    const resolved = aggregateAgentCostRow({
      model: modelBySlug.get(slug) ?? "",
      taskCompleteCalls: callsMap.get(slug) ?? 0,
      messageSents: sentsBySlug.get(slug) ?? [],
    })
    return { agentSlug: slug, ...resolved }
  })

  const totalDollars =
    Math.round(agentRows.reduce((sum, row) => sum + row.cost, 0) * 100) / 100
  const active = agentRows.filter((row) => row.calls > 0 || row.cost > 0)
  const isEstimate =
    active.length === 0 ? false : active.some((row) => row.isEstimate)
  return { totalDollars, isEstimate }
}

export function digestWorkspaceIsByok(args: {
  apiKeySourceOverride: ApiKeySource | null
  userApiKeySource: ApiKeySource | null | undefined
}): boolean {
  const source = getApiKeySource(
    { apiKeySourceOverride: args.apiKeySourceOverride },
    args.userApiKeySource ? { apiKeySource: args.userApiKeySource } : null,
  )
  return !isCreditUser(source)
}
