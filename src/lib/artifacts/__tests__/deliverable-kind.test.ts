import { describe, expect, it } from "vitest"
import {
  deliverableKind,
  isDecisionDeliverable,
  previewFromContent,
  sidecarPathFor,
} from "@/lib/artifacts/deliverable-kind"

describe("deliverable kind", () => {
  it("treats cycle/draft files as decision docs", () => {
    expect(isDecisionDeliverable("shared/deliverables/x-content-cycle.md")).toBe(true)
    expect(deliverableKind("shared/deliverables/draft-pack.md")).toBe("decision")
  })

  it("treats recap/trends as view-only reports", () => {
    expect(isDecisionDeliverable("shared/deliverables/x-daily-recap.md")).toBe(false)
    expect(isDecisionDeliverable("shared/deliverables/x-morning-trends.md")).toBe(false)
    expect(deliverableKind("shared/deliverables/x-daily-recap.md")).toBe("report")
  })

  it("builds a non-dotfile sidecar path", () => {
    expect(sidecarPathFor("shared/deliverables/x-content-cycle.md")).toBe(
      "shared/deliverables/x-content-cycle.md.status.json",
    )
  })

  it("clips preview", () => {
    expect(previewFromContent("short")).toBe("short")
    expect(previewFromContent("x".repeat(300)).endsWith("...")).toBe(true)
  })
})
