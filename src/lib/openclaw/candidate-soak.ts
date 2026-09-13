/**
 * Per-workspace candidate runtime soak (RUNTIME-9.4 PR-2).
 *
 * isCandidate register rows become OpenClawVersion.isLatest, not isStable.
 * resolveDeployImage() stays on isStable unless this gate returns true.
 *
 * Never KEEP canary. Never production. Staging clones only.
 */

export const KEEP_CANARY_WORKSPACE_ID = "cmr3fo19r000404jlze8o7dm8"

export type CandidateSoakDecision =
  | { allowed: true }
  | { allowed: false; reason: "unflagged" | "keep-canary" | "production" | "missing-workspace" }

export function isCandidateSoakRuntimeAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const claws = (env.CLAWS_ENV ?? "").trim().toLowerCase()
  if (claws === "production") return false
  if (claws === "staging" || claws === "development" || claws === "test") return true
  const vercel = (env.VERCEL_ENV ?? "").trim().toLowerCase()
  if (vercel === "production") return false
  const node = (env.NODE_ENV ?? "").trim().toLowerCase()
  if (node === "test" || node === "development") return true
  if (vercel === "preview") return true
  return false
}

export function isKeepCanaryWorkspace(workspaceId: string | null | undefined): boolean {
  return workspaceId === KEEP_CANARY_WORKSPACE_ID
}

export function decideCandidateSoak(args: {
  workspaceId?: string | null
  candidateSoak?: boolean | null
  env?: Record<string, string | undefined>
}): CandidateSoakDecision {
  if (!args.workspaceId) return { allowed: false, reason: "missing-workspace" }
  if (isKeepCanaryWorkspace(args.workspaceId)) return { allowed: false, reason: "keep-canary" }
  if (!isCandidateSoakRuntimeAllowed(args.env ?? process.env)) {
    return { allowed: false, reason: "production" }
  }
  if (args.candidateSoak !== true) return { allowed: false, reason: "unflagged" }
  return { allowed: true }
}

export function mayDeployCandidateImage(args: {
  workspaceId?: string | null
  candidateSoak?: boolean | null
  env?: Record<string, string | undefined>
}): boolean {
  return decideCandidateSoak(args).allowed
}
