import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { parseRuntimeStateGzip } from "@/lib/openclaw/snapshot-conversations"
import type { FileVersionTrigger } from "@/generated/prisma/client"
import {
  DELIVERABLE_EXTRACT_EVENT_KIND,
  DELIVERABLE_PATH_PREFIX,
  deliverableKind,
  isDecisionDeliverable,
  previewFromContent,
  titleFromDeliverablePath,
} from "@/lib/artifacts/deliverable-kind"
import { createDeliverableApprovalFromFileVersion } from "@/lib/openclaw/pending-approval"
import { notifyDeliverableExtracted } from "@/lib/artifacts/deliverable-notice"
import { supersedeOlderPendingVersions } from "@/lib/artifacts/supersede-versions"

export {
  DELIVERABLE_EXTRACT_EVENT_KIND,
  DELIVERABLE_PATH_PREFIX,
  titleFromDeliverablePath,
} from "@/lib/artifacts/deliverable-kind"
export const WORKING_FILE_EXTRACT_EVENT_KIND = "working_file_extracted"
export const DELIVERABLE_MAX_BYTES = 256 * 1024
export const DELIVERABLE_TEXT_EXT = new Set([".md", ".txt"])

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/**
 * Agent writes often land under workspace-<slug>/shared/...
 * Canonicalize to platform shared/... before the allowlist.
 */
const WORKSPACE_SHARED_RE = /(?:^|\/)workspace-[^/]+\/(shared\/.+)$/

/** Agent-maintained working files (history in Files tab). Not approval cards. */
export const WORKING_SHARED_EXTRACT_FILES = new Set([
  "shared/PIPELINE.md",
  "shared/CLIENTS.md",
  "shared/PROPOSALS.md",
  "shared/PORTFOLIO.md",
  "shared/WATCHLIST.md",
  "shared/THESES.md",
])

export function canonicalizeDeliverableExtractPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/")
  const match = normalized.match(WORKSPACE_SHARED_RE)
  return match?.[1] ?? normalized
}

export function isWorkingSharedExtractPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const canonical = canonicalizeDeliverableExtractPath(relativePath)
  if (canonical.startsWith("/") || canonical.includes("://")) return false
  return WORKING_SHARED_EXTRACT_FILES.has(canonical)
}

/**
 * Allowlist for card-source extract. shared/deliverables/* text only.
 * Never dotfiles, never .., never host-absolute, never openclaw.json/.env/cron.
 * workspace-<slug>/shared/deliverables is accepted via canonicalize.
 */
export function isDeliverableExtractPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false
  if (relativePath.includes("\0")) return false
  const canonical = canonicalizeDeliverableExtractPath(relativePath)
  if (canonical.startsWith("/") || canonical.includes("://")) return false
  const parts = canonical.split("/")
  if (parts.some((p) => p === ".." || p === "." || p === "" || p.startsWith("."))) {
    return false
  }
  if (!canonical.startsWith(DELIVERABLE_PATH_PREFIX)) return false
  if (canonical === DELIVERABLE_PATH_PREFIX.slice(0, -1)) return false
  const base = parts[parts.length - 1] ?? ""
  const dot = base.lastIndexOf(".")
  if (dot < 1) return false
  const ext = base.slice(dot).toLowerCase()
  return DELIVERABLE_TEXT_EXT.has(ext)
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
    const logicalPath = canonicalizeDeliverableExtractPath(rawPath)
    const isDeliverable = isDeliverableExtractPath(logicalPath)
    const isWorking = isWorkingSharedExtractPath(logicalPath)
    if (!isDeliverable && !isWorking) {
      if (
        logicalPath.startsWith(DELIVERABLE_PATH_PREFIX) ||
        /(?:^|\/)workspace-[^/]+\/shared\/deliverables\//.test(rawPath.replace(/\\/g, "/")) ||
        WORKING_SHARED_EXTRACT_FILES.has(logicalPath)
      ) {
        summary.skippedInvalid += 1
      }
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

    if (trigger === "MISSION" && isDeliverable) {
      try {
        await supersedeOlderPendingVersions({
          workspaceId: args.workspaceId,
          logicalPath,
          keepFileVersionId: created.id,
        })
      } catch (err) {
        log.warn("deliverable extract: supersede older versions failed (continuing)", {
          workspaceId: args.workspaceId,
          logicalPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const title = titleFromDeliverablePath(logicalPath)
    let humanRequestId: string | null = null
    if (trigger === "MISSION" && isDeliverable && isDecisionDeliverable(logicalPath)) {
      try {
        const approval = await createDeliverableApprovalFromFileVersion({
          workspaceId: args.workspaceId,
          fileVersionId: created.id,
          logicalPath,
          title,
        })
        humanRequestId = approval.id ?? null
      } catch (err) {
        log.warn("deliverable extract: approval row failed (continuing)", {
          workspaceId: args.workspaceId,
          logicalPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const preview = previewFromContent(content)
    const eventKind = isWorking ? WORKING_FILE_EXTRACT_EVENT_KIND : DELIVERABLE_EXTRACT_EVENT_KIND
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: isWorking
          ? `Working file extracted: ${title}`
          : `Deliverable extracted: ${title}`,
        actionType: "SYSTEM",
        detail: logicalPath,
        metadata: JSON.stringify({
          eventKind,
          fileVersionId: created.id,
          logicalPath,
          version: nextVersion,
          contentHash,
          trigger,
          preview,
          deliverableKind: isDeliverable ? deliverableKind(logicalPath) : null,
          humanRequestId,
        }),
      },
    })
    if (trigger === "MISSION" && isDeliverable) {
      void notifyDeliverableExtracted({
        workspaceId: args.workspaceId,
        title,
        logicalPath,
        fileVersionId: created.id,
        preview,
        isDecision: isDecisionDeliverable(logicalPath),
      }).catch((err) => {
        log.warn("deliverable extract: channel notice failed (continuing)", {
          workspaceId: args.workspaceId,
          logicalPath,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    summary.extracted += 1
  }

  return summary
}
