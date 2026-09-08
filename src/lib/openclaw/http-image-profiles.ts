/**
 * HTTP auth profiles actually baked into a pinned OpenClaw image.
 * Contracts can exist in source before the overlay ships.
 *
 * -15 baked tavily / twitter / alpaca only.
 * -16+ bakes the remaining 27 (Composio X-API-Key + injected ids, twilio,
 * ahrefs, binance/coinbase/polymarket, shopify-admin on source / -17 image).
 *
 * MUTATION: mark gmail/shopify shipped on -15 → skill-http-contracts.test.ts fails.
 */
import { SKILL_HTTP_CONTRACTS } from "@/lib/openclaw/skill-http-contracts"

export const IMAGE_15_HTTP_SKILLS = ["tavily-search", "twitter-api", "alpaca-trading"] as const

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
  if (openClawOverlayBuild(dockerImage) >= 16) {
    return Object.keys(SKILL_HTTP_CONTRACTS)
  }
  return IMAGE_15_HTTP_SKILLS
}

export function isHttpSkillShippedOnImage(skillSlug: string, dockerImage: string): boolean {
  return httpSkillsShippedOnImage(dockerImage).includes(skillSlug)
}
