/**
 * Platform tokens the agent is told to emit so Claws can detect a
 * machine event. They must stay in the stored activity `detail` (API-side
 * transcript scan) and must never reach a rendered chat bubble.
 *
 * Generated-prose grep: tokens BOOT/WAVE-0/heartbeat tell the agent to
 * put in a message:
 *   - CLAWS_USER_MD_INTERVIEW_COMPLETE (confirmation line; strip from render)
 *   - NO_REPLY (boot "all good" reply; drop the whole bubble)
 *   - HEARTBEAT_OK (emit ONLY when there is nothing else to say; strip if
 *     it trails a real reply, drop the bubble if it is the whole body)
 * EXTERNAL_UNTRUSTED_CONTENT is a tool-payload wrapper, not generated
 * prose, but it gets the same drop if it leaks into chat.
 */

export const PLATFORM_INTERVIEW_COMPLETE_TOKEN = "CLAWS_USER_MD_INTERVIEW_COMPLETE"

export const PLATFORM_HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK"

export const PLATFORM_RENDER_STRIP_TOKENS = [
  PLATFORM_INTERVIEW_COMPLETE_TOKEN,
  PLATFORM_HEARTBEAT_OK_TOKEN,
] as const

export const PLATFORM_CHAT_DROP_EXACT = ["NO_REPLY", PLATFORM_HEARTBEAT_OK_TOKEN] as const

export const PLATFORM_CHAT_DROP_IF_PRESENT = ["EXTERNAL_UNTRUSTED_CONTENT"] as const

export function stripPlatformSentinels(text: string): string {
  let out = text
  for (const token of PLATFORM_RENDER_STRIP_TOKENS) {
    out = out.split(token).join("")
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function isProtocolOnlyChatBody(value: string | null | undefined): boolean {
  if (value == null) return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  if ((PLATFORM_CHAT_DROP_EXACT as readonly string[]).includes(trimmed)) return true
  if (PLATFORM_CHAT_DROP_IF_PRESENT.some((token) => trimmed.includes(token))) return true
  return stripPlatformSentinels(trimmed).length === 0
}
