/**
 * UNIVERSAL WORKFLOW LANGUAGE - mechanical sentences only.
 *
 * HARD RULE: generated text references ONLY agent display names, optional
 * contextNote text, quality threshold number, revision-round count, and
 * delivery mode. No vertical-specific nouns (see domain-noun grep test).
 *
 * Domain-noun grep test over this module: inject a banned noun → fails.
 *
 * WIRE-FULL X1: solid ORCH→WORKER edges are unconditional delegation.
 * Critic-gate / revision / approval language lives ONLY in the law section.
 */

export const WORKFLOW_FENCE_BEGIN = "<!-- claws:workflow:begin -->"
export const WORKFLOW_FENCE_END = "<!-- claws:workflow:end -->"

export const CONTEXT_NOTE_MAX_CHARS = 140

export type WorkflowDeliveryMode = "APPROVAL_REQUIRED" | "AUTO_PROCEED"

export type WorkflowEdgeInput = {
  workerDisplayName: string
  /** Optional ≤140 chars; woven into that edge's sentence when present. */
  contextNote?: string | null
}

export type WorkflowLawKnobs = {
  orchestratorDisplayName: string
  criticDisplayName: string
  qualityThreshold: number
  maxRevisionRounds: number
  deliveryMode: WorkflowDeliveryMode
}

/** Clamp / sanitize contextNote for emission. */
export function normalizeContextNote(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > CONTEXT_NOTE_MAX_CHARS
    ? trimmed.slice(0, CONTEXT_NOTE_MAX_CHARS)
    : trimmed
}

/**
 * Per-edge delegation sentence (X1 - unconditional; ignores ConnectionCondition).
 * MUTATION: condition-dependent phrasing → emission-identical-across-conditions test fails.
 */
export function formatDelegationSentence(edge: WorkflowEdgeInput): string {
  const note = normalizeContextNote(edge.contextNote)
  const base = `Delegate work to ${edge.workerDisplayName}.`
  if (!note) return base
  return `Delegate work to ${edge.workerDisplayName} (${note}).`
}

/**
 * Return-path + review law (always ends the Workflow section).
 * Delivery sentence follows the knob. Domain-noun-free.
 */
export function formatWorkflowLawSection(knobs: WorkflowLawKnobs): string {
  const threshold = knobs.qualityThreshold
  const rounds = knobs.maxRevisionRounds
  const delivery =
    knobs.deliveryMode === "AUTO_PROCEED"
      ? "Delivery mode: opted-in actions may proceed. Critic approval is not human approval; the human flip is the consent."
      : "Delivery mode: ask the user before acting. Critic approval is not human approval; nothing ships without the human's explicit approve."
  return [
    `Results return to ${knobs.orchestratorDisplayName} automatically.`,
    `${knobs.criticDisplayName} reviews every worker output before anything reaches the user.`,
    `Scores below ${threshold} loop back for revision (max ${rounds}).`,
    delivery,
  ].join(" ")
}

/**
 * Full fenced Workflow block for the orchestrator AGENTS.md.
 * Empty edges → still emit law (critic invariant) when callers pass knobs;
 * callers with zero orch→worker edges typically hard-block deploy instead.
 */
export function generateFencedWorkflowSection(args: {
  edges: WorkflowEdgeInput[]
  knobs: WorkflowLawKnobs
}): string {
  const lines = args.edges.map((e) => `- ${formatDelegationSentence(e)}`)
  const body = [
    "## Workflow",
    "",
    "These handoffs come directly from the connections drawn on the Builder canvas:",
    "",
    ...(lines.length > 0 ? lines : ["- _(no worker connections)_"]),
    "",
    formatWorkflowLawSection(args.knobs),
  ].join("\n")

  return `${WORKFLOW_FENCE_BEGIN}\n${body}\n${WORKFLOW_FENCE_END}`
}

/**
 * Replace-or-append the fenced Workflow section. Prose outside the fence
 * survives byte-identical. Returns { text, corrected } where corrected is
 * true when an existing fence was replaced (tamper / stale fence body).
 */
export function applyWorkflowFence(args: {
  agentsMd: string
  fenceBody: string
}): { text: string; corrected: boolean } {
  const { agentsMd, fenceBody } = args
  const begin = agentsMd.indexOf(WORKFLOW_FENCE_BEGIN)
  const end = agentsMd.indexOf(WORKFLOW_FENCE_END)

  if (begin !== -1 && end !== -1 && end > begin) {
    const afterEnd = end + WORKFLOW_FENCE_END.length
    const previous = agentsMd.slice(begin, afterEnd)
    const next = agentsMd.slice(0, begin) + fenceBody + agentsMd.slice(afterEnd)
    return { text: next, corrected: previous !== fenceBody }
  }

  // No fence - append (with leading newline if needed).
  const sep = agentsMd.endsWith("\n") || agentsMd.length === 0 ? "" : "\n"
  return { text: `${agentsMd}${sep}\n${fenceBody}\n`, corrected: false }
}
