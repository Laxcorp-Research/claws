import {
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

const SCHEDULED_SLOT_RE = /\bScheduled\s+(\d{1,2}:\d{2})\s+UTC\b/gi
const QUEUE_THEM_IMMEDIATE_RE = /\bqueue them for immediate posting\b/gi
const QUEUED_IMMEDIATE_RE = /\bqueued for immediate posting\b/gi
const QUEUE_IMMEDIATE_RE = /\bqueue for immediate posting\b/gi
const IMMEDIATE_POSTING_BARE_RE = /\bimmediate posting\b/gi

/** The claw never implies it will post. "Scheduled 12:30 UTC" is a proposed slot. */
export function rewriteScheduledSlotCopy(text: string): string {
  return text.replace(SCHEDULED_SLOT_RE, "proposed slot $1 UTC, pending your approval")
}

/** Founder claw said "queue them for immediate posting". Display never implies a post. */
export function rewriteImmediatePostingCopy(text: string): string {
  return text
    .replace(QUEUE_THEM_IMMEDIATE_RE, "hold them pending your approval")
    .replace(QUEUED_IMMEDIATE_RE, "held pending your approval")
    .replace(QUEUE_IMMEDIATE_RE, "hold pending your approval")
    .replace(IMMEDIATE_POSTING_BARE_RE, "held pending your approval")
}

export function polishChatRenderText(text: string): string {
  return rewriteImmediatePostingCopy(rewriteScheduledSlotCopy(stripPlatformSentinels(text)))
}

export function isBlankAgentReplyBody(
  action: string,
  detail: string | null | undefined,
): boolean {
  const raw = detail && detail.length > 0 ? detail : action
  if (isProtocolOnlyChatBody(raw)) return true
  const polished = polishChatRenderText(raw)
  if (polished.length === 0) return true
  return /^Replied:?\s*$/i.test(polished)
}

export function formatWorkingLine(
  orchestratorName: string,
  agentNames: readonly string[],
): string {
  const orch = orchestratorName.trim() || "Orchestrator"
  const extras = agentNames.filter((n) => n.trim().toLowerCase() !== orch.toLowerCase())
  if (extras.length === 0) return `${orch} is working...`
  return `working - ${extras.join(", ")}`
}
