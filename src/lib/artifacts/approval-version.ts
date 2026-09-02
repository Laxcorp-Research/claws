export const APPROVAL_DECISION_STATES = ["NONE", "APPROVED", "REJECTED", "SUPERSEDED"] as const

export type ApprovalDecisionState = (typeof APPROVAL_DECISION_STATES)[number]

export type ApprovalVersionRow = {
  id: string
  logicalPath: string
  version: number
  createdAt: Date
  decision: ApprovalDecisionState
}

export type ApprovalVersionState = {
  decision: ApprovalDecisionState
  isLatest: boolean
  latestFileVersionId: string
  latestLabel: string
  isDecidable: boolean
}

export function versionDayLabel(createdAt: Date): string {
  return createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function computeApprovalVersionStates(
  versions: ApprovalVersionRow[],
): Map<string, ApprovalVersionState> {
  const byPath = new Map<string, ApprovalVersionRow[]>()
  for (const row of versions) {
    const list = byPath.get(row.logicalPath) ?? []
    list.push(row)
    byPath.set(row.logicalPath, list)
  }

  const out = new Map<string, ApprovalVersionState>()
  for (const list of byPath.values()) {
    const sorted = [...list].sort((a, b) => {
      if (b.version !== a.version) return b.version - a.version
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
    const latest = sorted[0]
    if (!latest) continue
    const latestLabel = versionDayLabel(latest.createdAt)
    for (const row of sorted) {
      const isLatest = row.id === latest.id
      let decision = row.decision
      if (decision === "NONE" && !isLatest) decision = "SUPERSEDED"
      out.set(row.id, {
        decision,
        isLatest,
        latestFileVersionId: latest.id,
        latestLabel,
        isDecidable: isLatest && decision === "NONE",
      })
    }
  }
  return out
}

export function respondFailureMessage(error: string, latestLabel?: string | null): string {
  if (error === "already_approved" || error === "already_responded") return "already approved"
  if (error === "already_rejected") return "already rejected"
  if (error === "superseded") {
    return latestLabel
      ? `superseded by the ${latestLabel} version - open latest`
      : "superseded by a newer version - open latest"
  }
  if (error === "pending_approval_not_found" || error === "file_version_not_found") {
    return "pending approval not found"
  }
  return error.replace(/_/g, " ")
}

export function messageFromRespondBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback
  const error = (body as { error?: { message?: unknown } }).error
  if (error && typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}
