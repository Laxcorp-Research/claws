import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"
import {
  REJECT_UNSOURCED_CTR,
  UNSOURCED_CTR_LIFT_FIXTURE,
  YOUR_CTR_PLACEHOLDER,
  reviewYoutubeCtrClaims,
} from "@/lib/critic/youtube-ctr-gate"

describe("YouTube CTR sourcing (R2)", () => {
  it("unsourced 2.1% → 5.4% CTR lift REJECTS", () => {
    const result = reviewYoutubeCtrClaims(`Ship only 8+:
- 9 / ${UNSOURCED_CTR_LIFT_FIXTURE}

| Claim | Source |
| Handle @cursor-clips | USER.md:1 |
`)
    expect(result.verdict).toBe("REJECT")
    expect(result.reasons).toContain(`${REJECT_UNSOURCED_CTR}: 2.1% → 5.4%`)
  })

  it("2.1% → 5.4% PASS only when a YouTube tool id sources the lift", () => {
    const result = reviewYoutubeCtrClaims(`- 9 / ${UNSOURCED_CTR_LIFT_FIXTURE}

| Claim | Source |
| CTR lift 2.1% to 5.4% | tool:youtube-data-api:stats1 |
`)
    expect(result.verdict).toBe("PASS")
  })

  it("[YOUR CTR] placeholders do not trip the unsourced lift fixture", () => {
    const result = reviewYoutubeCtrClaims(
      `GOOD 9: "The 8-word title that lifted CTR from ${YOUR_CTR_PLACEHOLDER} to ${YOUR_CTR_PLACEHOLDER} (same thumbnail)."`,
    )
    expect(result.verdict).toBe("PASS")
  })

  it("WAVE-2 Title Architect GOOD 9 uses [YOUR CTR], not 2.1%/5.4%", () => {
    const youtube = ALL_TEMPLATES.find((t) => t.slug === "youtube-channel-os")
    const title = youtube?.agents.find((a) => a.agentSlug === "title-thumbnail-architect")
    expect(title?.soulMd).toContain(YOUR_CTR_PLACEHOLDER)
    expect(title?.soulMd).not.toContain("2.1%")
    expect(title?.soulMd).not.toContain("5.4%")
    const critic = youtube?.agents.find((a) => a.agentSlug === "content-quality-gate")
    expect(critic?.soulMd).toContain(UNSOURCED_CTR_LIFT_FIXTURE)
    expect(critic?.soulMd).toContain(REJECT_UNSOURCED_CTR)
  })
})
