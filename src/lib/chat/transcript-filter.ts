import { POISON_RECOVERING_LINE } from "@/lib/trial/thinking-signature-heal"

const NARRATION_RE =
  /^(?:Subagent Context|Task started:|Task completed in |Claws overlay boot)/i

export function sessionKeyLooksSubagent(sessionKey: string | null | undefined): boolean {
  if (!sessionKey) return false
  return sessionKey.includes("subagent")
}

export function isNarrationChatBody(action: string, detail?: string | null): boolean {
  const blob = `${action}\n${detail ?? ""}`.trim()
  return NARRATION_RE.test(action) || NARRATION_RE.test(blob)
}

export function isPlatformInjectionBody(text: string): boolean {
  if (text.includes(POISON_RECOVERING_LINE)) return true
  if (/Claws overlay boot/i.test(text)) return true
  return false
}

export function shouldDropChatBubble(args: {
  actionType: string
  sessionKey?: string | null
  action: string
  detail?: string | null
}): boolean {
  if (args.actionType !== "MESSAGE_RECEIVED" && args.actionType !== "MESSAGE_SENT") {
    return false
  }
  if (sessionKeyLooksSubagent(args.sessionKey)) return true
  const blob = `${args.action}\n${args.detail ?? ""}`
  if (isPlatformInjectionBody(args.action) || isPlatformInjectionBody(args.detail ?? "") || isPlatformInjectionBody(blob)) {
    return false
  }
  if (args.actionType === "MESSAGE_SENT" && isNarrationChatBody(args.action, args.detail)) {
    return true
  }
  return false
}
