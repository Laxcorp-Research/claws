/**
 * -11 thinking-signature heal contract (repo-side, against overlay code).
 *
 * poisoned fixture → one strip+retry + ledger;
 * second occurrence within window → no double-heal.
 * MUTATION: disable heal (isThinkingSignatureReject always false) → fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let heal: any

beforeEach(async () => {
  vi.resetModules()
  heal = await import("../../container/thinking-signature-heal.mjs")
})

describe("thinking-signature heal overlay (-11)", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  const poisonedRequest = {
    model: "claude-sonnet-4-6",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "poisoned chain",
            thinkingSignature: "EsMMCpMB-bad-sig",
          },
          { type: "text", text: "hello" },
        ],
      },
      { role: "user", content: "continue" },
    ],
  }

  const reject = {
    status: 400,
    bodyJson: {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "messages.11.content.0: Invalid `signature` in `thinking` block",
      },
    },
    bodyText:
      'messages.11.content.0: Invalid `signature` in `thinking` block',
  }

  it("poisoned fixture → one strip+retry + ledger", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-heal-"))
    const ledger = vi.fn(async () => ({ ok: true }))
    const retryFetch = vi.fn(async (body: { messages: unknown[] }) => {
      expect(
        (body.messages[0] as { content: unknown[] }).content.some(
          (p) => (p as { type?: string }).type === "thinking",
        ),
      ).toBe(false)
      return {
        status: 200,
        bodyText: JSON.stringify({
          content: [{ type: "text", text: "recovered" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        bodyJson: { content: [{ type: "text", text: "recovered" }] },
      }
    })

    const result = await heal.healThinkingSignatureOnce({
      reject,
      requestBody: poisonedRequest,
      sessionKey: "agent:twitter-commander:main",
      dataDir: dir,
      retryFetch,
      ledger,
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    })

    expect(result.healed).toBe(true)
    expect(result.blocksStripped).toBe(1)
    expect(retryFetch).toHaveBeenCalledTimes(1)
    expect(ledger).toHaveBeenCalledTimes(1)
    const calls = ledger.mock.calls as unknown as Array<
      [
        {
          metadata: { eventKind: string; blocksStripped: number }
          sessionKey: string
        },
      ]
    >
    const ledgerEvent = calls[0]![0]!
    expect(ledgerEvent.metadata.eventKind).toBe("thinking_signature_heal")
    expect(ledgerEvent.metadata.blocksStripped).toBe(1)
    expect(ledgerEvent.sessionKey).toBe("agent:twitter-commander:main")
  })

  it("second occurrence within 24h window → no double-heal", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-heal-"))
    const ledger = vi.fn(async () => ({ ok: true }))
    const retryFetch = vi.fn(async () => ({
      status: 200,
      bodyText: "{}",
      bodyJson: {},
    }))
    const nowMs = Date.parse("2026-07-28T12:00:00.000Z")
    const sessionKey = "agent:twitter-commander:main"

    const first = await heal.healThinkingSignatureOnce({
      reject,
      requestBody: poisonedRequest,
      sessionKey,
      dataDir: dir,
      retryFetch,
      ledger,
      nowMs,
    })
    expect(first.healed).toBe(true)

    const second = await heal.healThinkingSignatureOnce({
      reject,
      requestBody: poisonedRequest,
      sessionKey,
      dataDir: dir,
      retryFetch,
      ledger,
      nowMs: nowMs + 60_000,
    })
    expect(second.healed).toBe(false)
    expect(second.reason).toBe("dedup")
    expect(retryFetch).toHaveBeenCalledTimes(1)
    expect(ledger).toHaveBeenCalledTimes(1)
  })

  it("never heals non-signature LLM errors", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-heal-"))
    const result = await heal.healThinkingSignatureOnce({
      reject: {
        status: 401,
        bodyJson: {
          type: "error",
          error: {
            type: "authentication_error",
            message: "Invalid API key",
          },
        },
      },
      requestBody: poisonedRequest,
      sessionKey: "s1",
      dataDir: dir,
      retryFetch: vi.fn(),
      ledger: vi.fn(),
    })
    expect(result.healed).toBe(false)
    expect(result.reason).toBe("not-signature-reject")
  })

  it("stripThinkingFromSessionJsonl removes thinkingSignature parts", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "x",
            thinkingSignature: "sig",
          },
          { type: "text", text: "ok" },
        ],
      },
    })
    const { text, blocksStripped } = heal.stripThinkingFromSessionJsonl(
      `${line}\n`,
    )
    expect(blocksStripped).toBe(1)
    expect(text).not.toContain("thinkingSignature")
    expect(text).toContain('"text":"ok"')
  })

  it("MUTATION: disable heal detection → contract fails", () => {
    const src = readFileSync(
      path.join(process.cwd(), "container/thinking-signature-heal.mjs"),
      "utf8",
    )
    expect(src).toContain("export function isThinkingSignatureReject")
    expect(src).not.toMatch(
      /export function isThinkingSignatureReject\(args\) \{\s*return false/,
    )
    expect(src).toContain("THINKING_SIGNATURE_POISON_RE")
    expect(src).toContain("thinking_signature_heal")
    // Credit-proxy must wire heal on the gateway request path.
    const proxy = readFileSync(
      path.join(process.cwd(), "container/credit-proxy.mjs"),
      "utf8",
    )
    expect(proxy).toContain("healThinkingSignatureOnce")
    expect(proxy).toContain("thinking-signature-heal.mjs")
    expect(proxy).toContain("userFacingPoisonCopy")
    expect(proxy).toContain("thinking-signature heal missed")
    const reporter = readFileSync(
      path.join(process.cwd(), "container/claws-activity-reporter/index.mjs"),
      "utf8",
    )
    expect(reporter).toContain("stripThinkingFromAllSessionFiles")
    expect(reporter).toContain("Webchat LLM errors land as TASK_COMPLETE")
    expect(reporter).toContain("void maybeHealPoisonedSession")
  })

  it("user-facing copy matches platform; boot strip walks session jsonl", () => {
    expect(heal.POISON_RECOVERING_LINE).toBe(
      "Your Claw hit a problem - recovering (~1 min)",
    )
    expect(heal.userFacingPoisonCopy()).toContain(heal.POISON_RESOLVE_LINE)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-heal-boot-"))
    const sessDir = path.join(dir, "agents", "twitter-commander", "sessions")
    fs.mkdirSync(sessDir, { recursive: true })
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "x", thinkingSignature: "sig" },
          { type: "text", text: "ok" },
        ],
      },
    })
    fs.writeFileSync(path.join(sessDir, "abc.jsonl"), `${line}\n`)
    const stripped = heal.stripThinkingFromAllSessionFiles(dir)
    expect(stripped.files).toBe(1)
    expect(stripped.blocksStripped).toBe(1)
  })
})
