import {
  httpContractForSkill,
  httpSkillForToolSlug,
} from "@/lib/openclaw/skill-http-contracts"

export const NOT_YET_CALLABLE_BADGE = "not yet callable"

export function httpSkillStatusBadge(skillSlug: string): "callable" | typeof NOT_YET_CALLABLE_BADGE {
  return httpContractForSkill(skillSlug) ? "callable" : NOT_YET_CALLABLE_BADGE
}

export function isHttpToolCallable(toolSlug: string): boolean {
  const skill = httpSkillForToolSlug(toolSlug)
  if (!skill) return true
  return httpContractForSkill(skill) !== null
}

/**
 * A5: until a mapped skill has an http contract, never show Connected/PENDING.
 * Unmapped tools keep the runtime label.
 */
export function httpHonestStatusLabel(
  toolSlug: string | undefined,
  connectedLabel: string,
): string {
  if (!toolSlug) return connectedLabel
  if (isHttpToolCallable(toolSlug)) return connectedLabel
  if (
    connectedLabel === "Connected" ||
    connectedLabel === "Connected (saved; unverified until first use)"
  ) {
    return NOT_YET_CALLABLE_BADGE
  }
  return connectedLabel
}

export function toolRowConnectedBadge(toolSlug: string | undefined): string {
  return httpHonestStatusLabel(toolSlug, "Connected")
}
