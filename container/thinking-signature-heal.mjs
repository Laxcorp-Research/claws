/**
 * -11 thinking-signature self-heal (container half).
 *
 * On Anthropic invalid-signature-in-thinking reject: strip poisoned thinking
 * blocks from the request (and optionally the session jsonl), retry ONCE,
 * ledger eventKind=thinking_signature_heal. Heal-once per sessionKey / 24h
 * (aligned with platform THINKING_SIGNATURE_HEAL_DEDUP_MS).
 *
 * Justification vs rotate: strip is safer against the -10 dist - OpenClaw
 * rotation orphans main (observed f7efb24d→69364845) and drops continuity;
 * strip keeps the cron-bound session identity and removes only the parts
 * Anthropic rejects on replay.
 */

import fs from "node:fs"
import path from "node:path"

/** Align with platform src/lib/trial/thinking-signature-heal.ts */
export const THINKING_SIGNATURE_HEAL_DEDUP_MS = 24 * 60 * 60 * 1000

export const THINKING_SIGNATURE_HEAL_EVENT_KIND = "thinking_signature_heal"

/** Structural + message-family match for Anthropic's reject class. */
export const THINKING_SIGNATURE_POISON_RE =
  /Invalid\s+`?signature`?\s+in\s+`?thinking`?\s+block/i

/**
 * True when an Anthropic HTTP response is the thinking-signature reject class.
 * Prefers structured error.type + message; falls back to message regex only.
 * MUTATION: always-false → heal tests fail.
 */
export function isThinkingSignatureReject(args) {
  const status = args?.status
  const bodyJson = args?.bodyJson ?? null
  const bodyText = typeof args?.bodyText === "string" ? args.bodyText : ""

  const err = bodyJson && typeof bodyJson === "object" ? bodyJson.error : null
  const message =
    (err && typeof err.message === "string" && err.message) ||
    (typeof bodyJson?.message === "string" && bodyJson.message) ||
    bodyText

  if (!THINKING_SIGNATURE_POISON_RE.test(message)) return false

  // Non-signature LLM errors must not heal even if message somehow matched weakly.
  if (err && typeof err.type === "string") {
    // Anthropic uses invalid_request_error for this class; refuse auth/rate/etc.
    if (
      err.type === "authentication_error" ||
      err.type === "permission_error" ||
      err.type === "rate_limit_error" ||
      err.type === "api_error"
    ) {
      return false
    }
  }

  // Prefer 4xx (typically 400); allow missing status in unit fixtures.
  if (typeof status === "number" && (status < 400 || status >= 500)) {
    return false
  }
  return true
}

function isThinkingPart(part) {
  if (!part || typeof part !== "object") return false
  if (part.type === "thinking" || part.type === "redacted_thinking") return true
  if ("thinkingSignature" in part || "thinking_signature" in part) return true
  return false
}

/**
 * Strip thinking / thinkingSignature parts from an Anthropic messages[] payload.
 * Returns { messages, blocksStripped }.
 */
export function stripThinkingBlocksFromMessages(messages) {
  if (!Array.isArray(messages)) {
    return { messages, blocksStripped: 0 }
  }
  let blocksStripped = 0
  const next = messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg
    const content = msg.content
    if (!Array.isArray(content)) return msg
    const kept = []
    for (const part of content) {
      if (isThinkingPart(part)) {
        blocksStripped += 1
        continue
      }
      kept.push(part)
    }
    return { ...msg, content: kept }
  })
  return { messages: next, blocksStripped }
}

/**
 * Strip thinking blocks from a parsed Anthropic request body.
 */
export function stripThinkingFromRequestBody(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { body: parsed, blocksStripped: 0 }
  }
  const { messages, blocksStripped } = stripThinkingBlocksFromMessages(
    parsed.messages,
  )
  if (blocksStripped === 0) {
    return { body: parsed, blocksStripped: 0 }
  }
  return {
    body: { ...parsed, messages },
    blocksStripped,
  }
}

/**
 * Strip thinking parts from OpenClaw session jsonl (one JSON event per line).
 * Walks message.content arrays and nested message.message.content.
 */
export function stripThinkingFromSessionJsonl(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { text, blocksStripped: 0 }
  }
  let blocksStripped = 0
  const lines = text.split("\n")
  const out = lines.map((line) => {
    if (!line.trim()) return line
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      return line
    }
    const stripNode = (node) => {
      if (!node || typeof node !== "object") return node
      if (Array.isArray(node.content)) {
        const kept = []
        for (const part of node.content) {
          if (isThinkingPart(part)) {
            blocksStripped += 1
            continue
          }
          kept.push(part)
        }
        node = { ...node, content: kept }
      }
      if (node.message && typeof node.message === "object") {
        node = { ...node, message: stripNode(node.message) }
      }
      return node
    }
    return JSON.stringify(stripNode(obj))
  })
  return { text: out.join("\n"), blocksStripped }
}

function healLedgerPath(dataDir) {
  return path.join(dataDir, ".claws", "thinking-signature-heal.json")
}

export function readHealLedger(dataDir) {
  const p = healLedgerPath(dataDir)
  try {
    if (!fs.existsSync(p)) return {}
    const raw = JSON.parse(fs.readFileSync(p, "utf8"))
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

export function writeHealLedger(dataDir, ledger) {
  const p = healLedgerPath(dataDir)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2), "utf8")
}

