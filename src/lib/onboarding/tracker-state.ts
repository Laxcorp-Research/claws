/**
 * Getting-started tracker — pure predicates + step-3 routing.
 *
 * S3 ("has deployed") uses DeploymentStatus.COMPLETED — not Workspace.status —
 * so a claw that is STOPPED/PAUSED after a successful deploy still counts.
 */

export type TrackerWorkspaceStatus =
  | "DRAFT"
  | "SETUP_INCOMPLETE"
  | "DEPLOYING"
  | "RUNNING"
  | "PAUSED"
  | "HIBERNATED"
  | "WAKING"
  | "ERROR"
  | "STOPPED"

export interface TrackerWorkspace {
  id: string
  name: string
  status: TrackerWorkspaceStatus
  hasCompletedDeployment: boolean
}

export interface TrackerInputs {
  providers: string[]
  workspaces: TrackerWorkspace[]
  /** True when any workspace owned by the user has ≥1 ToolConnection row. */
  hasToolConnection: boolean
  /**
   * MUTATION: changing this to require Workspace.status===RUNNING breaks the
   * once-deployed-now-stopped matrix case.
   */
  hasCompletedDeployment: boolean
}

export interface TrackerState {
  s1Done: boolean
  s2Done: boolean
  s3Done: boolean
  allDone: boolean
  connectedProviders: string[]
  workspaceCount: number
  showAnthropicTemplateHint: boolean
  deployedWorkspaceId: string | null
}

const PROVIDER_LABELS: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GOOGLE: "Google",
}

export function providerDisplayName(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

/** S3 predicate: tools connected somewhere AND at least one COMPLETED deployment. */
export function isStep3Complete(input: {
  hasToolConnection: boolean
  hasCompletedDeployment: boolean
}): boolean {
  return input.hasToolConnection && input.hasCompletedDeployment
}

export function deriveTrackerState(input: TrackerInputs): TrackerState {
  const s1Done = input.providers.length > 0
  const s2Done = input.workspaces.length > 0
  const s3Done = isStep3Complete({
    hasToolConnection: input.hasToolConnection,
    hasCompletedDeployment: input.hasCompletedDeployment,
  })
  const hasAnthropic = input.providers.includes("ANTHROPIC")
  const deployed =
    input.workspaces.find((w) => w.hasCompletedDeployment && w.status === "RUNNING") ??
    input.workspaces.find((w) => w.hasCompletedDeployment) ??
    null

  return {
    s1Done,
    s2Done,
    s3Done,
    allDone: s1Done && s2Done && s3Done,
    connectedProviders: input.providers.map(providerDisplayName),
    workspaceCount: input.workspaces.length,
    showAnthropicTemplateHint: s1Done && !hasAnthropic,
    deployedWorkspaceId: deployed?.id ?? null,
  }
}

export type Step3Action =
  | { type: "need-claw" }
  | { type: "direct"; href: string }
  | { type: "picker"; workspaces: TrackerWorkspace[] }
  | { type: "dashboard"; href: string }

/** Route a workspace into setup / builder / dashboard per product rules. */
export function workspaceContinueHref(workspace: TrackerWorkspace): string {
  if (workspace.status === "SETUP_INCOMPLETE") {
    return `/setup/${workspace.id}/step/1`
  }
  if (workspace.status === "DRAFT") {
    return `/builder/${workspace.id}`
  }
  return `/dashboard/${workspace.id}`
}

/**
 * Step-3 click branching.
 * MUTATION: drop the need-claw branch → snackbar branching test fails.
 */
export function resolveStep3Action(args: {
  s2Done: boolean
  s3Done: boolean
  workspaces: TrackerWorkspace[]
  deployedWorkspaceId: string | null
}): Step3Action {
  if (!args.s2Done) return { type: "need-claw" }
  if (args.s3Done && args.deployedWorkspaceId) {
    return { type: "dashboard", href: `/dashboard/${args.deployedWorkspaceId}` }
  }
  if (args.workspaces.length === 1) {
    return { type: "direct", href: workspaceContinueHref(args.workspaces[0]) }
  }
  return { type: "picker", workspaces: args.workspaces }
}
