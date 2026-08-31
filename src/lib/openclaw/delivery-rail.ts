import type { WorkflowDeliveryMode } from "@/lib/openclaw/workflow-language"
import { TWITTER_TOKEN_CANNOT_POST_COPY } from "@/lib/tools/twitter-api-honesty"

/**
 * Mechanical "Ask before acting" rail.
 * Outbound post/send/execute tools stay denied until the human flips
 * AUTO_PROCEED AND the specific tool is marked autonomous-capable.
 * Prose alone is not a rail. MUTATION: deny merge removed → fails.
 */

export const OUTBOUND_ACTION_DENY = ["message", "exec", "process"] as const

/** Tools that may run unattended when deliveryMode is AUTO_PROCEED. Empty until a tool opts in. */
export const AUTONOMOUS_CAPABLE_TOOLS: readonly string[] = []

const WRITE_TOOL_RE =
  /(tweet|create_post|creation_of_a_post|send_tweet|publish_post|post_tweet)/i

export const CRITIC_NE_HUMAN_COPY =
  "Critic approval is not human approval; nothing ships without the human's explicit approve."

export const NO_USER_APPROVAL_NEEDED_RE = /no user approval needed/i

export function isOutboundActionTool(name: string): boolean {
  const n = name.trim()
  if ((OUTBOUND_ACTION_DENY as readonly string[]).includes(n)) return true
  return WRITE_TOOL_RE.test(n)
}

export function toolSupportsAutonomous(name: string): boolean {
  return AUTONOMOUS_CAPABLE_TOOLS.includes(name)
}

export function shouldDenyOutboundAction(args: {
  deliveryMode: WorkflowDeliveryMode | string | null | undefined
  toolName: string
}): boolean {
  if (!isOutboundActionTool(args.toolName)) return false
  if (
    args.deliveryMode === "AUTO_PROCEED" &&
    toolSupportsAutonomous(args.toolName)
  ) {
    return false
  }
  return true
}

export function outboundDenyList(deliveryMode: WorkflowDeliveryMode | string | null | undefined): string[] {
  const names = new Set<string>(OUTBOUND_ACTION_DENY)
  return [...names].filter((toolName) =>
    shouldDenyOutboundAction({ deliveryMode, toolName }),
  )
}

export function mergeOutboundDenyIntoTools(
  existingTools: Record<string, unknown> | undefined,
  deliveryMode: WorkflowDeliveryMode | string | null | undefined,
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) }
  const existingDeny = Array.isArray(tools.deny)
    ? (tools.deny as unknown[]).filter((d): d is string => typeof d === "string")
    : []
  const next = [...existingDeny]
  for (const name of outboundDenyList(deliveryMode)) {
    if (!next.includes(name)) next.push(name)
  }
  tools.deny = next
  return tools
}

export function deliveryProseViolations(text: string): string[] {
  const hits: string[] = []
  if (NO_USER_APPROVAL_NEEDED_RE.test(text)) {
    hits.push("orchestrator claimed no user approval needed")
  }
  return hits
}

export function looksLikeApprovalRequest(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false
  if (deliveryProseViolations(text).length > 0) return false
  return /awaiting your approval|requests approval|needs your approve/i.test(text)
}

/**
 * Custom Builder soul/heartbeat is returned as-is today, so a redeploy from
 * a newer platform SHA (e16f767) still ships the old 402 / "ships" prose.
 * Overlay is mechanical: append missing law, never strip the author's voice.
 */
export function overlayMissionLaw(
  text: string,
  opts?: { twitterReadOnly?: boolean },
): string {
  const body = text.replace(/\s+$/u, "")
  const additions: string[] = []
  if (!body.includes(CRITIC_NE_HUMAN_COPY)) {
    additions.push(`- ${CRITIC_NE_HUMAN_COPY}`)
  }
  if (opts?.twitterReadOnly && !body.includes(TWITTER_TOKEN_CANNOT_POST_COPY)) {
    additions.push(`- ${TWITTER_TOKEN_CANNOT_POST_COPY}`)
  }
  if (additions.length === 0) {
    return text.endsWith("\n") ? text : `${text}\n`
  }
  return `${body}\n\n# Delivery law\n${additions.join("\n")}\n`
}
