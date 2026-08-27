/**
 * INFRA-2: template shared-file pipe.
 *
 * Snapshot.files[] is birth content (path relative to each agent workspace).
 * Install copies onto Workspace.seedFiles. Generator fans into
 * workspace-{agentId}/… and unpack writes IF-ABSENT so hibernation/agent
 * writes survive redeploy.
 *
 * Community publish must never emit files[] (privacy rail v1).
 */

export interface SeedSharedFile {
  path: string
  content: string
}

const MAX_SEED_PATH = 80
const MAX_SEED_CONTENT = 8_000

const SAFE_RELATIVE_MD =
  /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/

export function isSafeSeedRelativePath(path: string): boolean {
  if (typeof path !== "string") return false
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_SEED_PATH) return false
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.startsWith("/")) {
    return false
  }
  if (trimmed.split("/").some((seg) => seg.length === 0 || seg === "." || seg === "..")) {
    return false
  }
  return SAFE_RELATIVE_MD.test(trimmed)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeEntry(raw: unknown): SeedSharedFile | null {
  if (!isRecord(raw)) return null
  if (typeof raw.path !== "string" || typeof raw.content !== "string") return null
  const path = raw.path.trim()
  if (!isSafeSeedRelativePath(path)) return null
  if (raw.content.length > MAX_SEED_CONTENT) return null
  return { path, content: raw.content }
}

/** Parse Workspace.seedFiles or snapshot.files; null/invalid → null (dual-read). */
export function parseSeedFiles(raw: unknown): SeedSharedFile[] | null {
  if (raw == null) return null
  if (typeof raw === "string") {
    try {
      return parseSeedFiles(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  if (!Array.isArray(raw)) return null
  const files: SeedSharedFile[] = []
  for (const item of raw) {
    const entry = normalizeEntry(item)
    if (entry) files.push(entry)
  }
  return files
}

export function parseSeedFilesFromTemplateSnapshot(snapshot: unknown): SeedSharedFile[] {
  let parsed: unknown = snapshot
  if (typeof snapshot === "string") {
    try {
      parsed = JSON.parse(snapshot) as unknown
    } catch {
      return []
    }
  }
  if (!isRecord(parsed)) return []
  return parseSeedFiles(parsed.files) ?? []
}

/** Clone snapshot files[] for Workspace.seedFiles at install. */
export function cloneSeedFilesForWorkspace(snapshotFiles: unknown): SeedSharedFile[] {
  return parseSeedFiles(snapshotFiles) ?? []
}

/**
 * Fan logical seed paths (VOICE.md, memory/MEMORY.md) into every agent
 * workspace directory. Isolated OpenClaw workspaces cannot share a file
 * otherwise; birth stubs are identical, then each agent writes locally.
 */
export function expandSeedFilesForAgents(
  files: SeedSharedFile[],
  agentWorkspaceDirs: string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const dir of agentWorkspaceDirs) {
    if (!/^workspace-[a-z0-9-]+$/.test(dir)) continue
    for (const file of files) {
      if (!isSafeSeedRelativePath(file.path)) continue
      out[`${dir}/${file.path}`] = file.content
    }
  }
  return out
}

export function resolveWorkspaceSeedFiles(input: {
  seedFiles?: unknown
  clawTemplateSnapshot?: unknown
}): SeedSharedFile[] {
  const fromWorkspace = parseSeedFiles(input.seedFiles)
  if (fromWorkspace && fromWorkspace.length > 0) return fromWorkspace
  return parseSeedFilesFromTemplateSnapshot(input.clawTemplateSnapshot)
}
