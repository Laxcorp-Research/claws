import { CHANNEL_IDS } from "@/lib/openclaw/channel-config"
import {
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

export type ConversationRole = "user" | "assistant" | "system" | "tool"

export interface ConversationSummary {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount?: number
}

export type ConversationTextRole = "user" | "assistant"

export interface ConversationTextMessage {
  type: "message"
  role: ConversationTextRole
  content: string
  at: string | null
}

export interface ConversationToolMessage {
  type: "tool"
  name: string
  at: string | null
}

export type ConversationMessage = ConversationTextMessage | ConversationToolMessage

const KNOWN_PROVIDER_IDS = new Set<string>(CHANNEL_IDS)
const EXPLICIT_NON_PROVIDER_HINTS = new Set(["webchat"])
const TOOL_CALL_TYPES = new Set(["tool_use", "tool_call", "function_call", "toolCall"])
const TOOL_RESULT_TYPES = new Set(["tool_result", "tool_response", "toolResult"])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value
  for (const segment of path) {
    const record = asRecord(current)
    if (!record) return null
    current = record[segment]
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null
}

function normalizeAt(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  return null
}

function firstString(value: unknown, keys: string[]): string | null {
  const record = asRecord(value)
  if (!record) return null
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim()
  }
  return null
}

function channelFromSessionKey(sessionKey: string): string | null {
  const [prefix] = sessionKey.split(":")
  return KNOWN_PROVIDER_IDS.has(prefix) ? prefix : null
}

export function isHumanFacingSessionKey(sessionKey: string): boolean {
  const parts = sessionKey.split(":")
  if (parts.includes("subagent")) return false
  if (parts.length === 3 && parts[0] === "agent" && parts[2] === "main" && parts[1].length > 0) return true
  return KNOWN_PROVIDER_IDS.has(parts[0]) || EXPLICIT_NON_PROVIDER_HINTS.has(parts[0])
}

export function deriveChannelHint(session: unknown, sessionKey: string): string {
  const explicit = [
    nestedString(session, ["deliveryContext", "channel"]),
    nestedString(session, ["origin", "provider"]),
    nestedString(session, ["origin", "surface"]),
    nestedString(session, ["metadata", "channelId"]),
    firstString(session, ["channelId", "channel", "provider", "surface"]),
    channelFromSessionKey(sessionKey),
  ].find((candidate): candidate is string =>
    typeof candidate === "string" &&
    (KNOWN_PROVIDER_IDS.has(candidate) || EXPLICIT_NON_PROVIDER_HINTS.has(candidate)),
  )

  if (explicit) return explicit
  return "unknown"
}

function extractSessionKey(session: unknown): string | null {
  return firstString(session, ["sessionKey", "key", "id"])
}

function extractMessageCount(session: unknown): number | undefined {
  const record = asRecord(session)
  if (!record) return undefined
  const value = record.messageCount ?? record.messagesCount ?? record.count
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value
  if (Array.isArray(record.messages)) return record.messages.length
  return undefined
}

function extractLastActivityAt(session: unknown): string | null {
  const record = asRecord(session)
  if (!record) return null
  return (
    normalizeAt(record.lastActivityAt) ??
    normalizeAt(record.lastMessageAt) ??
    normalizeAt(record.updatedAt) ??
    normalizeAt(asRecord(record.lastMessage)?.timestamp) ??
    normalizeAt(record.createdAt)
  )
}

export function normalizeConversationSummaries(payload: unknown): ConversationSummary[] {
  const record = asRecord(payload)
  const sessions = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.sessions)
      ? record.sessions
      : Array.isArray(record?.items)
        ? record.items
        : []

  return sessions.flatMap((session) => {
    const sessionKey = extractSessionKey(session)
    if (!sessionKey) return []
    if (!isHumanFacingSessionKey(sessionKey)) return []
    const messageCount = extractMessageCount(session)
    return [{
      sessionKey,
      channelHint: deriveChannelHint(session, sessionKey),
      lastActivityAt: extractLastActivityAt(session),
      ...(messageCount === undefined ? {} : { messageCount }),
    }]
  })
}

function normalizeRole(value: unknown): ConversationRole | null {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value
  return null
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part
        const record = asRecord(part)
        return typeof record?.text === "string" ? record.text : ""
      })
      .filter(Boolean)
      .join("\n")
  }
  const record = asRecord(value)
  if (typeof record?.text === "string") return record.text
  return ""
}

function safeToolName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^[\w.-]{1,80}$/.test(trimmed)) return null
  return trimmed
}

function toolNameFromBlock(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null
  const type = typeof record.type === "string" ? record.type : null
  if (!type || !TOOL_CALL_TYPES.has(type)) return null
  return (
    safeToolName(record.name) ??
    safeToolName(record.toolName) ??
    safeToolName(record.method) ??
    safeToolName(asRecord(record.function)?.name)
  )
}

function collectToolNames(item: Record<string, unknown>): string[] {
  const names = new Set<string>()
  const direct = toolNameFromBlock(item)
  if (direct) names.add(direct)

  if (Array.isArray(item.content)) {
    for (const block of item.content) {
      const name = toolNameFromBlock(block)
      if (name) names.add(name)
    }
  }

  return Array.from(names)
}

function isToolResultPayload(value: unknown): boolean {
  const record = asRecord(value)
  if (!record) return false
  const type = typeof record.type === "string" ? record.type : null
  return !!type && TOOL_RESULT_TYPES.has(type)
}

function parsedLooksLikeToolPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(parsedLooksLikeToolPayload)
  const record = asRecord(value)
  if (!record) return false
  const type = typeof record.type === "string" ? record.type : null
  if (type && (TOOL_CALL_TYPES.has(type) || TOOL_RESULT_TYPES.has(type))) return true
  return (
    "tool_use_id" in record ||
    "toolCallId" in record ||
    "input" in record ||
    "result" in record ||
    "output" in record ||
    "stderr" in record ||
    "stdout" in record
  )
}

function isRawToolJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false
  try {
    return parsedLooksLikeToolPayload(JSON.parse(trimmed) as unknown)
  } catch {
    return false
  }
}

function shouldDropText(role: ConversationTextRole, content: string, rawContent: unknown): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true
  if (role === "assistant" && isProtocolOnlyChatBody(trimmed)) return true
  if (trimmed.includes("EXTERNAL_UNTRUSTED_CONTENT")) return true
  if (role === "assistant" && isRawToolJson(trimmed)) return true
  if (isToolResultPayload(rawContent)) return true
  if (Array.isArray(rawContent) && rawContent.some(isToolResultPayload)) return true
  return false
}

export function normalizeConversationMessages(payload: unknown): ConversationMessage[] {
  const record = asRecord(payload)
  const messages = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.messages)
      ? record.messages
      : Array.isArray(record?.items)
        ? record.items
        : Array.isArray(record?.history)
          ? record.history
          : []

  return messages.flatMap((message) => {
    const item = asRecord(message)
    if (!item) return []
    const at = normalizeAt(item.timestamp ?? item.at ?? item.createdAt)
    const role = normalizeRole(item.role)
    const normalized: ConversationMessage[] = []

    if (role === "assistant" || role === null) {
      normalized.push(...collectToolNames(item).map((name) => ({ type: "tool" as const, name, at })))
    }

    if (role !== "user" && role !== "assistant") return normalized
    const content = textFromContent(item.content).trim()
    if (!shouldDropText(role, content, item.content)) {
      normalized.push({ type: "message", role, content: stripPlatformSentinels(content), at })
    }
    return normalized
  })
}
