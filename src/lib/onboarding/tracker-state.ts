/**
 * Getting-started tracker - pure predicates + step-3 routing.
 *
 * S3 ("has deployed") uses DeploymentStatus.COMPLETED - not Workspace.status -
 * so a claw that is STOPPED/PAUSED after a successful deploy still counts.
 *
 * S1v2 (D-v REFRAME): credit balanceCents > 0 OR any UserApiKey.
 * Edge: balance hits 0 with no key → S1v2 regresses to not-done - accepted
 * (nav item reappearing is an actionable nudge, not a bug).
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
  | "PROVISIONING_QUEUED"

export interface TrackerWorkspace {
  id: string
  name: string
  status: TrackerWorkspaceStatus
  hasCompletedDeployment: boolean
}

export interface TrackerInputs {
  providers: string[]
  /**
   * Same surface as wizard Step1: CreditAccount.balanceCents from
   * GET /api/credits/balance (null when no account row).
   */
  balanceCents: number | null
  workspaces: TrackerWorkspace[]
  hasToolConnection: boolean
  hasCompletedDeployment: boolean
}

export type S1DoneVia = "credits" | "key" | "both" | null

export interface TrackerState {
  s1Done: boolean
  s1DoneVia: S1DoneVia
  s2Done: boolean
  s3Done: boolean
  allDone: boolean
  connectedProviders: string[]
  workspaceCount: number
  balanceCents: number
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

/** S1v2: balance > 0 OR any UserApiKey. */
export function isStep1Complete(input: {
  balanceCents: number | null
  providers: string[]
}): boolean {
  const hasCredits = (input.balanceCents ?? 0) > 0
  const hasKey = input.providers.length > 0
  return hasCredits || hasKey
}

export function resolveS1DoneVia(input: {
  balanceCents: number | null
  providers: string[]
}): S1DoneVia {
  const hasCredits = (input.balanceCents ?? 0) > 0
  const hasKey = input.providers.length > 0
  if (hasCredits && hasKey) return "both"
  if (hasKey) return "key"
  if (hasCredits) return "credits"
  return null
}

export function isStep3Complete(input: {
  hasToolConnection: boolean
  hasCompletedDeployment: boolean
}): boolean {
  return input.hasToolConnection && input.hasCompletedDeployment
}

/**
 * Top-bar "Getting started" visibility - incomplete tracker only.
 * MUTATION: always return true → visibility test fails.
 * Menu entry is unconditional (separate predicate).
 */
export function shouldShowGettingStartedNav(state: {
  s1Done: boolean
  s2Done: boolean
  s3Done: boolean
}): boolean {
  return !(state.s1Done && state.s2Done && state.s3Done)
}

export function deriveTrackerState(input: TrackerInputs): TrackerState {
  const s1Done = isStep1Complete({
    balanceCents: input.balanceCents,
    providers: input.providers,
  })
  const s1DoneVia = resolveS1DoneVia({
    balanceCents: input.balanceCents,
    providers: input.providers,
  })
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
    s1DoneVia,
    s2Done,
    s3Done,
    allDone: s1Done && s2Done && s3Done,
    connectedProviders: input.providers.map(providerDisplayName),
    workspaceCount: input.workspaces.length,
    balanceCents: input.balanceCents ?? 0,
    // Template honesty only when keys exist without Anthropic (credits don't imply Anthropic key).
    showAnthropicTemplateHint: input.providers.length > 0 && !hasAnthropic,
    deployedWorkspaceId: deployed?.id ?? null,
  }
}

export type Step3Action =
  | { type: "need-claw" }
  | { type: "picker"; workspaces: TrackerWorkspace[] }
  | { type: "dashboard"; href: string }

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
 * Step-3 click branching (v2.1): picker ALWAYS when S2 done (even n=1).
 * MUTATION: restore direct-route for n===1 → branching test fails.
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
  return { type: "picker", workspaces: args.workspaces }
}
