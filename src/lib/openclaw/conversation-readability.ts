/** Statuses that can serve live gateway transcripts. */
export const LIVE_GATEWAY_STATUSES = new Set(["RUNNING", "PAUSED"])

/**
 * Statuses that serve Conversations from the persisted runtime snapshot
 * when a snapshot exists (includes transitional / error states).
 */
export const SNAPSHOT_CONVERSATION_STATUSES = new Set([
  "HIBERNATED",
  "STOPPED",
  "WAKING",
  "DEPLOYING",
  "ERROR",
  "PROVISIONING_QUEUED",
])

/** Union: UI may fetch the conversations API for these statuses. */
export const READABLE_STATUSES = new Set([
  ...LIVE_GATEWAY_STATUSES,
  ...SNAPSHOT_CONVERSATION_STATUSES,
])

export function isLiveGatewayStatus(status: string): boolean {
  return LIVE_GATEWAY_STATUSES.has(status)
}

export function isConversationReadableStatus(status: string): boolean {
  return READABLE_STATUSES.has(status)
}

/** API `mode` value for read-from-persisted-state responses (not user-facing copy). */
export const CONVERSATIONS_MODE_SNAPSHOT = "snapshot" as const
export const CONVERSATIONS_MODE_LIVE = "live" as const
