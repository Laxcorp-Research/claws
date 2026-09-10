/**
 * Platform half of thinking-signature poison self-heal (GRACE / cry-forever).
 *
 * Live session rotate/strip is NOT reachable while the container is RUNNING/WARM
 * (sessions live on container disk; platform only restores snapshots on boot).
 * This module: DETECT → LEDGER once per sessionKey window → flag needsImageHeal
 * for the -11 overlay half. Auto-redeploy skips the idle-5min guard: a poisoned
 * session cannot serve the chatting user anyway.
 */

export const THINKING_SIGNATURE_POISON_RE =
  /Invalid\s+`?signature`?\s+in\s+`?thinking`?\s+block/i

const RAW_ANTHROPIC_ERROR_RE =
  /"type"\s*:\s*"invalid_request_error"|invalid_request_error|"type"\s*:\s*"error"/i

/** Dedup window - cry-forever must not become ledger-forever. */
export const THINKING_SIGNATURE_HEAL_DEDUP_MS = 24 * 60 * 60 * 1000

export const THINKING_SIGNATURE_POISON_EVENT_KIND = "thinking_signature_poison"

/** User-facing recover copy. Hyphen only. MUTATION: raw-error-rendered → fails. */
export const POISON_RECOVERING_LINE =
  "Your Claw hit a problem - recovering (~1 min)"

export const POISON_RESOLVE_LINE =
  "This session cannot answer until it is healthy. Stay here; no need to resend."

export function userFacingPoisonCopy(): string {
  return `${POISON_RECOVERING_LINE}\n${POISON_RESOLVE_LINE}`
}

export type ThinkingSignatureDetectInput = {
  type: string
  action?: string | null
  detail?: string | null
  metadataError?: string | null
  sessionKey?: string | null
}

function poisonHaystack(input: ThinkingSignatureDetectInput): string {
  return [input.action, input.detail, input.metadataError]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
}

/**
 * True when activity text matches Anthropic's thinking-signature reject class.
 * Type is not a gate: HEARTBEAT / chat / cron all poison the same session.
 * MUTATION: empty regex / always-false → detection tests fail.
 */
export function isThinkingSignaturePoison(
  input: ThinkingSignatureDetectInput,
): boolean {
  return THINKING_SIGNATURE_POISON_RE.test(poisonHaystack(input))
}

export function isRawLlmErrorText(text: string | null | undefined): boolean {
  if (!text || text.length === 0) return false
  if (THINKING_SIGNATURE_POISON_RE.test(text)) return true
  if (RAW_ANTHROPIC_ERROR_RE.test(text) && /thinking|signature|messages\.\d+/i.test(text)) {
    return true
  }
  return false
}

export function sanitizeUserFacingLlmError(text: string): string {
  if (!isRawLlmErrorText(text)) return text
  return userFacingPoisonCopy()
}

export type HealLedgerDecision =
  | { kind: "skip"; reason: "not-poison" }
  | { kind: "skip"; reason: "dedup"; sessionKey: string | null }
  | {
      kind: "ledger"
      sessionKey: string | null
      /** Platform cannot rotate live sessions - -11 must strip/retry. */
      needsImageHeal: true
      platformRotated: false
    }

/**
 * Pure planner: given poison detection + whether a prior heal ledger exists
 * in-window for this sessionKey, decide skip vs ledger.
 * Dedup still means "schedule the redeploy" - the caller must heal even when
 * the SYSTEM row already exists (idle-blocked first try).
 */
export function decideThinkingSignatureHeal(args: {
  event: ThinkingSignatureDetectInput
  priorHealInWindow: boolean
}): HealLedgerDecision {
  if (!isThinkingSignaturePoison(args.event)) {
    return { kind: "skip", reason: "not-poison" }
  }
  const sessionKey = args.event.sessionKey ?? null
  if (args.priorHealInWindow) {
    return { kind: "skip", reason: "dedup", sessionKey }
  }
  return {
    kind: "ledger",
    sessionKey,
    needsImageHeal: true,
    platformRotated: false,
  }
}
