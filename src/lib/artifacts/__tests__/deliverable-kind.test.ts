import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  DELIVERABLE_EXTRACT_EVENT_KIND,
  DELIVERABLE_PATH_PREFIX,
  deliverableKind,
  isDecisionDeliverable,
  previewFromContent,
  sidecarPathFor,
  titleFromDeliverablePath,
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

  it("exports title + extract event kind for client card projection", () => {
    expect(titleFromDeliverablePath("shared/deliverables/x-content-cycle.md")).toBe(
      "x-content-cycle",
    )
    expect(DELIVERABLE_EXTRACT_EVENT_KIND).toBe("deliverable_extracted")
    expect(DELIVERABLE_PATH_PREFIX).toBe("shared/deliverables/")
  })

  it("MUTATION: deliverable-kind stays prisma-free (client-safe)", () => {
    const src = readFileSync(resolve("src/lib/artifacts/deliverable-kind.ts"), "utf8")
    expect(src).not.toContain("@/lib/db")
    expect(src).not.toContain("@prisma")
    expect(src).not.toContain("from \"@/lib/artifacts/extract-deliverables\"")
  })

  it("MUTATION: client chat surfaces do not import extract-deliverables", () => {
    const clients = [
      "src/app/dashboard/[workspaceId]/page.tsx",
      "src/components/dashboard/chat-panel.tsx",
      "src/components/dashboard/document-card.tsx",
      "src/lib/artifacts/approval-version.ts",
    ]
    for (const rel of clients) {
      const src = readFileSync(resolve(rel), "utf8")
      expect(src, rel).not.toContain("@/lib/artifacts/extract-deliverables")
    }
  })
})
