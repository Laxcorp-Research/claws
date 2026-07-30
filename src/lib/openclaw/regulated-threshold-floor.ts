/**
 * Regulated template qualityThreshold floors (WIRE-FULL X3 / A5).
 * Floor = 8 minimum. Lenient (6) hidden in UI for these templates (PR-2);
 * server-side enforcement on the knob write route lives here.
 */

export const REGULATED_TEMPLATE_SLUGS = [
  "medical-practice-manager",
  "law-firm-intake-os",
  "health-fitness-commander",
  "real-estate-agent-os",
  "recruiter-os",
  "home-services-dispatcher",
] as const

export type RegulatedTemplateSlug = (typeof REGULATED_TEMPLATE_SLUGS)[number]

export const REGULATED_QUALITY_THRESHOLD_FLOOR = 8

export function isRegulatedTemplateSlug(
  slug: string | null | undefined,
): slug is RegulatedTemplateSlug {
  if (!slug) return false
  return (REGULATED_TEMPLATE_SLUGS as readonly string[]).includes(slug)
}

/**
 * Clamp a proposed qualityThreshold against the regulated floor.
 * Non-regulated templates: no floor beyond basic 1–10 range.
 */
export function enforceQualityThresholdFloor(args: {
  proposed: number
  templateSlug: string | null | undefined
}): { value: number; floored: boolean } {
  let value = args.proposed
  if (!Number.isFinite(value)) value = 8
  if (value < 1) value = 1
  if (value > 10) value = 10

  if (isRegulatedTemplateSlug(args.templateSlug)) {
    if (value < REGULATED_QUALITY_THRESHOLD_FLOOR) {
      return { value: REGULATED_QUALITY_THRESHOLD_FLOOR, floored: true }
    }
  }
  return { value, floored: false }
}
