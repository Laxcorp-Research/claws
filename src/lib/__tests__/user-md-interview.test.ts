import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES, TEMPLATE_INTERVIEW_PACKS } from "../../../prisma/seed-data"
import {
  formatInterviewBootSection,
  getInterviewPack,
  parseUserMdAnswers,
  renderUserMdFromAnswers,
  USER_MD_HOST_PATH,
  USER_MD_INTERVIEW_COMPLETE_TOKEN,
  userMdInterviewFileIsComplete,
} from "@/lib/user-md-interview"

describe("INFRA-1 USER.md interview packs", () => {
  it("has a coverage pack for all 20 templates", () => {
    const slugs = ALL_TEMPLATES.map((t) => t.slug).sort()
    expect(Object.keys(TEMPLATE_INTERVIEW_PACKS).sort()).toEqual(slugs)
    expect(slugs).toHaveLength(20)
    for (const slug of slugs) {
      const pack = TEMPLATE_INTERVIEW_PACKS[slug]
      expect(pack.length, slug).toBeGreaterThanOrEqual(4)
      const ids = pack.map((q) => q.id)
      expect(new Set(ids).size, slug).toBe(ids.length)
    }
  })

  it("Twitter/X pack covers niche, voice, do-not, cadence", () => {
    const pack = getInterviewPack("twitter-growth-machine")!
    const ids = pack.map((q) => q.id)
    expect(ids).toEqual(expect.arrayContaining(["niche", "voice", "do_not", "cadence"]))
  })

  it("pack → USER.md → parse round-trip (MUTATION: drop answer lines → fail)", () => {
    const pack = getInterviewPack("twitter-growth-machine")!
    const answers: Record<string, string> = {
      niche: "AI agents for operators, not prompt-bros",
      audience: "founders shipping agent teams",
      cadence: "1 thread + 3 singles on weekdays, quiet weekends",
      voice: "direct, specific, no guru cadence",
      do_not: "no crypto shills, no engagement-bait polls",
      proof: "the March thread on evals; the 'don't demo vapor' tweet",
      goals: "one batch a human would actually post each week",
    }
    const file = renderUserMdFromAnswers(pack, answers)
    expect(file).toContain(USER_MD_HOST_PATH.split("/").pop() as string)
    expect(userMdInterviewFileIsComplete(file)).toBe(true)
    expect(parseUserMdAnswers(file)).toEqual(answers)
  })

  it("incomplete answers keep Interview complete = no", () => {
    const pack = getInterviewPack("twitter-growth-machine")!
    const file = renderUserMdFromAnswers(pack, { niche: "only niche so far" })
    expect(userMdInterviewFileIsComplete(file)).toBe(false)
    expect(parseUserMdAnswers(file).niche).toBe("only niche so far")
  })

  it("BOOT section omits the pack after completion (MUTATION: keep First-boot interview → fail)", () => {
    const pack = getInterviewPack("twitter-growth-machine")!
    const pending = formatInterviewBootSection({ interviewCompleted: false, pack })
    expect(pending).toContain("## First-boot interview")
    expect(pending).toContain("do_not:")
    expect(pending).toContain(USER_MD_INTERVIEW_COMPLETE_TOKEN)
    expect(pending).toContain(USER_MD_HOST_PATH)

    const done = formatInterviewBootSection({ interviewCompleted: true, pack })
    expect(done).not.toContain("## First-boot interview")
    expect(done).not.toContain("do_not:")
    expect(done).toContain("update my profile")
    expect(done).toContain(USER_MD_HOST_PATH)
  })
})
