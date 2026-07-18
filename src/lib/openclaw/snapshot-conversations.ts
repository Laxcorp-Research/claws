import { gunzipSync, gzipSync } from "node:zlib"
import {
  deriveChannelHint,
  isHumanFacingSessionKey,
  normalizeConversationMessages,
  type ConversationMessage,
  type ConversationSummary,
} from "@/lib/openclaw/conversations"

/** Uncompressed bundle totalSize above this → honest too_large (do not serve). */
export const SNAPSHOT_UNCOMPRESSED_CEILING_BYTES = 100 * 1024 * 1024

export type ArchivedReason = "rotated-main" | "deleted" | "reset" | "not-in-index"

export interface ArchivedSessionSummary {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount: number
  reason: ArchivedReason
}

export interface SnapshotConversationsView {
  asOf: string
  conversations: ConversationSummary[]
  archived: ArchivedSessionSummary[]
}

type SessionFileIndex = {
  /** sessionKey → uuid (no .jsonl) */
  keyToUuid: Map<string, string>
  /** uuid → sessionKey (first wins) */
  uuidToKey: Map<string, string>
  /** uuid → decoded jsonl text for plain *.jsonl (active or orphan) */
  uuidJsonl: Map<string, string>
  /** archived artifacts keyed by stable sessionKey */
  archived: Map<string, { reason: ArchivedReason; jsonl: string; channelHint: string }>
}

type CacheEntry = {
  view: SnapshotConversationsView
  files: SessionFileIndex
}

const cache = new Map<string, CacheEntry>()

export function snapshotConversationsCacheKey(
  workspaceId: string,
  runtimeStateUpdatedAt: Date,
): string {
  // INVARIANT: must include both workspaceId AND runtimeStateUpdatedAt
  // (mutation: keying on workspaceId alone → stale-serve).
  return `${workspaceId}::${runtimeStateUpdatedAt.toISOString()}`
}

export function __clearSnapshotConversationsCacheForTests(): void {
  cache.clear()
}

/**
 * SECURITY: only agents/<agentId>/sessions/<file> — never arbitrary snapshot paths.
 * Rejects .., empty segments, absolute paths, and nested escapes.
 */
export function isAllowedSessionPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const normalized = relativePath.replace(/\\/g, "/")
  if (normalized.startsWith("/") || normalized.includes("://")) return false
  const parts = normalized.split("/")
  if (parts.some((p) => p === ".." || p === "." || p === "")) return false
  if (parts.length !== 4) return false
  if (parts[0] !== "agents" || parts[2] !== "sessions") return false
  if (parts[1].length === 0 || parts[3].length === 0) return false
  return true
}

export function readAllowedSessionFile(
  files: Record<string, string>,
  relativePath: string,
): string | null {
  if (!isAllowedSessionPath(relativePath)) return null
  const normalized = relativePath.replace(/\\/g, "/")
  const b64 = files[normalized]
  if (typeof b64 !== "string") return null
  try {
    return Buffer.from(b64, "base64").toString("utf8")
  } catch {
    return null
  }
}

type RuntimeBundle = {
  files: Record<string, string>
  totalSize: number
}

function parseBundleJson(raw: string): RuntimeBundle {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_bundle_shape")
  }
  const record = parsed as Record<string, unknown>
  if (!record.files || typeof record.files !== "object" || Array.isArray(record.files)) {
    throw new Error("invalid_bundle_files")
  }
  const files = record.files as Record<string, string>
  const totalSize =
    typeof record.totalSize === "number" && Number.isFinite(record.totalSize)
      ? record.totalSize
      : Object.values(files).reduce((sum, b64) => {
          if (typeof b64 !== "string") return sum
          try {
            return sum + Buffer.from(b64, "base64").length
          } catch {
            return sum
          }
        }, 0)
  return { files, totalSize }
}

const UUID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
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

function summarizeJsonl(text: string): { messageCount: number; lastActivityAt: string | null } {
  let messageCount = 0
  let lastActivityAt: string | null = null
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const row: unknown = JSON.parse(line)
      messageCount += 1
      const record = asRecord(row)
      const nested = asRecord(record?.message)
      const at =
        normalizeAt(record?.timestamp) ??
        normalizeAt(record?.at) ??
        normalizeAt(record?.createdAt) ??
        normalizeAt(nested?.timestamp) ??
        normalizeAt(nested?.at)
      if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at
    } catch {
      // skip corrupt lines
    }
  }
  return { messageCount, lastActivityAt }
}

