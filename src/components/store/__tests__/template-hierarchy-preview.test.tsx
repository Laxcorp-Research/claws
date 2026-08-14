// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CREATOR_TEMPLATES } from "../../../../prisma/seed-data/creator-templates"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"
import { STORE_HIERARCHY_LEGEND } from "@/lib/marketplace/template-hierarchy"
import { TemplateHierarchyPreview } from "@/components/store/template-hierarchy-preview"

afterEach(() => {
  cleanup()
})

function twitterSnapshot(): unknown {
  const twitter = CREATOR_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")
  if (!twitter) throw new Error("twitter-growth-machine seed missing")
  return JSON.parse(buildWorkspaceSnapshotFromSeedTemplate(twitter))
}

describe("TemplateHierarchyPreview", () => {
  it("seeded Twitter/X snapshot renders 1 orch + 4 workers + dotted critic", () => {
    render(<TemplateHierarchyPreview snapshot={twitterSnapshot()} />)

    const root = screen.getByTestId("template-hierarchy-preview")
    expect(root.querySelectorAll('[data-hierarchy-role="ORCHESTRATOR"]')).toHaveLength(1)
    expect(root.querySelectorAll('[data-hierarchy-role="WORKER"]')).toHaveLength(4)
    expect(root.querySelectorAll('[data-hierarchy-role="CRITIC"]')).toHaveLength(1)
    expect(screen.getByText("Twitter Commander")).toBeDefined()
    expect(screen.getByText("Trend & Topic Scout")).toBeDefined()
    expect(screen.getByText("Content Writer")).toBeDefined()
    expect(screen.getByText("Engagement Strategist")).toBeDefined()
    expect(screen.getByText("Analytics & Growth Tracker")).toBeDefined()
    expect(screen.getByText("Social Content Reviewer")).toBeDefined()
    expect(root.querySelectorAll('[data-edge="solid"]').length).toBeGreaterThan(0)
    const dotted = root.querySelectorAll('[data-edge="dotted"]')
    expect(dotted.length).toBeGreaterThan(0)
    expect([...dotted].every((el) => el.getAttribute("stroke-dasharray") === "4 3")).toBe(true)
    expect(screen.getByText(STORE_HIERARCHY_LEGEND)).toBeDefined()
  })

  it("community-snapshot case (id-keyed connections) renders orch + worker + dotted critic", () => {
    render(
      <TemplateHierarchyPreview
        snapshot={{
          agents: [
            { id: "a-orch", name: "Lead Bot", role: "ORCHESTRATOR", color: "#5BA1F5" },
            { id: "a-work", name: "Scout Bot", role: "WORKER", color: "#8BFCAE" },
            { id: "a-crit", name: "Gate Bot", role: "CRITIC", color: "#A78BFA" },
          ],
          connections: [{ sourceAgentId: "a-orch", targetAgentId: "a-work", condition: "ON_COMPLETE" }],
        }}
      />,
    )

    const root = screen.getByTestId("template-hierarchy-preview")
    expect(root.querySelectorAll('[data-hierarchy-role="ORCHESTRATOR"]')).toHaveLength(1)
    expect(root.querySelectorAll('[data-hierarchy-role="WORKER"]')).toHaveLength(1)
    expect(root.querySelectorAll('[data-hierarchy-role="CRITIC"]')).toHaveLength(1)
    expect(screen.getByText("Lead Bot")).toBeDefined()
    expect(screen.getByText("Scout Bot")).toBeDefined()
    expect(screen.getByText("Gate Bot")).toBeDefined()
    expect(root.querySelectorAll('[data-edge="dotted"]').length).toBeGreaterThan(0)
  })

  it("graceful absence when snapshot is malformed", () => {
    const { container } = render(<TemplateHierarchyPreview snapshot="{not-json" />)
    expect(container.querySelector("[data-testid=template-hierarchy-preview]")).toBeNull()
    cleanup()
    const empty = render(<TemplateHierarchyPreview snapshot={{ agents: [] }} />)
    expect(empty.container.querySelector("[data-testid=template-hierarchy-preview]")).toBeNull()
  })

  it("MUTATION: render pills-only restored → fails", () => {
    const page = readFileSync(join(process.cwd(), "src/app/store/[slug]/page.tsx"), "utf8")
    const preview = readFileSync(
      join(process.cwd(), "src/components/store/template-hierarchy-preview.tsx"),
      "utf8",
    )
    expect(page).toContain("<TemplateHierarchyPreview snapshot={template.workspaceSnapshot}")
    expect(page).toContain("from \"@/components/store/template-hierarchy-preview\"")
    expect(page.indexOf("<TemplateHierarchyPreview")).toBeLessThan(page.indexOf("{template.flowDescription}"))
    expect(page).toContain("AgentPill")
    expect(preview).not.toMatch(/react-flow|ReactFlow/i)
    expect(preview).toContain("data-edge=\"dotted\"")
    expect(preview).toContain("STORE_HIERARCHY_LEGEND")
  })
})
