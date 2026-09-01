import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { parseRuntimeStateGzip } from "@/lib/openclaw/snapshot-conversations"
import { toAgentId } from "@/lib/openclaw/generator"
import {
  expandSeedFilesForAgents,
  parseSeedFiles,
} from "@/lib/workspace-seed-files"
import { writeWorkspaceSharedFile } from "@/lib/artifacts/live-write"
import { isSharedWritePath } from "@/lib/artifacts/workspace-file-allowlist"
import {
  isFilesCatalogPath,
  mergeCatalogEntries,
  type CatalogFile,
  type CatalogInput,
  type FileDetail,
} from "@/lib/artifacts/files-catalog"

export type { FileDetail, FileHistoryRow } from "@/lib/artifacts/files-catalog"

function decodeSnapshotFiles(
  gzip: Uint8Array | Buffer | null | undefined,
  asOf: Date | null | undefined,
): { inputs: CatalogInput[]; contents: Map<string, string> } {
  const inputs: CatalogInput[] = []
  const contents = new Map<string, string>()
  if (!gzip || gzip.length === 0) return { inputs, contents }
  try {
    const bundle = parseRuntimeStateGzip(Buffer.from(gzip))
    const updatedAt = asOf ? asOf.toISOString() : null
    for (const [rawPath, b64] of Object.entries(bundle.files)) {
      const logicalPath = rawPath.replace(/\\/g, "/")
      if (!isFilesCatalogPath(logicalPath) || typeof b64 !== "string") continue
      try {
        const buf = Buffer.from(b64, "base64")
        const content = buf.toString("utf8")
        contents.set(logicalPath, content)
        inputs.push({
          logicalPath,
          layer: "snapshot",
          bytes: buf.length,
          updatedAt,
        })
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch (err) {
    log.warn("files catalog: snapshot unreadable", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { inputs, contents }
}

export async function loadWorkspaceFileCatalog(workspaceId: string): Promise<{
  files: CatalogFile[]
  snapshotAsOf: string | null
}> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      seedFiles: true,
      agents: { select: { name: true } },
      containerState: {
        select: { runtimeStateSnapshot: true, runtimeStateUpdatedAt: true },
      },
    },
  })
  if (!workspace) return { files: [], snapshotAsOf: null }

  const snapshotAsOf = workspace.containerState?.runtimeStateUpdatedAt?.toISOString() ?? null
  const snapshot = decodeSnapshotFiles(
    workspace.containerState?.runtimeStateSnapshot,
    workspace.containerState?.runtimeStateUpdatedAt,
  )

  const agentDirs = workspace.agents.map((a) => `workspace-${toAgentId(a.name)}`)
  const expanded = expandSeedFilesForAgents(parseSeedFiles(workspace.seedFiles) ?? [], agentDirs)
  const seedInputs: CatalogInput[] = []
  for (const [logicalPath, content] of Object.entries(expanded)) {
    if (!isFilesCatalogPath(logicalPath)) continue
    seedInputs.push({
      logicalPath,
      layer: "seed",
      bytes: Buffer.byteLength(content, "utf8"),
      updatedAt: null,
    })
  }

  const versions = await prisma.fileVersion.findMany({
    where: { workspaceId },
    orderBy: [{ logicalPath: "asc" }, { version: "desc" }],
    select: {
      id: true,
      logicalPath: true,
      version: true,
      content: true,
      createdAt: true,
      createdBy: true,
    },
  })
  const seen = new Set<string>()
  const versionInputs: CatalogInput[] = []
  for (const row of versions) {
    if (seen.has(row.logicalPath)) continue
    if (!isFilesCatalogPath(row.logicalPath)) continue
    seen.add(row.logicalPath)
    versionInputs.push({
      logicalPath: row.logicalPath,
      layer: "versioned",
      bytes: Buffer.byteLength(row.content, "utf8"),
      updatedAt: row.createdAt.toISOString(),
      latestVersion: row.version,
      latestFileVersionId: row.id,
      createdBy: row.createdBy,
    })
  }

  return {
    files: mergeCatalogEntries([...seedInputs, ...snapshot.inputs, ...versionInputs]),
    snapshotAsOf,
  }
}

export async function loadWorkspaceFileDetail(
  workspaceId: string,
  logicalPath: string,
): Promise<FileDetail | { error: string; status: number }> {
  const normalized = logicalPath.replace(/\\/g, "/")
  if (!isFilesCatalogPath(normalized)) {
    return { error: "path_not_allowed", status: 403 }
  }

  const historyRows = await prisma.fileVersion.findMany({
    where: { workspaceId, logicalPath: normalized },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      trigger: true,
      createdAt: true,
      createdBy: true,
      decision: true,
      content: true,
    },
  })

  if (historyRows.length > 0) {
    const latest = historyRows[0]!
    return {
      logicalPath: normalized,
      content: latest.content,
      bytes: Buffer.byteLength(latest.content, "utf8"),
      source: "versioned",
      owner: isSharedWritePath(normalized) ? "human" : "agent",
      editable: isSharedWritePath(normalized),
      latestVersion: latest.version,
      latestFileVersionId: latest.id,
      history: historyRows.map((row) => ({
        id: row.id,
        version: row.version,
        trigger: row.trigger,
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdBy,
        decision: row.decision,
      })),
    }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      seedFiles: true,
      agents: { select: { name: true } },
      containerState: {
        select: { runtimeStateSnapshot: true, runtimeStateUpdatedAt: true },
      },
    },
  })
  if (!workspace) return { error: "workspace_not_found", status: 404 }

  const snapshot = decodeSnapshotFiles(
    workspace.containerState?.runtimeStateSnapshot,
    workspace.containerState?.runtimeStateUpdatedAt,
  )
  const snapshotContent = snapshot.contents.get(normalized)
  if (typeof snapshotContent === "string") {
    return {
      logicalPath: normalized,
      content: snapshotContent,
      bytes: Buffer.byteLength(snapshotContent, "utf8"),
      source: "snapshot",
      owner: isSharedWritePath(normalized) ? "human" : "agent",
      editable: isSharedWritePath(normalized),
      latestVersion: null,
      latestFileVersionId: null,
      history: [],
    }
  }

  const agentDirs = workspace.agents.map((a) => `workspace-${toAgentId(a.name)}`)
  const expanded = expandSeedFilesForAgents(parseSeedFiles(workspace.seedFiles) ?? [], agentDirs)
  const seedContent = expanded[normalized]
  if (typeof seedContent === "string") {
    return {
      logicalPath: normalized,
      content: seedContent,
      bytes: Buffer.byteLength(seedContent, "utf8"),
      source: "seed",
      owner: isSharedWritePath(normalized) ? "human" : "agent",
      editable: isSharedWritePath(normalized),
      latestVersion: null,
      latestFileVersionId: null,
      history: [],
    }
  }

  return { error: "file_not_found", status: 404 }
}

export async function restoreWorkspaceFileVersion(args: {
  workspaceId: string
  fileVersionId: string
  restoredBy: string
}) {
  const row = await prisma.fileVersion.findFirst({
    where: { id: args.fileVersionId, workspaceId: args.workspaceId },
  })
  if (!row) return { ok: false as const, error: "file_version_not_found", status: 404 }
  if (!isSharedWritePath(row.logicalPath)) {
    return { ok: false as const, error: "path_not_allowed", status: 403 }
  }
  return writeWorkspaceSharedFile({
    workspaceId: args.workspaceId,
    logicalPath: row.logicalPath,
    content: row.content,
    createdBy: args.restoredBy,
    trigger: "RESTORE",
  })
}
