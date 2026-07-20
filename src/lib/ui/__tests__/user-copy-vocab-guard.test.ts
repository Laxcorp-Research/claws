/**
 * Batch C+H class-8 copy guard: banned vendor/internal vocabulary must not
 * appear in user-facing UI string files. /admin surfaces are exempt.
 * MUTATION: reintroduce "Composio" in a listed user string → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

/** UI surfaces that render copy to end users (non-admin). */
const USER_FACING_FILES = [
  "src/components/setup/browse-tools-modal.tsx",
  "src/components/dashboard/conversations-section.tsx",
  "src/components/dashboard/redeploy-progress-modal.tsx",
  "src/app/dashboard/[workspaceId]/page.tsx",
  "src/app/setup/[workspaceId]/step/[n]/page.tsx",
  "src/app/publish/template/page.tsx",
  "src/app/publish/skill/page.tsx",
  "src/app/store/page.tsx",
  "src/app/store/skills/[slug]/page.tsx",
  "src/app/store/[slug]/page.tsx",
  "src/components/marketplace/trust-badge.tsx",
  "src/components/builder/marketplace-skills-modal.tsx",
  "src/data/tool-catalog.ts",
] as const

const BANNED: Array<{ name: string; pattern: RegExp }> = [
  { name: "Composio", pattern: /\bComposio\b/ },
  { name: "curated", pattern: /\bcurated\b/i },
  { name: "gateway", pattern: /\bgateway\b/i },
  { name: "snapshot", pattern: /\bsnapshot\b/i },
  { name: "sandbox-queue", pattern: /sandbox[-\s]?queue/i },
  // Marketplace honesty: no user-facing "sandbox" vetting claims while L2 is absent.
  { name: "sandbox", pattern: /\bsandbox\b/i },
]

function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s.+?;?\s*$/gm, "")
}

/** Discord product UI label — not our runtime "gateway" jargon. */
const ALLOWED_LITERAL_SUBSTRINGS = ["Privileged Gateway Intents"] as const

function userStringHits(src: string): string[] {
  const body = stripCommentsAndImports(src)
  // Quoted / template literals only — prop names like composioOAuthAvailable stay out.
  const literals = body.match(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? []
  const hits: string[] = []
  for (const lit of literals) {
    if (ALLOWED_LITERAL_SUBSTRINGS.some((ok) => lit.includes(ok))) continue
    for (const ban of BANNED) {
      if (ban.pattern.test(lit)) {
        hits.push(`${ban.name}: ${lit.slice(0, 120)}`)
      }
    }
  }
  return hits
}

describe("user-facing copy vocab guard (Batch C+H)", () => {
  it("banned vocabulary is absent from user-facing string files", () => {
    const failures: string[] = []
    for (const rel of USER_FACING_FILES) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      for (const hit of userStringHits(src)) {
        failures.push(`${rel} → ${hit}`)
      }
    }
    expect(failures, failures.join("\n")).toEqual([])
  })

  it('MUTATION: reintroduce "Composio" in browse subtitle → fail', () => {
    const browse = readFileSync(
      join(ROOT, "src/components/setup/browse-tools-modal.tsx"),
      "utf8",
    )
    expect(browse).not.toMatch(/Composio catalog/i)
    expect(browse).not.toMatch(/Curated list first/i)
    // Guard the positive user-facing copy we ship.
    expect(browse).toContain("tools available to connect")
  })
})
