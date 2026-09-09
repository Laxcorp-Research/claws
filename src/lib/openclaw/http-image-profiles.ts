/**
 * HTTP auth profiles actually baked into a pinned OpenClaw image.
 * Contracts can exist in source before the overlay ships.
 *
 * -15 baked tavily / twitter / alpaca only.
 * -16 baked the remaining contracts except beehiiv-api (WAVE-2 bearer,
 * added after the -16 bake) and shopify-admin (source until -17).
 * -17 bakes beehiiv-api + shopify-store and every later BYOK profile.
 *
 * MUTATION: mark gmail/shopify shipped on -15, or beehiiv/shopify on -16
 * → skill-http-contracts.test.ts fails.
 */
import { SKILL_HTTP_CONTRACTS } from "@/lib/openclaw/skill-http-contracts"

export const IMAGE_15_HTTP_SKILLS = ["tavily-search", "twitter-api", "alpaca-trading"] as const

/** Auth profiles first honest on the -17 image, not -16. */
export const IMAGE_17_AUTH_SKILLS = ["beehiiv-api", "shopify-store"] as const

export const FAIL_CLOSED_PINNED_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-15"

export function openClawImageTag(dockerImage: string): string {
  const parts = dockerImage.split(":")
  return parts.length > 1 ? (parts.at(-1) ?? "") : dockerImage
}

export function openClawOverlayBuild(dockerImage: string): number {
  const tag = openClawImageTag(dockerImage)
  const match = tag.match(/-(\d+)$/)
  return match ? Number(match[1]) : 0
}

export function httpSkillsShippedOnImage(dockerImage: string): readonly string[] {
  const build = openClawOverlayBuild(dockerImage)
  const all = Object.keys(SKILL_HTTP_CONTRACTS)
  if (build >= 17) return all
  if (build >= 16) {
    return all.filter((skill) => !(IMAGE_17_AUTH_SKILLS as readonly string[]).includes(skill))
  }
  return IMAGE_15_HTTP_SKILLS
}

export function isHttpSkillShippedOnImage(skillSlug: string, dockerImage: string): boolean {
  return httpSkillsShippedOnImage(dockerImage).includes(skillSlug)
}
