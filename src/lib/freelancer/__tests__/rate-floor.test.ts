import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"
import { getInterviewPack } from "@/lib/user-md-interview"
import {
  BELOW_FLOOR_FLAG,
  BELOW_FLOOR_WORKED_EXAMPLE,
  proposalFlagsBelowFloor,
} from "@/lib/freelancer/rate-floor"

function writerSoul(): string {
  const t = ALL_TEMPLATES.find((x) => x.slug === "freelancer-revenue-engine")
  const a = t?.agents.find((x) => x.agentSlug === "proposal-writer")
  if (!a) throw new Error("proposal-writer missing")
  return a.soulMd
}

describe("freelancer rate floor", () => {
  it("interview pack asks floor rate and preferred engagement shape", () => {
    const pack = getInterviewPack("freelancer-revenue-engine")!
    const ids = pack.map((q) => q.id)
    expect(ids).toEqual(expect.arrayContaining(["rate", "engagement"]))
    const rate = pack.find((q) => q.id === "rate")!
    const engagement = pack.find((q) => q.id === "engagement")!
    expect(rate.prompt).toMatch(/floor rate/i)
    expect(rate.coverage).toBe("floor rate")
    expect(engagement.prompt).toMatch(/engagement shape/i)
    expect(engagement.coverage).toBe("engagement shape")
  })

  it("lead budget < floor → silent price from lead budget fails; flagged proposal passes", () => {
    const { floorUsd, leadBudgetUsd, silentProposal, flaggedProposal } =
      BELOW_FLOOR_WORKED_EXAMPLE
    expect(
      proposalFlagsBelowFloor({
        proposal: silentProposal,
        floorUsd,
        leadBudgetUsd,
      }),
    ).toBe(false)
    expect(
      proposalFlagsBelowFloor({
        proposal: flaggedProposal,
        floorUsd,
        leadBudgetUsd,
      }),
    ).toBe(true)
    expect(flaggedProposal).toContain(BELOW_FLOOR_FLAG)
    expect(flaggedProposal).not.toMatch(/Price:\s*\$4,000/)
  })

  it("Writer soul pins the $4k-below-$6k worked example (MUTATION: drop flag → fail)", () => {
    const soul = writerSoul()
    expect(soul).toContain("### rate")
    expect(soul).toContain("### engagement")
    expect(soul).toContain(BELOW_FLOOR_WORKED_EXAMPLE.flaggedProposal)
    expect(soul).toContain("Never: Price: $4,000")
    expect(soul).toContain('Never say "floor is not yet set"')
    expect(
      proposalFlagsBelowFloor({
        proposal: BELOW_FLOOR_WORKED_EXAMPLE.flaggedProposal,
        floorUsd: BELOW_FLOOR_WORKED_EXAMPLE.floorUsd,
        leadBudgetUsd: BELOW_FLOOR_WORKED_EXAMPLE.leadBudgetUsd,
      }),
    ).toBe(true)
  })
})
