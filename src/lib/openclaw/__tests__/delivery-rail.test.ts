import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CRITIC_NE_HUMAN_COPY,
  deliveryProseViolations,
  looksLikeApprovalRequest,
  mergeOutboundDenyIntoTools,
  outboundDenyList,
  overlayMissionLaw,
  shouldDenyOutboundAction,
} from "@/lib/openclaw/delivery-rail"
import { TWITTER_TOKEN_CANNOT_POST_COPY } from "@/lib/tools/twitter-api-honesty"
import { formatWorkflowLawSection } from "@/lib/openclaw/workflow-language"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"

describe("B-3 delivery rail", () => {
  it("denies outbound tools when approval is required", () => {
    expect(shouldDenyOutboundAction({ deliveryMode: "APPROVAL_REQUIRED", toolName: "message" })).toBe(true)
    expect(shouldDenyOutboundAction({ deliveryMode: "APPROVAL_REQUIRED", toolName: "exec" })).toBe(true)
    expect(shouldDenyOutboundAction({ deliveryMode: "APPROVAL_REQUIRED", toolName: "TWITTER_CREATION_OF_A_POST" })).toBe(true)
    expect(shouldDenyOutboundAction({ deliveryMode: "APPROVAL_REQUIRED", toolName: "web_search" })).toBe(false)
  })

  it("AUTO_PROCEED still denies tools that are not autonomous-capable", () => {
    expect(shouldDenyOutboundAction({ deliveryMode: "AUTO_PROCEED", toolName: "message" })).toBe(true)
    expect(outboundDenyList("AUTO_PROCEED")).toContain("message")
  })

  it("merge is mechanical (not prose-only)", () => {
    const tools = mergeOutboundDenyIntoTools({ deny: ["dir_list"] }, "APPROVAL_REQUIRED")
    expect(tools.deny).toEqual(expect.arrayContaining(["dir_list", "message", "exec"]))
    const generator = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(generator).toContain("mergeOutboundDenyIntoTools")
  })

  it("MUTATION: knob-as-prose-only restored fails", () => {
    const generator = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    const law = formatWorkflowLawSection({
      orchestratorDisplayName: "Commander",
      criticDisplayName: "Reviewer",
      qualityThreshold: 8,
      maxRevisionRounds: 3,
      deliveryMode: "APPROVAL_REQUIRED",
    })
    expect(law).toContain(CRITIC_NE_HUMAN_COPY)
    expect(generator).toMatch(/config\.tools = mergeOutboundDenyIntoTools/)
  })

  it("orchestrator text claiming no user approval needed is a violation", () => {
    const fixture =
      "Agent Seer post ships in ~10 minutes. No user approval needed (already Reviewer-gated)."
    expect(deliveryProseViolations(fixture)).toEqual([
      "orchestrator claimed no user approval needed",
    ])
    const twitter = ALL_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")
    expect(twitter).toBeDefined()
    const commander = twitter!.agents.find((a) => a.agentSlug === "twitter-commander")
    expect(deliveryProseViolations(commander!.soulMd)).toEqual([])
    expect(commander!.soulMd).toContain(CRITIC_NE_HUMAN_COPY)
    expect(commander!.heartbeatMd).toContain(CRITIC_NE_HUMAN_COPY)
  })

  it("approval-request detector accepts awaiting-your-approval copy", () => {
    expect(looksLikeApprovalRequest("drafted, awaiting your approval for 4 PM")).toBe(true)
    expect(looksLikeApprovalRequest("No user approval needed")).toBe(false)
  })

  it("overlay pins critic law onto custom soul without stripping voice", () => {
    const overlaid = overlayMissionLaw("# Identity\nYou are Twitter Commander.\n")
    expect(overlaid).toContain("You are Twitter Commander.")
    expect(overlaid).toContain(CRITIC_NE_HUMAN_COPY)
    expect(overlaid).not.toContain(TWITTER_TOKEN_CANNOT_POST_COPY)
    const again = overlayMissionLaw(overlaid)
    expect(again.split(CRITIC_NE_HUMAN_COPY)).toHaveLength(2)
  })

  it("twitter-readonly overlay forbids saying a post ships", () => {
    const overlaid = overlayMissionLaw("# Identity\nYou are Twitter Commander.\n", {
      twitterReadOnly: true,
    })
    expect(overlaid).toContain(TWITTER_TOKEN_CANNOT_POST_COPY)
  })
})
