/**
 * Morning digest candidate selection.
 *
 * Default predicate (all must hold):
 *   - connected Telegram channel (botToken + allowFrom[0]) - post-query
 *   - heartbeat armed: ContainerState.nextHeartbeatAt IS NOT NULL
 *   - ever-deployed: Deployment status COMPLETED|SUPERSEDED (hibernate
 *     retires COMPLETED → SUPERSEDED; COMPLETED-only would drop sleepers)
 *   - status ∉ {DRAFT, SETUP_INCOMPLETE, STOPPED}
 *   - HIBERNATED included (sleep is normal life)
 *
 * DAILY_DIGEST_WORKSPACE_IDS = optional debug override (restricts to those
 * ids); the predicate still applies - override is not a bypass.
 */

import type { ChannelConfigMap } from "@/lib/openclaw/channel-config"
import { resolveDeliveryTarget } from "@/lib/alerts/critical-alert-push"

/** Statuses excluded from morning digest fan-out. */
export const DIGEST_EXCLUDED_STATUSES = [
  "DRAFT",
  "SETUP_INCOMPLETE",
  "STOPPED",
] as const

export type DigestExcludedStatus = (typeof DIGEST_EXCLUDED_STATUSES)[number]

/** Parse optional comma-separated debug override. Empty → null (no override). */
export function parseDigestWorkspaceIdOverride(
  raw: string | undefined | null,
): string[] | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const ids = trimmed.split(",").map((s) => s.trim()).filter(Boolean)
  return ids.length > 0 ? ids : null
}

/**
 * Prisma `where` for digest SQL prefilter.
 * Telegram connectivity is confirmed post-query (encrypted blob).
 */
export function digestCandidateWhere(overrideIds: string[] | null): {
  status: { notIn: DigestExcludedStatus[] }
  channelConfigEncrypted: { not: null }
  deployments: { some: { status: { in: ["COMPLETED", "SUPERSEDED"] } } }
  containerState: { nextHeartbeatAt: { not: null } }
  id?: { in: string[] }
} {
  return {
    status: { notIn: [...DIGEST_EXCLUDED_STATUSES] },
    channelConfigEncrypted: { not: null },
    deployments: {
      some: { status: { in: ["COMPLETED", "SUPERSEDED"] } },
    },
    containerState: {
      nextHeartbeatAt: { not: null },
    },
    ...(overrideIds ? { id: { in: overrideIds } } : {}),
  }
}

/** True when resolveDeliveryTarget prefers Telegram (connected bot + chat). */
export function hasConnectedTelegramForDigest(
  config: ChannelConfigMap,
  ownerEmail: string | null,
): boolean {
  return resolveDeliveryTarget(config, ownerEmail).channel === "telegram"
}