function linesToMessages(text: string): ConversationMessage[] {
  const rows: unknown[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const row: unknown = JSON.parse(line)
      const record = asRecord(row)
      const nested = asRecord(record?.message)
      rows.push(nested ?? row)
    } catch {
      // skip
    }
  }
  return normalizeConversationMessages({ messages: rows })
}

function parseSessionsIndex(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return out
  }
  const record = asRecord(parsed)
  if (!record) return out
  for (const [sessionKey, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim()) {
      out.set(sessionKey, value.replace(/\.jsonl$/i, ""))
      continue
    }
    const obj = asRecord(value)
    if (!obj) continue
    for (const key of ["sessionId", "sessionFile", "id"] as const) {
      const val = obj[key]
      if (typeof val === "string" && val.trim()) {
        out.set(sessionKey, val.replace(/\.jsonl$/i, ""))
        break
      }
    }
  }
  return out
}

function classifyArchivedFileName(
  fileName: string,
  indexedUuids: Set<string>,
  hasMainKey: boolean,
): { uuid: string; reason: ArchivedReason } | null {
  if (fileName === "sessions.json" || fileName.includes("trajectory")) return null

  if (fileName.includes(".jsonl.deleted.")) {
    const m = fileName.match(UUID_RE)
    return m ? { uuid: m[1].toLowerCase(), reason: "deleted" } : null
  }
  if (fileName.includes(".jsonl.reset.")) {
    const m = fileName.match(UUID_RE)
    return m ? { uuid: m[1].toLowerCase(), reason: "reset" } : null
  }
  if (!fileName.endsWith(".jsonl")) return null

  const m = fileName.match(UUID_RE)
  if (!m) return null
  const uuid = m[1].toLowerCase()
  if (indexedUuids.has(uuid)) return null
  // E class: plain uuid.jsonl not in sessions.json while a :main key exists → rotated-main
  if (hasMainKey) return { uuid, reason: "rotated-main" }
  return { uuid, reason: "not-in-index" }
}

function orphanSessionKey(uuid: string): string {
  return `orphaned:${uuid}`
}

function buildSessionFileIndex(files: Record<string, string>): SessionFileIndex {
  const keyToUuid = new Map<string, string>()
  const uuidToKey = new Map<string, string>()
  const uuidJsonl = new Map<string, string>()
  const archived = new Map<
    string,
    { reason: ArchivedReason; jsonl: string; channelHint: string }
  >()

  // Collect per-agent index + files under allowlisted paths only.
  const byAgent = new Map<string, { indexRaw: string | null; artifacts: Map<string, string> }>()

  for (const path of Object.keys(files)) {
    if (!isAllowedSessionPath(path)) continue
    const parts = path.replace(/\\/g, "/").split("/")
    const agentId = parts[1]
    const fileName = parts[3]
    let bucket = byAgent.get(agentId)
    if (!bucket) {
      bucket = { indexRaw: null, artifacts: new Map() }
      byAgent.set(agentId, bucket)
    }
    const content = readAllowedSessionFile(files, path)
    if (content === null) continue
    if (fileName === "sessions.json") {
      bucket.indexRaw = content
    } else {
      bucket.artifacts.set(fileName, content)
    }
  }

  for (const [agentId, bucket] of byAgent) {
    const index = bucket.indexRaw ? parseSessionsIndex(bucket.indexRaw) : new Map<string, string>()
    const indexedUuids = new Set<string>()
    let hasMainKey = false

    for (const [sessionKey, uuid] of index) {
      const normalizedUuid = uuid.toLowerCase()
      indexedUuids.add(normalizedUuid)
      keyToUuid.set(sessionKey, normalizedUuid)
      if (!uuidToKey.has(normalizedUuid)) uuidToKey.set(normalizedUuid, sessionKey)
      if (sessionKey.endsWith(":main") || (sessionKey.split(":").length === 3 && sessionKey.split(":")[2] === "main")) {
        hasMainKey = true
      }
    }

    for (const [fileName, content] of bucket.artifacts) {
      const archivedMeta = classifyArchivedFileName(fileName, indexedUuids, hasMainKey)
      if (archivedMeta) {
        const sessionKey = orphanSessionKey(archivedMeta.uuid)
        // Prefer more specific reasons if the same uuid appears twice (deleted > reset > rotated)
        const existing = archived.get(sessionKey)
        const rank = (r: ArchivedReason) =>
          r === "deleted" ? 3 : r === "reset" ? 2 : r === "rotated-main" ? 1 : 0
        if (!existing || rank(archivedMeta.reason) >= rank(existing.reason)) {
          const channelHint = deriveChannelHint(null, `agent:${agentId}:main`)
          archived.set(sessionKey, {
            reason: archivedMeta.reason,
            jsonl: content,
            channelHint,
          })
        }
        continue
      }

      if (fileName.endsWith(".jsonl") && !fileName.includes(".jsonl.")) {
        const m = fileName.match(UUID_RE)
        if (m) uuidJsonl.set(m[1].toLowerCase(), content)
      }
    }
  }

  return { keyToUuid, uuidToKey, uuidJsonl, archived }
}

