import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  WORKFLOW_FENCE_BEGIN,
  WORKFLOW_FENCE_END,
  applyWorkflowFence,
  formatDelegationSentence,
  formatWorkflowLawSection,
  generateFencedWorkflowSection,
} from "@/lib/openclaw/workflow-language"

const DOMAIN_NOUNS = [
  "content",
  "trade",
  "post",
  "report",
  "patient",
  "tweet",
  "email",
  "invoice",
]

describe("workflow-language", () => {
  it("domain-noun grep: module must stay universal (mutation: inject content → fails)", () => {
    const src = readFileSync(
      resolve(__dirname, "../workflow-language.ts"),
      "utf8",
    )
    // Strip this test's own comment list by only scanning the module file.
    for (const noun of DOMAIN_NOUNS) {
      expect(src.toLowerCase()).not.toContain(noun)
    }
  })

  it("delegation sentence ignores condition - emission identical across values (X2)", () => {
    const a = formatDelegationSentence({ workerDisplayName: "Researcher" })
    const b = formatDelegationSentence({
      workerDisplayName: "Researcher",
      contextNote: null,
    })
    expect(a).toBe("Delegate work to Researcher.")
    expect(a).toBe(b)
  })

  it("weaves contextNote into the delegation sentence", () => {
    expect(
      formatDelegationSentence({
        workerDisplayName: "Researcher",
        contextNote: "deep dives only",
      }),
    ).toBe("Delegate work to Researcher (deep dives only).")
  })

  it("law section carries threshold, rounds, approval language", () => {
    const law = formatWorkflowLawSection({
      orchestratorDisplayName: "Commander",
      criticDisplayName: "Reviewer",
      qualityThreshold: 8,
      maxRevisionRounds: 3,
      deliveryMode: "AUTO_PROCEED",
    })
    expect(law).toContain("Reviewer reviews every worker output")
    expect(law).toContain("Scores below 8 loop back for revision (max 3)")
    expect(law).toContain("ask the user before acting")
    // Ships locked - AUTO_PROCEED must not change emission this arc.
    expect(law).not.toContain("automatically proceed")
  })

  it("fence round-trip: prose outside survives byte-identical; corrected when fence changes", () => {
    const templateProse = "# Ops\n\nDo the morning checklist.\n"
    const fence = generateFencedWorkflowSection({
      edges: [{ workerDisplayName: "Worker A" }],
      knobs: {
        orchestratorDisplayName: "Orch",
        criticDisplayName: "Critic",
        qualityThreshold: 8,
        maxRevisionRounds: 3,
        deliveryMode: "APPROVAL_REQUIRED",
      },
    })
    const seeded = `${templateProse}\n${fence}\n`
    const nextFence = generateFencedWorkflowSection({
      edges: [{ workerDisplayName: "Worker B" }],
      knobs: {
        orchestratorDisplayName: "Orch",
        criticDisplayName: "Critic",
        qualityThreshold: 8,
        maxRevisionRounds: 3,
        deliveryMode: "APPROVAL_REQUIRED",
      },
    })
    const applied = applyWorkflowFence({ agentsMd: seeded, fenceBody: nextFence })
    expect(applied.corrected).toBe(true)
    expect(applied.text.startsWith(templateProse)).toBe(true)
    expect(applied.text).toContain("Worker B")
    expect(applied.text).not.toContain("Worker A")
    expect(applied.text).toContain(WORKFLOW_FENCE_BEGIN)
    expect(applied.text).toContain(WORKFLOW_FENCE_END)
  })

  it("MUTATION: displace template prose outside fence → fails", () => {
    const outside = "KEEP_THIS_BYTE_IDENTICAL"
    const fence = generateFencedWorkflowSection({
      edges: [],
      knobs: {
        orchestratorDisplayName: "O",
        criticDisplayName: "C",
        qualityThreshold: 8,
        maxRevisionRounds: 2,
        deliveryMode: "APPROVAL_REQUIRED",
      },
    })
    const applied = applyWorkflowFence({
      agentsMd: `${outside}\n${fence}\n`,
      fenceBody: fence,
    })
    expect(applied.corrected).toBe(false)
    expect(applied.text.indexOf(outside)).toBe(0)
  })
})
