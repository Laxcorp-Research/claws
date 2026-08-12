import type { SandboxReportV1 } from "@/lib/marketplace/sandbox-types"
import { parseSandboxReport } from "@/lib/marketplace/sandbox-grade"

/** Pinned openclaw-runtime family — never :latest / local-grade labels. */
const PINNED_RUNTIME_RE =
  /^ghcr\.io\/laxcorp-research\/openclaw-runtime:\d{4}\.\d+\.\d+(-\d+)?$/

export function isPinnedOpenclawRuntimeImage(dockerImage: string | null | undefined): boolean {
  if (!dockerImage) return false
  return PINNED_RUNTIME_RE.test(dockerImage.trim())
}

/**
 * VERIFIED mintable only for real jail executions:
 * - execution !== "simulated"
 * - dockerImage is pinned openclaw-runtime ref
 * - agentTurn.completed=true and not AGENT_SKIPPED
 */
export function isJailExecutionReport(
  report: SandboxReportV1 | null | undefined,
): boolean {
  if (!report) return false
  if (report.execution === "simulated") return false
  if (!isPinnedOpenclawRuntimeImage(report.dockerImage)) return false
  const turn = report.agentTurn
  if (!turn || turn.completed !== true) return false
  const summary = (turn.summary || "").trim()
  const excerpt = (turn.rawExcerpt || "").trim()
  if (summary === "AGENT_SKIPPED" || excerpt === "AGENT_SKIPPED") return false
  if (summary.length < 8 && excerpt.length < 8) return false
  return true
}

export function isJailExecutionReportRaw(raw: string | null | undefined): boolean {
  return isJailExecutionReport(parseSandboxReport(raw))
}

export function isSimulatedSandboxReport(raw: string | null | undefined): boolean {
  const report = parseSandboxReport(raw)
  if (!report) return false
  if (report.execution === "simulated") return true
  if (!isPinnedOpenclawRuntimeImage(report.dockerImage)) return true
  const turn = report.agentTurn
  if (!turn?.completed) return true
  if ((turn.summary || "") === "AGENT_SKIPPED") return true
  return false
}
