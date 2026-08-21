// Drift guards for src/data/tool-catalog.ts.
//
// Three invariants enforced here after PR2.8a:
//
//   1. `ALL_TOOL_SLUGS` stays in lockstep with `ALL_TOOLS`. The hand-
//      maintained slug list exists because TypeScript can't derive a literal
//      union from `ToolDefinition[]`; the test fails loudly if a new entry
//      lands in one without the other.
//
//   2. Every `composioToolkitId` the catalog ships is present in the
//      checked-in fixture `src/data/__fixtures__/composio-toolkit-allowlist.txt`.
//      The fixture is the contract. If Composio renames or drops a toolkit,
//      the next dump-and-diff surfaces the change as a fixture modification
//      for a human to review rather than a silent runtime 404 at
//      `composio.toolkits.get(slug)`.
//
//   3. Every slug is unique.
//
// Historical GH #27 / #28 drift-migration tests were removed with PR2.8a
// Task 9 - templates now reference catalog slugs directly via `ToolSlug`,
// so the rename-migration harness has no surface area left to guard.
//
// Mutation test procedure (run manually after modifying any OAUTH_COMPOSIO
// entry's composioToolkitId):
//   1. Temporarily change one catalog composioToolkitId to a fake string
//      (e.g. "definitely-not-a-real-toolkit").
//   2. Run `npm test -- tool-catalog-slug-drift`. Confirm FAIL with a
//      message naming the unknown toolkit.
//   3. Restore the real composioToolkitId.
//   4. Run again. Confirm PASS.
//   Operator runs this once per session that modifies Composio catalog
//   entries.

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ALL_TOOLS, ALL_TOOL_SLUGS } from "@/data/tool-catalog"
import { TOOL_SPECIFIC_SKILLS } from "../../../prisma/seed-data/skills-tool-specific"

// Post-PR2.8a: no orphans. Every skill.compatibleTools slug is either in
// the catalog or tracked as a comingSoon placeholder. Empty allowlist.
const KNOWN_ORPHAN_COMPATIBLE_TOOLS = new Set<string>([])

function loadComposioToolkitAllowlist(): Set<string> {
  const fixturePath = path.resolve(
    __dirname,
    "..",
    "__fixtures__",
    "composio-toolkit-allowlist.txt",
  )
  const content = readFileSync(fixturePath, "utf8")
  return new Set(
    content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#")),
  )
}

