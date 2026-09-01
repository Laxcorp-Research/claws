import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { parseRuntimeStateGzip } from "@/lib/openclaw/snapshot-conversations"
import type { FileVersionTrigger } from "@/generated/prisma/client"

export const DELIVERABLE_EXTRACT_EVENT_KIND = "deliverable_extracted"
export const DELIVERABLE_PATH_PREFIX = "shared/deliverables/"
export const DELIVERABLE_MAX_BYTES = 256 * 1024
export const DELIVERABLE_TEXT_EXT = new Set([".md", ".txt"])

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/**
 * Allowlist for card-source extract. shared/deliverables/* text only.
 * Never dotfiles, never .., never host-absolute, never openclaw.json/.env/cron.
 */
export function isDeliverableExtractPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const normalized = relativePath.replace(/\\/g, "/")
  if (normalized.startsWith("/") || normalized.includes("://")) return false
  const parts = normalized.split("/")
  if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
    return false
  }
  if (!normalized.startsWith(DELIVERABLE_PATH_PREFIX)) return false
  if (normalized === DELIVERABLE_PATH_PREFIX.slice(0, -1)) return false
  const base = parts[parts.length - 1] ?? ""
  const dot = base.lastIndexOf(".")
  if (dot < 1) return false
  const ext = base.slice(dot).toLowerCase()
  return DELIVERABLE_TEXT_EXT.has(ext)
}

export function titleFromDeliverablePath(logicalPath: string): string {
  const base = logicalPath.replace(/\\/g, "/").split("/").pop() ?? logicalPath
  return base.replace(/\.(md|txt)$/i, "")
}

type SeedFile = { path?: unknown; content?: unknown }

function seedContentForPath(seedFiles: unknown, logicalPath: string): string | null {
  if (!Array.isArray(seedFiles)) return null
  for (const raw of seedFiles as SeedFile[]) {
    if (!raw || typeof raw !== "object") continue
    if (typeof raw.path !== "string" || typeof raw.content !== "string") continue
    if (raw.path.replace(/\\/g, "/") === logicalPath) return raw.content
  }
  return null
}

export type ExtractDeliverableResult = {
  extracted: number
  skippedUnchanged: number
  skippedInvalid: number
}

export async function extractDeliverablesFromGzip(args: {
  workspaceId: string
  gzip: Buffer
  runId?: string | null
}): Promise<ExtractDeliverableResult> {
  const summary: ExtractDeliverableResult = {
    extracted: 0,
    skippedUnchanged: 0,
    skippedInvalid: 0,
  }

  let files: Record<string, string>
  try {
    files = parseRuntimeStateGzip(args.gzip).files
  } catch (err) {
    log.warn("deliverable extract: invalid gzip bundle", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return summary
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { seedFiles: true },
  })

  for (const [rawPath, b64] of Object.entries(files)) {
    const logicalPath = rawPath.replace(/\\/g, "/")
    if (!isDeliverableExtractPath(logicalPath)) {
      if (logicalPath.startsWith(DELIVERABLE_PATH_PREFIX)) summary.skippedInvalid += 1
      continue
    }
    if (typeof b64 !== "string") {
      summary.skippedInvalid += 1
      continue
    }

    let content: string
    try {
      const buf = Buffer.from(b64, "base64")
      if (buf.length > DELIVERABLE_MAX_BYTES) {
        summary.skippedInvalid += 1
        continue
      }
      content = buf.toString("utf8")
    } catch {
      summary.skippedInvalid += 1
      continue
    }

    const contentHash = hashFileContent(content)
    const latest = await prisma.fileVersion.findFirst({
      where: { workspaceId: args.workspaceId, logicalPath },
      orderBy: { version: "desc" },
      select: { version: true, contentHash: true },
    })
    if (latest && latest.contentHash === contentHash) {
      summary.skippedUnchanged += 1
      continue
    }

    const nextVersion = (latest?.version ?? 0) + 1
    const seedContent = seedContentForPath(workspace?.seedFiles, logicalPath)
    const trigger: FileVersionTrigger =
      !latest && seedContent !== null && hashFileContent(seedContent) === contentHash
        ? "SEED"
        : "MISSION"

    const created = await prisma.fileVersion.create({
      data: {
        workspaceId: args.workspaceId,
        logicalPath,
        version: nextVersion,
        content,
        contentHash,
        createdBy: "system",
        trigger,
        runId: args.runId ?? null,
        decision: "NONE",
      },
    })

    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: `Deliverable extracted: ${titleFromDeliverablePath(logicalPath)}`,
        actionType: "SYSTEM",
        detail: logicalPath,
        metadata: JSON.stringify({
          eventKind: DELIVERABLE_EXTRACT_EVENT_KIND,
          fileVersionId: created.id,
          logicalPath,
          version: nextVersion,
          contentHash,
          trigger,
        }),
      },
    })
    summary.extracted += 1
  }

  return summary
}
