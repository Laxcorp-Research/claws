import { CHANNEL_IDS } from "@/lib/openclaw/channel-config"

export type ConversationRole = "user" | "assistant" | "system" | "tool"

export interface ConversationSummary {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount?: number
}

export interface ConversationMessage {
  role: ConversationRole
  content: string
  at: string | null
}

const KNOWN_PROVIDER_IDS = new Set<string>(CHANNEL_IDS)
const EXPLICIT_NON_PROVIDER_HINTS = new Set(["webchat"])

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

export function deriveChannelHint(session: unknown, sessionKey: string): string {
  const explicit = [
    nestedString(session, ["deliveryContext", "channel"]),
    nestedString(session, ["origin", "provider"]),
    nestedString(session, ["origin", "surface"]),
    nestedString(session, ["metadata", "channelId"]),
    firstString(session, ["channelId", "channel", "provider", "surface"]),
    channelFromSessionKey(sessionKey),
  ].find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)

  if (explicit && (KNOWN_PROVIDER_IDS.has(explicit) || EXPLICIT_NON_PROVIDER_HINTS.has(explicit))) return explicit
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
    const messageCount = extractMessageCount(session)
    return [{
      sessionKey,
      channelHint: deriveChannelHint(session, sessionKey),
      lastActivityAt: extractLastActivityAt(session),
      ...(messageCount === undefined ? {} : { messageCount }),
    }]
  })
}

function normalizeRole(value: unknown): ConversationRole {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value
  return "assistant"
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
    const content = textFromContent(item.content).trim()
    if (!content) return []
    return [{
      role: normalizeRole(item.role),
      content,
      at: normalizeAt(item.timestamp ?? item.at ?? item.createdAt),
    }]
  })
}
