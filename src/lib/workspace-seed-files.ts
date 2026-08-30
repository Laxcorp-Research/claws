/**
 * INFRA-2: template shared-file pipe.
 *
 * Snapshot.files[] is birth content.
 * - memory/MEMORY.md fans into every workspace-{agentId}/ (per-agent memory).
 * - coordination files unpack ONCE under shared/ (host:
 *   /home/node/.openclaw/shared/). OpenClaw -13 sandbox defaults to mode
 *   "off" and tools.fs.workspaceOnly is unset, so every agent's read/write
 *   tools can reach that sibling path.
 * Install copies onto Workspace.seedFiles. Unpack writes IF-ABSENT so
 * hibernation/agent writes survive redeploy.
 *
 * Community publish must never emit files[] (privacy rail v1).
 */

export interface SeedSharedFile {
  path: string
  content: string
}

export const SHARED_SEED_DIR = "shared"
export const SHARED_HOST_ROOT = "/home/node/.openclaw/shared"
export const PER_AGENT_MEMORY_PATH = "memory/MEMORY.md"

const MAX_SEED_PATH = 80
const MAX_SEED_CONTENT = 8_000

const SAFE_RELATIVE_MD =
  /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/

export function sharedHostPath(fileName: string): string {
  return `${SHARED_HOST_ROOT}/${fileName}`
}

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

export function isPerAgentSeedPath(seedPath: string): boolean {
  return seedPath === PER_AGENT_MEMORY_PATH || seedPath.startsWith("memory/")
}

/**
 * Map a snapshot/workspace logical path onto the unpack tree.
 * Per-agent memory stays under workspace-{id}/. Coordination files land
 * once at shared/. Legacy VOICE.md (no prefix) is rewritten to shared/VOICE.md
 * so already-installed workspaces pick up the shared-root layout on redeploy.
 */
export function toUnpackSeedPath(logicalPath: string): {
  fanOut: boolean
  unpackPath: string
} {
  if (isPerAgentSeedPath(logicalPath)) {
    return { fanOut: true, unpackPath: logicalPath }
  }
  if (logicalPath === SHARED_SEED_DIR || logicalPath.startsWith(`${SHARED_SEED_DIR}/`)) {
    return { fanOut: false, unpackPath: logicalPath }
  }
  return { fanOut: false, unpackPath: `${SHARED_SEED_DIR}/${logicalPath}` }
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
 * Expand logical seed paths into unpack keys under /home/node/.openclaw/.
 * MEMORY.md fans per workspace-* dir. Coordination files emit once at shared/.
 */
export function expandSeedFilesForAgents(
  files: SeedSharedFile[],
  agentWorkspaceDirs: string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of files) {
    if (!isSafeSeedRelativePath(file.path)) continue
    const mapped = toUnpackSeedPath(file.path)
    if (mapped.fanOut) {
      for (const dir of agentWorkspaceDirs) {
        if (!/^workspace-[a-z0-9-]+$/.test(dir)) continue
        out[`${dir}/${mapped.unpackPath}`] = file.content
      }
    } else {
      out[mapped.unpackPath] = file.content
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