describe("tool catalog slug-drift guards (PR2.8a)", () => {
  it("ALL_TOOL_SLUGS is in sync with ALL_TOOLS", () => {
    const catalogSlugs = [...ALL_TOOLS.map((t) => t.slug)].sort()
    const listSlugs = [...ALL_TOOL_SLUGS].sort()
    expect(
      catalogSlugs,
      `ALL_TOOL_SLUGS is out of sync with ALL_TOOLS. Add the new catalog slug to the ALL_TOOL_SLUGS array in src/data/tool-catalog.ts so ToolSlug can include it.`,
    ).toEqual(listSlugs)
  })

  it("every catalog slug is unique", () => {
    const slugs = ALL_TOOLS.map((t) => t.slug)
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
    expect(dupes, `Duplicate catalog slugs: ${dupes.join(", ")}`).toHaveLength(0)
  })

  it("every OAUTH_COMPOSIO entry's composioToolkitId is in the Composio allowlist fixture", () => {
    const allowlist = loadComposioToolkitAllowlist()
    const missing: Array<{ slug: string; toolkitId: string }> = []
    for (const tool of ALL_TOOLS) {
      if (tool.connectionType !== "OAUTH_COMPOSIO") continue
      const toolkitId = tool.composioToolkitId
      if (!toolkitId) {
        // OAUTH_COMPOSIO without composioToolkitId is itself a bug - covered
        // by a separate invariant below.
        continue
      }
      if (!allowlist.has(toolkitId)) {
        missing.push({ slug: tool.slug, toolkitId })
      }
    }
    expect(
      missing,
      `Catalog references Composio toolkit(s) not in the allowlist fixture:\n${missing
        .map((m) => `  ${m.slug} -> composioToolkitId="${m.toolkitId}"`)
        .join(
          "\n",
        )}\nEither (a) update src/data/__fixtures__/composio-toolkit-allowlist.txt after verifying the toolkit exists on Composio, or (b) remove the stale entry from the catalog.`,
    ).toEqual([])
  })

  it("every allowlisted Composio toolkit is used by at least one catalog entry", () => {
    const allowlist = loadComposioToolkitAllowlist()
    const usedToolkitIds = new Set(
      ALL_TOOLS.filter((t) => t.connectionType === "OAUTH_COMPOSIO" && t.composioToolkitId).map(
        (t) => t.composioToolkitId!,
      ),
    )
    const stale: string[] = []
    for (const toolkitId of allowlist) {
      if (!usedToolkitIds.has(toolkitId)) stale.push(toolkitId)
    }
    expect(
      stale,
      `Composio allowlist fixture has stale entries (no catalog tool uses them): ${stale.join(
        ", ",
      )}\nRemove from src/data/__fixtures__/composio-toolkit-allowlist.txt.`,
    ).toEqual([])
  })

  it("every OAUTH_COMPOSIO catalog entry declares a composioToolkitId", () => {
    const missing = ALL_TOOLS.filter(
      (t) => t.connectionType === "OAUTH_COMPOSIO" && !t.composioToolkitId,
    ).map((t) => t.slug)
    expect(
      missing,
      `OAUTH_COMPOSIO catalog entries missing composioToolkitId: ${missing.join(", ")}`,
    ).toEqual([])
  })

  // PR2.9-fix1: every OAUTH_COMPOSIO entry must declare authMode so the
  // wizard + Browse modal can render the correct connect-button label at
  // first paint (no per-tool server round-trip). If you add a new
  // OAUTH_COMPOSIO entry, run `--byok-eligibility <slug>` against staging
  // Composio and set authMode based on the result:
  //   managedSchemes non-empty       → "managed-oauth"
  //   managedSchemes empty + API_KEY → "byok-api-key"
  //   managedSchemes empty + no API_KEY → "custom-oauth-required"
  //                                        (entry should also be comingSoon)
  it("every OAUTH_COMPOSIO catalog entry declares authMode", () => {
    const missing = ALL_TOOLS.filter(
      (t) => t.connectionType === "OAUTH_COMPOSIO" && !t.authMode,
    ).map((t) => t.slug)
    expect(
      missing,
      `OAUTH_COMPOSIO catalog entries missing authMode. Add the field per the audit at scripts/pr2.8a-composio-authconfig-probe.mjs --byok-eligibility:\n${missing
        .map((s) => `  ${s}`)
        .join("\n")}`,
    ).toEqual([])
  })

  // Defense: custom-oauth-required entries should also be comingSoon
  // (we can't connect them today; the catalog flag keeps them out of the
  // wizard render). If an operator drops comingSoon on twitter/docusign
  // without registering a custom OAuth app first, this test catches it.
  it("every custom-oauth-required entry is also comingSoon", () => {
    const violations = ALL_TOOLS.filter(
      (t) => t.connectionType === "OAUTH_COMPOSIO" && t.authMode === "custom-oauth-required" && !t.comingSoon,
    ).map((t) => t.slug)
    expect(
      violations,
      `custom-oauth-required entries must also be comingSoon (no functional connect path exists for them today):\n${violations
        .map((s) => `  ${s}`)
        .join("\n")}`,
    ).toEqual([])
  })

  it("every seed compatibleTools entry resolves in the catalog", () => {
    const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
    const unknown: Array<{ skillSlug: string; toolSlug: string }> = []
    for (const skill of TOOL_SPECIFIC_SKILLS) {
      for (const toolSlug of skill.compatibleTools) {
        if (catalogSlugs.has(toolSlug)) continue
        if (KNOWN_ORPHAN_COMPATIBLE_TOOLS.has(toolSlug)) continue
        unknown.push({ skillSlug: skill.slug, toolSlug })
      }
    }
    expect(
      unknown,
      `Seed compatibleTools reference unknown slugs (not in catalog, not in known-orphan allowlist):\n${unknown
        .map((u) => `  ${u.skillSlug} -> ${u.toolSlug}`)
        .join("\n")}`,
    ).toEqual([])
  })
})