export function hasHealInWindow(args) {
  const {
    dataDir,
    sessionKey,
    nowMs = Date.now(),
    windowMs = THINKING_SIGNATURE_HEAL_DEDUP_MS,
    ledger = null,
  } = args
  const key = sessionKey || "default"
  const map = ledger ?? readHealLedger(dataDir)
  const ts = map[key]
  if (typeof ts !== "number") return false
  return nowMs - ts < windowMs
}

export function markHealAttempt(args) {
  const {
    dataDir,
    sessionKey,
    nowMs = Date.now(),
    ledger = null,
  } = args
  const key = sessionKey || "default"
  const map = { ...(ledger ?? readHealLedger(dataDir)), [key]: nowMs }
  writeHealLedger(dataDir, map)
  return map
}

/**
 * Pure planner + optional upstream retry.
 *
 * @param {object} args
 * @param {{ status: number, bodyText?: string, bodyJson?: object }} args.reject
 * @param {object} args.requestBody - parsed Anthropic request
 * @param {string|null} args.sessionKey
 * @param {string} args.dataDir
 * @param {(body: object) => Promise<{ status: number, bodyText: string, bodyJson: object|null }>} [args.retryFetch]
 * @param {(event: object) => Promise<unknown>|unknown} [args.ledger]
 * @param {boolean} [args.priorHealInWindow] - inject for tests (skip disk)
 * @param {number} [args.nowMs]
 */
export async function healThinkingSignatureOnce(args) {
  const {
    reject,
    requestBody,
    sessionKey = null,
    dataDir,
    retryFetch,
    ledger,
    nowMs = Date.now(),
    priorHealInWindow,
  } = args

  if (!isThinkingSignatureReject(reject)) {
    return { healed: false, reason: "not-signature-reject", blocksStripped: 0 }
  }

  const inWindow =
    typeof priorHealInWindow === "boolean"
      ? priorHealInWindow
      : hasHealInWindow({ dataDir, sessionKey, nowMs })

  if (inWindow) {
    return { healed: false, reason: "dedup", blocksStripped: 0, sessionKey }
  }

  const stripped = stripThinkingFromRequestBody(requestBody)
  if (stripped.blocksStripped === 0) {
    return { healed: false, reason: "nothing-to-strip", blocksStripped: 0 }
  }

  if (typeof priorHealInWindow !== "boolean" && dataDir) {
    markHealAttempt({ dataDir, sessionKey, nowMs })
  }

  let retry = null
  if (typeof retryFetch === "function") {
    retry = await retryFetch(stripped.body)
  }

  const event = {
    type: "ERROR",
    timestamp: new Date(nowMs).toISOString(),
    agentId: null,
    runId: null,
    sessionKey,
    channelId: null,
    action: "Thinking-signature heal: stripped poisoned thinking blocks + retry",
    detail: `blocksStripped=${stripped.blocksStripped} sessionKey=${sessionKey ?? "null"}`,
    metadata: {
      eventKind: THINKING_SIGNATURE_HEAL_EVENT_KIND,
      sessionKey,
      blocksStripped: stripped.blocksStripped,
      retried: Boolean(retry),
    },
  }
  if (typeof ledger === "function") {
    await ledger(event)
  }

  return {
    healed: true,
    reason: "stripped-and-retried",
    blocksStripped: stripped.blocksStripped,
    sessionKey,
    strippedBody: stripped.body,
    retry,
    ledgerEvent: event,
  }
}

/**
 * Resolve agents/<id>/sessions/<uuid>.jsonl from sessionKey / agentId.
 */
export function resolveSessionJsonlPath(dataDir, sessionKey, agentId) {
  if (!dataDir) return null
  let agent = typeof agentId === "string" && agentId.length > 0 ? agentId : null
  let key = typeof sessionKey === "string" ? sessionKey : null
  if (!agent && key) {
    const parts = key.split(":")
    if (parts[0] === "agent" && parts[1]) agent = parts[1]
  }
  if (!agent) return null
  const sessionsDir = path.join(dataDir, "agents", agent, "sessions")
  const indexPath = path.join(sessionsDir, "sessions.json")
  let uuid = null
  try {
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"))
      if (key && typeof index[key] === "string") {
        uuid = index[key].replace(/\.jsonl$/i, "")
      } else if (typeof index[`agent:${agent}:main`] === "string") {
        uuid = index[`agent:${agent}:main`].replace(/\.jsonl$/i, "")
      }
    }
  } catch {
    return null
  }
  if (!uuid) return null
  const filePath = path.join(sessionsDir, `${uuid}.jsonl`)
  return fs.existsSync(filePath) ? filePath : null
}

/**
 * Strip thinking blocks from the live session file (BYOK / post-failure path).
 */
export function stripThinkingFromSessionFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, blocksStripped: 0 }
  }
  const raw = fs.readFileSync(filePath, "utf8")
  const { text, blocksStripped } = stripThinkingFromSessionJsonl(raw)
  if (blocksStripped === 0) return { ok: true, blocksStripped: 0 }
  fs.writeFileSync(filePath, text, "utf8")
  return { ok: true, blocksStripped }
}
