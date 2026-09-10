import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isThinkingSignaturePoison,
  decideThinkingSignatureHeal,
  THINKING_SIGNATURE_POISON_RE,
  sanitizeUserFacingLlmError,
  userFacingPoisonCopy,
  POISON_RECOVERING_LINE,
  POISON_RESOLVE_LINE,
} from "@/lib/trial/thinking-signature-heal"

describe("thinking-signature heal detection", () => {
  it("detection matrix: MESSAGE_SENT cron failure with Invalid signature", () => {
    expect(
      isThinkingSignaturePoison({
        type: "MESSAGE_SENT",
        action:
          'Sent to telegram: Cron job "orchestrator-heartbeat-md-0-12-16-20" failed: LLM request rejected: messages.11.content.0: Invalid `signature` in `thinking` block',
        detail:
          "⚠️ Cron job failed: Invalid `signature` in `thinking` block",
        sessionKey: "agent:twitter-commander:main",
      }),
    ).toBe(true)
  })

  it("detection matrix: TASK_FAILED with thinking signature text", () => {
    expect(
      isThinkingSignaturePoison({
        type: "TASK_FAILED",
        action: "Task failed",
        detail: "Invalid signature in thinking block",
        sessionKey: "agent:twitter-commander:main",
      }),
    ).toBe(true)
  })

  it("detection matrix: unrelated ERROR is not poison", () => {
    expect(
      isThinkingSignaturePoison({
        type: "ERROR",
        detail: "Railway API 500",
        sessionKey: "agent:twitter-commander:main",
      }),
    ).toBe(false)
  })

  it("detection matrix: HEARTBEAT with thinking-signature text IS poison", () => {
    expect(
      isThinkingSignaturePoison({
        type: "HEARTBEAT",
        action: "Invalid `signature` in `thinking` block",
        detail: "Invalid `signature` in `thinking` block",
      }),
    ).toBe(true)
  })

  it("detection matrix: raw Anthropic JSON on MESSAGE_SENT is poison", () => {
    expect(
      isThinkingSignaturePoison({
        type: "MESSAGE_SENT",
        detail: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "messages.11.content.0: Invalid signature in thinking block",
          },
        }),
      }),
    ).toBe(true)
  })

  it("user-facing copy never contains raw API JSON (MUTATION: raw-error-rendered → fail)", () => {
    const raw = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages.11.content.0: Invalid `signature` in `thinking` block",
      },
    })
    const shown = sanitizeUserFacingLlmError(raw)
    expect(shown).toBe(userFacingPoisonCopy())
    expect(shown).toContain(POISON_RECOVERING_LINE)
    expect(shown).toContain(POISON_RESOLVE_LINE)
    expect(shown).not.toMatch(/invalid_request_error/)
    expect(shown).not.toMatch(/"type"\s*:\s*"error"/)
    expect(shown).not.toMatch(/messages\.\d+\.content/)
  })

  it("single-heal idempotency: prior heal in window → dedup skip", () => {
    const decision = decideThinkingSignatureHeal({
      event: {
        type: "MESSAGE_SENT",
        detail: "Invalid `signature` in `thinking` block",
        sessionKey: "agent:twitter-commander:main",
      },
      priorHealInWindow: true,
    })
    expect(decision).toEqual({
      kind: "skip",
      reason: "dedup",
      sessionKey: "agent:twitter-commander:main",
    })
  })

  it("first detection → ledger with needsImageHeal (platform cannot rotate live)", () => {
    const decision = decideThinkingSignatureHeal({
      event: {
        type: "MESSAGE_SENT",
        detail: "Invalid `signature` in `thinking` block",
        sessionKey: "agent:twitter-commander:main",
      },
      priorHealInWindow: false,
    })
    expect(decision).toEqual({
      kind: "ledger",
      sessionKey: "agent:twitter-commander:main",
      needsImageHeal: true,
      platformRotated: false,
    })
  })

  it("MUTATION: disable detection regex → matrix fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/trial/thinking-signature-heal.ts"),
      "utf8",
    )
    expect(src).toContain("THINKING_SIGNATURE_POISON_RE")
    expect(THINKING_SIGNATURE_POISON_RE.test("Invalid `signature` in `thinking` block")).toBe(
      true,
    )
    expect(src).toMatch(/function isThinkingSignaturePoison/)
    // Live predicate must consult the regex (not a hardcoded true/false).
    expect(src).toMatch(/THINKING_SIGNATURE_POISON_RE\.test\(/)
  })
})
