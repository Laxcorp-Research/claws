import {
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

const SCHEDULED_SLOT_RE = /\bScheduled\s+(\d{1,2}:\d{2})\s+UTC\b/gi

/** The claw never implies it will post. "Scheduled 12:30 UTC" is a proposed slot. */
export function rewriteScheduledSlotCopy(text: string): string {
  return text.replace(SCHEDULED_SLOT_RE, "proposed slot $1 UTC, pending your approval")
}

export function polishChatRenderText(text: string): string {
  return rewriteScheduledSlotCopy(stripPlatformSentinels(text))
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
