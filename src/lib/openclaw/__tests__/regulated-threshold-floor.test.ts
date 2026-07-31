import { describe, expect, it } from "vitest"
import {
  REGULATED_QUALITY_THRESHOLD_FLOOR,
  REGULATED_TEMPLATE_SLUGS,
  enforceQualityThresholdFloor,
} from "@/lib/openclaw/regulated-threshold-floor"

describe("enforceQualityThresholdFloor", () => {
  it("floors regulated templates below 8", () => {
    for (const slug of REGULATED_TEMPLATE_SLUGS) {
      const result = enforceQualityThresholdFloor({ proposed: 6, templateSlug: slug })
      expect(result.value).toBe(REGULATED_QUALITY_THRESHOLD_FLOOR)
      expect(result.floored).toBe(true)
    }
  })

  it("does not floor non-regulated templates", () => {
    const result = enforceQualityThresholdFloor({
      proposed: 6,
      templateSlug: "twitter-growth",
    })
    expect(result.value).toBe(6)
    expect(result.floored).toBe(false)
  })
})
