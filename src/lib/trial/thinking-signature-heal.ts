/**
 * Platform half of thinking-signature poison self-heal (GRACE / cry-forever).
 *
 * Live session rotate/strip is NOT reachable while the container is RUNNING/WARM
 * (sessions live on container disk; platform only restores snapshots on boot).
 * This module: DETECT → LEDGER once per sessionKey window → flag needsImageHeal
 * for the -11 overlay half.
 */

export const THINKING_SIGNATURE_POISON_RE =
  /Invalid\s+`?signature`?\s+in\s+`?thinking`?\s+block/i

/** Dedup window — cry-forever must not become ledger-forever. */
export const THINKING_SIGNATURE_HEAL_DEDUP_MS = 24 * 60 * 60 * 1000

export const THINKING_SIGNATURE_POISON_EVENT_KIND = "thinking_signature_poison"

export type ThinkingSignatureDetectInput = {
  type: string
  action?: string | null
  detail?: string | null
  metadataError?: string | null
  sessionKey?: string | null
}

/**
 * True when activity text matches Anthropic's thinking-signature reject class.
 * MUTATION: empty regex / always-false → detection tests fail.
 */
export function isThinkingSignaturePoison(
  input: ThinkingSignatureDetectInput,
): boolean {
  if (
    input.type !== "TASK_FAILED" &&
    input.type !== "ERROR" &&
    input.type !== "MESSAGE_SENT"
  ) {
    return false
  }
  const haystack = [input.action, input.detail, input.metadataError]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
  return THINKING_SIGNATURE_POISON_RE.test(haystack)
}

export type HealLedgerDecision =
  | { kind: "skip"; reason: "not-poison" }
  | { kind: "skip"; reason: "dedup"; sessionKey: string | null }
  | {
      kind: "ledger"
      sessionKey: string | null
      /** Platform cannot rotate live sessions — -11 must strip/retry. */
      needsImageHeal: true
      platformRotated: false
    }

/**
 * Pure planner: given poison detection + whether a prior heal ledger exists
 * in-window for this sessionKey, decide skip vs ledger.
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
