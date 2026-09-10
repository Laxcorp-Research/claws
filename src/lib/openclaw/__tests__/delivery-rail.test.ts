import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CLAIMS_TABLE_STEP_MARKER,
  STRICT_8_DEFINITION,
} from "@/lib/critic/claims-table"
import {
  CLOCK_TZ_COPY,
  CRITIC_NE_HUMAN_COPY,
  OUTBOUND_ACTION_DENY,
  SIDECAR_DECISION_TRUTH_COPY,
  deliveryProseViolations,
  looksLikeApprovalRequest,
  mergeOutboundDenyIntoTools,
  outboundDenyList,
  overlayMissionLaw,
  httpCallSupportsAutonomous,
  shouldDenyOutboundAction,
  TOOL_STATUS_TRUTH_COPY,
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

  it("does not put http on the outbound deny list (class is the gate)", () => {
    expect(OUTBOUND_ACTION_DENY).not.toContain("http")
    expect(shouldDenyOutboundAction({ deliveryMode: "APPROVAL_REQUIRED", toolName: "http" })).toBe(false)
  })

  it("AUTO_PROCEED still denies tools that are not autonomous-capable", () => {
    expect(shouldDenyOutboundAction({ deliveryMode: "AUTO_PROCEED", toolName: "message" })).toBe(true)
    expect(outboundDenyList("AUTO_PROCEED")).toContain("message")
    expect(shouldDenyOutboundAction({ deliveryMode: "AUTO_PROCEED", toolName: "exec" })).toBe(true)
  })

  it("httpCallSupportsAutonomous is paper-order / tweet / gmail-send only", () => {
    expect(
      httpCallSupportsAutonomous({
        skill: "alpaca-trading",
        method: "POST",
        host: "paper-api.alpaca.markets",
        path: "/v2/orders",
      }),
    ).toBe(true)
    expect(
      httpCallSupportsAutonomous({
        skill: "alpaca-trading",
        method: "POST",
        host: "api.alpaca.markets",
        path: "/v2/orders",
      }),
    ).toBe(false)
    expect(
      httpCallSupportsAutonomous({
        skill: "twitter-api",
        method: "POST",
        host: "api.twitter.com",
        path: "/2/tweets",
      }),
    ).toBe(true)
    expect(
      httpCallSupportsAutonomous({
        skill: "twitter-api",
        method: "GET",
        host: "api.twitter.com",
        path: "/2/tweets/search/recent",
      }),
    ).toBe(false)
    expect(
      httpCallSupportsAutonomous({
        skill: "gmail-ops",
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/GMAIL_SEND_EMAIL",
      }),
    ).toBe(true)
    expect(
      httpCallSupportsAutonomous({
        skill: "gmail-ops",
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/GMAIL_ADD_LABEL_TO_EMAIL",
      }),
    ).toBe(false)
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
    expect(overlaid).toContain(SIDECAR_DECISION_TRUTH_COPY)
    expect(overlaid).not.toContain(TWITTER_TOKEN_CANNOT_POST_COPY)
    const again = overlayMissionLaw(overlaid)
    expect(again.split(CRITIC_NE_HUMAN_COPY)).toHaveLength(2)
    expect(again.split(SIDECAR_DECISION_TRUTH_COPY)).toHaveLength(2)
  })

  it("twitter-readonly overlay forbids saying a post ships", () => {
    const overlaid = overlayMissionLaw("# Identity\nYou are Twitter Commander.\n", {
      twitterReadOnly: true,
    })
    expect(overlaid).toContain(TWITTER_TOKEN_CANNOT_POST_COPY)
  })

  it("pins clock/tz and tool-status truth on every overlay", () => {
    const overlaid = overlayMissionLaw("# Identity\nYou are Twitter Commander.\n")
    expect(overlaid).toContain(CLOCK_TZ_COPY)
    expect(overlaid).toContain(TOOL_STATUS_TRUTH_COPY)
    const again = overlayMissionLaw(overlaid)
    expect(again.split(CLOCK_TZ_COPY)).toHaveLength(2)
    expect(again.split(TOOL_STATUS_TRUTH_COPY)).toHaveLength(2)
  })

  it("pins claims-table law on critic overlay only", () => {
    const worker = overlayMissionLaw("# Identity\nYou write.\n")
    expect(worker).not.toContain(CLAIMS_TABLE_STEP_MARKER)
    const critic = overlayMissionLaw("# Identity\nYou review.\n", { critic: true })
    expect(critic).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(critic).toContain(STRICT_8_DEFINITION)
    expect(critic).toMatch(/PASS or REJECT only/)
    const again = overlayMissionLaw(critic, { critic: true })
    expect(again.split(CLAIMS_TABLE_STEP_MARKER)).toHaveLength(2)
  })
})
