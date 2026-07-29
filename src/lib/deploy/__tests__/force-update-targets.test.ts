import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FORCE_UPDATE_CURRENT_STATUSES,
  buildSecurityPatchEmailHtml,
  formatScheduledClawsEmailList,
  selectCurrentDeploymentsPerWorkspace,
  uniqueSortedWorkspaceNames,
} from "@/lib/deploy/force-update-targets"

describe("selectCurrentDeploymentsPerWorkspace", () => {
  it("keeps newest row per workspace (zombie COMPLETED excluded)", () => {
    const rows = [
      { id: "new", workspaceId: "ws-a", startedAt: new Date("2026-07-29T13:44:00Z") },
      { id: "old", workspaceId: "ws-a", startedAt: new Date("2026-07-28T10:00:00Z") },
      { id: "b1", workspaceId: "ws-b", startedAt: new Date("2026-07-20T00:00:00Z") },
    ]
    const current = selectCurrentDeploymentsPerWorkspace(rows)
    expect(current.map((r) => r.id)).toEqual(["new", "b1"])
  })

  it("MUTATION: include-all restored → duplicate workspace ids pass through", () => {
    const rows = [
      { id: "a1", workspaceId: "ws-a" },
      { id: "a2", workspaceId: "ws-a" },
    ]
    const buggy = rows // include-all
    const fixed = selectCurrentDeploymentsPerWorkspace(rows)
    expect(buggy).toHaveLength(2)
    expect(fixed).toHaveLength(1)
    expect(fixed[0]?.id).toBe("a1")
  })
})

describe("security-patch email dedup", () => {
  it("uniqueSortedWorkspaceNames collapses duplicates and sorts", () => {
    expect(
      uniqueSortedWorkspaceNames([
        "WIRE-TEST",
        "Twitter/X Growth Machine (5)",
        "WIRE-TEST",
        "Twitter/X Growth Machine (5)",
      ]),
    ).toEqual(["Twitter/X Growth Machine (5)", "WIRE-TEST"])
  })

  it("formatScheduledClawsEmailList count line + cap + and N more", () => {
    const names = Array.from({ length: 25 }, (_, i) => `Claw ${String(i).padStart(2, "0")}`)
    const formatted = formatScheduledClawsEmailList(names, 20)
    expect(formatted.countLine).toBe("25 Claws scheduled")
    expect(formatted.listItems).toHaveLength(20)
    expect(formatted.overflow).toBe(5)
  })

  it("buildSecurityPatchEmailHtml snapshot: deduped list + count line", () => {
    const html = buildSecurityPatchEmailHtml({
      userName: "Founder",
      version: "2026.5.22-11",
      workspaceNames: [
        "Twitter/X Growth Machine (5)",
        "Twitter/X Growth Machine (5)",
        "Twitter/X Growth Machine (5)",
        "WIRE-TEST",
        "WIRE-TEST",
      ],
      releaseNotes: null,
    })
    expect(html).toContain("2 Claws scheduled")
    expect(html).toContain("<li>Twitter/X Growth Machine (5)</li>")
    expect(html).toContain("<li>WIRE-TEST</li>")
    // Duplicate lis must not appear — unique list is length 2
    expect(html.match(/<li>/g)?.length).toBe(2)
    expect(html).toMatch(/NOT been updated yet/i)
  })
})

describe("force-update route selection contract", () => {
  it("route uses current-per-workspace helper + CURRENT statuses (not bare COMPLETED)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/versions/[id]/force-update/route.ts"),
      "utf8",
    )
    expect(src).toContain("FORCE_UPDATE_CURRENT_STATUSES")
    expect(src).toContain("buildSecurityPatchEmailHtml")
    // MUTATION: restoring include-all (candidateRows without select) → this fails
    expect(src).toMatch(
      /affectedDeployments\s*=\s*selectCurrentDeploymentsPerWorkspace\(candidateRows\)/,
    )
    expect(src).not.toMatch(/where:\s*\{\s*status:\s*['"]COMPLETED['"]/)
    expect(FORCE_UPDATE_CURRENT_STATUSES).toContain("SUPERSEDED")
    expect(FORCE_UPDATE_CURRENT_STATUSES).toContain("COMPLETED")
  })
})
