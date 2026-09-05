import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { writeWorkspaceSharedFile } from "@/lib/artifacts/live-write"
import { sidecarPathFor } from "@/lib/artifacts/deliverable-kind"
import type { FileVersionDecision } from "@/generated/prisma/client"

export type AppliedDecision = {
  fileVersionId: string
  decision: FileVersionDecision
  sidecarPath: string
  liveWriteOk: boolean
  logicalPath: string
  version: number
}

export async function applyFileVersionDecision(args: {
  workspaceId: string
  fileVersionId: string
  decision: Extract<FileVersionDecision, "APPROVED" | "REJECTED">
  reason: string | null
  decidedBy: string
}): Promise<AppliedDecision | { error: string; status: number }> {
  const row = await prisma.fileVersion.findFirst({
    where: { id: args.fileVersionId, workspaceId: args.workspaceId },
  })
  if (!row) return { error: "file_version_not_found", status: 404 }
  if (row.decision === "APPROVED") return { error: "already_approved", status: 409 }
  if (row.decision === "REJECTED") return { error: "already_rejected", status: 409 }
  if (row.decision === "SUPERSEDED") return { error: "superseded", status: 409 }
  if (row.decision !== "NONE") return { error: "already_responded", status: 409 }

  const updated = await prisma.fileVersion.update({
    where: { id: row.id },
    data: {
      decision: args.decision,
      decisionReason: args.reason,
    },
  })

  const sidecarPath = sidecarPathFor(row.logicalPath)
  const sidecar = JSON.stringify(
    {
      logicalPath: row.logicalPath,
      fileVersionId: row.id,
      decision: args.decision,
      reason: args.reason,
      decidedAt: new Date().toISOString(),
      decidedBy: args.decidedBy,
    },
    null,
    2,
  )

  const written = await writeWorkspaceSharedFile({
    workspaceId: args.workspaceId,
    logicalPath: sidecarPath,
    content: sidecar,
    createdBy: args.decidedBy,
    trigger: "EDIT",
  })

  if (!written.ok) {
    log.warn("deliverable decision: sidecar live-write failed", {
      workspaceId: args.workspaceId,
      fileVersionId: row.id,
      sidecarPath,
      error: written.error,
    })
  }

  return {
    fileVersionId: updated.id,
    decision: args.decision,
    sidecarPath,
    liveWriteOk: written.ok,
    logicalPath: row.logicalPath,
    version: row.version,
  }
}