function viewFromIndex(asOf: string, index: SessionFileIndex): SnapshotConversationsView {
  const conversations: ConversationSummary[] = []

  for (const [sessionKey, uuid] of index.keyToUuid) {
    if (!isHumanFacingSessionKey(sessionKey)) continue
    const jsonl = index.uuidJsonl.get(uuid) ?? ""
    const { messageCount, lastActivityAt } = summarizeJsonl(jsonl)
    conversations.push({
      sessionKey,
      channelHint: deriveChannelHint(null, sessionKey),
      lastActivityAt,
      messageCount,
    })
  }

  conversations.sort((a, b) => {
    const at = (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? "")
    return at !== 0 ? -at : a.sessionKey.localeCompare(b.sessionKey)
  })

  const archived: ArchivedSessionSummary[] = []
  for (const [sessionKey, meta] of index.archived) {
    const { messageCount, lastActivityAt } = summarizeJsonl(meta.jsonl)
    archived.push({
      sessionKey,
      channelHint: meta.channelHint,
      lastActivityAt,
      messageCount,
      reason: meta.reason,
    })
  }
  archived.sort((a, b) => {
    const at = (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? "")
    return at !== 0 ? -at : a.sessionKey.localeCompare(b.sessionKey)
  })

  return { asOf, conversations, archived }
}

export type LoadSnapshotResult =
  | { ok: true; view: SnapshotConversationsView; files: SessionFileIndex }
  | { ok: false; reason: "no_snapshot" }
  | { ok: false; reason: "too_large"; asOf: string; totalSize: number }
  | { ok: false; reason: "corrupt"; asOf: string | null }

export function loadSnapshotConversationsFromGzip(args: {
  workspaceId: string
  gzipBytes: Buffer
  runtimeStateUpdatedAt: Date
  /** DB-reported uncompressed size; checked before inflate when present. */
  runtimeStateSizeBytes?: number | null
}): LoadSnapshotResult {
  const asOf = args.runtimeStateUpdatedAt.toISOString()
  const key = snapshotConversationsCacheKey(args.workspaceId, args.runtimeStateUpdatedAt)
  const hit = cache.get(key)
  if (hit) return { ok: true, view: hit.view, files: hit.files }

  if (
    typeof args.runtimeStateSizeBytes === "number" &&
    args.runtimeStateSizeBytes > SNAPSHOT_UNCOMPRESSED_CEILING_BYTES
  ) {
    return {
      ok: false,
      reason: "too_large",
      asOf,
      totalSize: args.runtimeStateSizeBytes,
    }
  }

  let bundle: RuntimeBundle
  try {
    const raw = gunzipSync(args.gzipBytes).toString("utf8")
    bundle = parseBundleJson(raw)
  } catch {
    return { ok: false, reason: "corrupt", asOf }
  }

  if (bundle.totalSize > SNAPSHOT_UNCOMPRESSED_CEILING_BYTES) {
    return { ok: false, reason: "too_large", asOf, totalSize: bundle.totalSize }
  }

  const files = buildSessionFileIndex(bundle.files)
  const view = viewFromIndex(asOf, files)
  cache.set(key, { view, files })
  return { ok: true, view, files }
}

export function readSnapshotSessionMessages(
  files: SessionFileIndex,
  sessionKey: string,
): ConversationMessage[] | null {
  const uuid = files.keyToUuid.get(sessionKey)
  if (uuid) {
    const jsonl = files.uuidJsonl.get(uuid)
    if (jsonl === undefined) return []
    return linesToMessages(jsonl)
  }
  const archived = files.archived.get(sessionKey)
  if (archived) return linesToMessages(archived.jsonl)
  return null
}

/** Build a gzip runtime-state snapshot fixture (tests / local). */
export function buildRuntimeStateGzipFixture(
  fileContents: Record<string, string>,
  totalSizeOverride?: number,
): Buffer {
  const files: Record<string, string> = {}
  let totalSize = 0
  for (const [path, content] of Object.entries(fileContents)) {
    const buf = Buffer.from(content, "utf8")
    totalSize += buf.length
    files[path] = buf.toString("base64")
  }
  return gzipSync(JSON.stringify({ files, totalSize: totalSizeOverride ?? totalSize }))
}
