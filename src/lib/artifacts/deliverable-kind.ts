export const DELIVERABLE_EXTRACT_EVENT_KIND = "deliverable_extracted"
export const DELIVERABLE_APPROVAL_EVENT_KIND = "deliverable_approval_request"
export const DELIVERABLE_PREVIEW_CHARS = 240
export const DELIVERABLE_PATH_PREFIX = "shared/deliverables/"

export function titleFromDeliverablePath(logicalPath: string): string {
  const base = logicalPath.replace(/\\/g, "/").split("/").pop() ?? logicalPath
  return base.replace(/\.(md|txt)$/i, "")
}

/** Decision docs get Approve/Edit/Reject. Everything else is a view-only report. */
const DECISION_NAME_RE = /(cycle|draft|decision|approval|plan)/i
const REPORT_NAME_RE = /(recap|report|trends|digest|brief|log)/i

export type DeliverableKind = "decision" | "report"

export function isDecisionDeliverable(logicalPath: string): boolean {
  const normalized = logicalPath.replace(/\\/g, "/")
  if (!normalized.startsWith(DELIVERABLE_PATH_PREFIX)) return false
  const base = normalized.split("/").pop() ?? normalized
  if (REPORT_NAME_RE.test(base) && !DECISION_NAME_RE.test(base)) return false
  return DECISION_NAME_RE.test(base)
}

export function deliverableKind(logicalPath: string): DeliverableKind {
  return isDecisionDeliverable(logicalPath) ? "decision" : "report"
}

/** Sidecar next to the deliverable. No leading-dot segment (dotfiles are banned). */
export function sidecarPathFor(logicalPath: string): string {
  const normalized = logicalPath.replace(/\\/g, "/")
  return `${normalized}.status.json`
}

const TITLE_LINE = /^#\s+\S/
const SCHEMA_HEADING = /^##\s+Schema\s*$/i

/** Drop the leading title line and any ## Schema section. The card shows the first content after that. */
function withoutTitleAndSchema(content: string): string {
  const lines = content.split(/\r?\n/)
  let index = 0
  while (index < lines.length && lines[index].trim() === "") index += 1
  if (index < lines.length && TITLE_LINE.test(lines[index]) && !lines[index].startsWith("##")) {
    index += 1
  }
  const kept: string[] = []
  let inSchema = false
  for (let i = index; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (SCHEMA_HEADING.test(trimmed)) {
      inSchema = true
      continue
    }
    if (inSchema) {
      if (trimmed === "" || trimmed.startsWith("- ") || trimmed.startsWith("* ")) continue
      inSchema = false
    }
    kept.push(lines[i])
  }
  return kept.join("\n")
}

export function previewFromContent(content: string): string {
  const trimmed = withoutTitleAndSchema(content).replace(/\s+/g, " ").trim()
  if (trimmed.length <= DELIVERABLE_PREVIEW_CHARS) return trimmed
  return `${trimmed.slice(0, DELIVERABLE_PREVIEW_CHARS).trimEnd()}...`
}

export function parseDeliverableMetadata(raw: string | null | undefined): {
  eventKind: string | null
  fileVersionId: string | null
  logicalPath: string | null
  preview: string | null
  deliverableKind: DeliverableKind | null
  humanRequestId: string | null
} {
  const empty = {
    eventKind: null,
    fileVersionId: null,
    logicalPath: null,
    preview: null,
    deliverableKind: null,
    humanRequestId: null,
  }
  if (!raw) return empty
  try {
    const m = JSON.parse(raw) as Record<string, unknown>
    const kind = m.deliverableKind
    return {
      eventKind: typeof m.eventKind === "string" ? m.eventKind : null,
      fileVersionId: typeof m.fileVersionId === "string" ? m.fileVersionId : null,
      logicalPath: typeof m.logicalPath === "string" ? m.logicalPath : null,
      preview: typeof m.preview === "string" ? m.preview : null,
      deliverableKind: kind === "decision" || kind === "report" ? kind : null,
      humanRequestId: typeof m.humanRequestId === "string" ? m.humanRequestId : null,
    }
  } catch {
    return empty
  }
}
