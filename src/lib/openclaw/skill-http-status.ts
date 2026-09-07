import {
  httpContractForSkill,
  httpSkillForToolSlug,
} from "@/lib/openclaw/skill-http-contracts"
import {
  FAIL_CLOSED_PINNED_IMAGE,
  isHttpSkillShippedOnImage,
} from "@/lib/openclaw/http-image-profiles"

export const NOT_YET_CALLABLE_BADGE = "not yet callable"

export function httpSkillStatusBadge(
  skillSlug: string,
  dockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): "callable" | typeof NOT_YET_CALLABLE_BADGE {
  if (!httpContractForSkill(skillSlug)) return NOT_YET_CALLABLE_BADGE
  return isHttpSkillShippedOnImage(skillSlug, dockerImage) ? "callable" : NOT_YET_CALLABLE_BADGE
}

export function isHttpToolCallable(
  toolSlug: string,
  dockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): boolean {
  const skill = httpSkillForToolSlug(toolSlug)
  if (!skill) return true
  return httpSkillStatusBadge(skill, dockerImage) === "callable"
}

/**
 * A5: Connected/PENDING only when the mapped skill has a contract AND the
 * pinned image carries that auth profile. Unmapped tools keep the runtime label.
 */
export function httpHonestStatusLabel(
  toolSlug: string | undefined,
  connectedLabel: string,
  dockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): string {
  if (!toolSlug) return connectedLabel
  if (isHttpToolCallable(toolSlug, dockerImage)) return connectedLabel
  if (
    connectedLabel === "Connected" ||
    connectedLabel === "Connected (saved; unverified until first use)"
  ) {
    return NOT_YET_CALLABLE_BADGE
  }
  return connectedLabel
}

export function toolRowConnectedBadge(
  toolSlug: string | undefined,
  dockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): string {
  return httpHonestStatusLabel(toolSlug, "Connected", dockerImage)
}
