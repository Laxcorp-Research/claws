/**
 * Files tab catalog. Read: shared/** + per-agent memory.
 * Write/restore: shared/** only (same allowlist as live-write).
 * Agent memory is read-only in v1.
 */
import { isSharedWritePath } from "@/lib/artifacts/workspace-file-allowlist"

export type CatalogOwner = "human" | "agent"
export type CatalogLayer = "versioned" | "snapshot" | "seed"

const MEMORY_EXT = new Set([".md", ".txt"])
const BANNED_SEGMENTS = new Set(["openclaw.json", ".env", "cron"])

export type CatalogFile = {
  logicalPath: string
  owner: CatalogOwner
  editable: boolean
  source: CatalogLayer
  bytes: number
  updatedAt: string | null
  latestVersion: number | null
  latestFileVersionId: string | null
  createdBy: string | null
}

export type CatalogInput = {
  logicalPath: string
  layer: CatalogLayer
  bytes: number
  updatedAt: string | null
  latestVersion?: number | null
  latestFileVersionId?: string | null
  createdBy?: string | null
}

export type FileHistoryRow = {
  id: string
  version: number
  trigger: string
  createdAt: string
  createdBy: string
  decision: string
}

export type FileDetail = {
  logicalPath: string
  content: string
  bytes: number
  source: CatalogLayer
  owner: CatalogOwner
  editable: boolean
  latestVersion: number | null
  latestFileVersionId: string | null
  history: FileHistoryRow[]
}

const LAYER_RANK: Record<CatalogLayer, number> = {
  versioned: 3,
  snapshot: 2,
  seed: 1,
}

function normalizePath(relativePath: string): string | null {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null
  if (relativePath.includes("\0")) return null
  const normalized = relativePath.replace(/\\/g, "/")
  if (normalized.startsWith("/") || normalized.includes("://")) return null
  const parts = normalized.split("/")
  if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
    return null
  }
  if (
    parts.some(
      (p) => BANNED_SEGMENTS.has(p.toLowerCase()) || p.toLowerCase().startsWith(".env"),
    )
  ) {
    return null
  }
  return normalized
}

/** workspace-{agent}/memory/<file>.md|.txt - never SOUL/USER or agents/* trees. */
export function isAgentMemoryPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath)
  if (!normalized) return false
  const parts = normalized.split("/")
  if (parts.length !== 3) return false
  if (!/^workspace-[a-z0-9][a-z0-9-]*$/.test(parts[0] ?? "")) return false
  if (parts[1] !== "memory") return false
  const base = parts[2] ?? ""
  const dot = base.lastIndexOf(".")
  if (dot < 1) return false
  return MEMORY_EXT.has(base.slice(dot).toLowerCase())
}

export function isFilesCatalogPath(relativePath: string): boolean {
  return isSharedWritePath(relativePath) || isAgentMemoryPath(relativePath)
}

export function catalogOwner(relativePath: string): CatalogOwner | null {
  if (isSharedWritePath(relativePath)) return "human"
  if (isAgentMemoryPath(relativePath)) return "agent"
  return null
}

export function mergeCatalogEntries(inputs: CatalogInput[]): CatalogFile[] {
  const map = new Map<string, CatalogFile>()
  for (const row of inputs) {
    const owner = catalogOwner(row.logicalPath)
    if (!owner) continue
    const logicalPath = row.logicalPath.replace(/\\/g, "/")
    const next: CatalogFile = {
      logicalPath,
      owner,
      editable: owner === "human",
      source: row.layer,
      bytes: row.bytes,
      updatedAt: row.updatedAt,
      latestVersion: row.latestVersion ?? null,
      latestFileVersionId: row.latestFileVersionId ?? null,
      createdBy: row.createdBy ?? null,
    }
    const prev = map.get(logicalPath)
    if (!prev || LAYER_RANK[row.layer] > LAYER_RANK[prev.source]) {
      map.set(logicalPath, next)
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.owner !== b.owner) return a.owner === "human" ? -1 : 1
    return a.logicalPath.localeCompare(b.logicalPath)
  })
}

export function agentLabelFromMemoryPath(logicalPath: string): string {
  const dir = logicalPath.replace(/\\/g, "/").split("/")[0] ?? logicalPath
  return dir.replace(/^workspace-/, "")
}
