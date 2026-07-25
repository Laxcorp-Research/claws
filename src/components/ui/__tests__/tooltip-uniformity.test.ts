/**
 * PR-A: native title= residuals migrated; DS arrow + viewport boundary pinned.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

const MIGRATED_SITES: Array<{ file: string; mustImport: string; forbiddenTitle: RegExp }> = [
  {
    file: "src/components/dashboard/activity-log-entry.tsx",
    mustImport: "@/components/ui/tooltip",
    forbiddenTitle: /title=\{expanded \?/,
  },
  {
    file: "src/app/admin/versions/page.tsx",
    mustImport: "@/components/ui/tooltip",
    forbiddenTitle: /title="Edit version"/,
  },
  {
    file: "src/components/setup/tool-row.tsx",
    mustImport: "@/components/ui/tooltip",
    forbiddenTitle: /title="Dismiss recommended tool"/,
  },
  {
    file: "src/components/builder/markdown-editor.tsx",
    mustImport: "@/components/ui/tooltip",
    forbiddenTitle: /title=\{`Expand \$\{label\}`\}/,
  },
  {
    file: "src/components/credits/usage-recent-table.tsx",
    mustImport: "@/components/ui/truncate-with-tooltip",
    forbiddenTitle: /title=\{/,
  },
]

describe("tooltip uniformity (PR-A)", () => {
  it("DS Tooltip uses viewport collisionBoundary + 10×5 arrow", () => {
    const src = read("src/components/ui/tooltip.tsx")
    expect(src).toContain("document.documentElement")
    expect(src).toContain("collisionBoundary={collisionBoundary}")
    expect(src).toContain("width={10}")
    expect(src).toContain("height={5}")
    // MUTATION: revert to 8×4 or strip collisionBoundary → fail.
    expect(src).not.toMatch(/width=\{8\}/)
    expect(src).not.toMatch(/height=\{4\}/)
  })

  it("each migrated site uses DS tip and has no DOM title= residual", () => {
    for (const site of MIGRATED_SITES) {
      const src = read(site.file)
      expect(src, site.file).toContain(site.mustImport)
      expect(src, `${site.file} still has title=`).not.toMatch(site.forbiddenTitle)
    }
  })

  it("SkillCard name uses TruncateWithTooltip; description stays multi-line allowlist", () => {
    const src = read("src/components/marketplace/skill-card.tsx")
    expect(src).toContain("TruncateWithTooltip")
    expect(src).toContain("truncate-allowlist: multi-line skill description")
  })
})
