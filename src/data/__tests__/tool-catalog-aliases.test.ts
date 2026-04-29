// PR2.7: assertions locking the template-display-name -> catalog-slug alias map.
//
// Why: claw-templates.ts references tools by display names (e.g., "Claude API")
// that don't resolve via getToolByName's substring heuristic to the canonical
// catalog entry ("Anthropic (Claude)", slug "anthropic_api"). Every template
// hits Deploy-blocked because of this. The alias map fixes the resolution;
// these tests guard against:
//
//   1. Typos in the alias target (e.g., "anthropic" vs the real slug
//      "anthropic_api") that would let the map land with broken entries.
//   2. Catalog drift that silently breaks an alias target without any
//      test surface catching it.
//   3. Regression of the specific resolutions that PR2.7 was written to
//      fix — "Claude API" must resolve to the AI-provider slug and
//      "Twitter API" must resolve to the single-field Twitter/X entry.
import { describe, it, expect } from "vitest"
import { ALL_TOOLS, TOOL_NAME_ALIASES, getToolByName } from "@/data/tool-catalog"

describe("TOOL_NAME_ALIASES (PR2.7)", () => {
  it("every alias target is a valid catalog slug", () => {
    const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
    const invalid: Array<{ alias: string; target: string }> = []
    for (const [alias, target] of Object.entries(TOOL_NAME_ALIASES)) {
      if (!catalogSlugs.has(target)) invalid.push({ alias, target })
    }
    expect(
      invalid,
      `Alias target(s) not found in ALL_TOOLS: ${invalid
        .map((i) => `"${i.alias}" -> "${i.target}"`)
        .join(", ")}. Either fix the target slug or remove the alias.`,
    ).toHaveLength(0)
  })

  it('"Claude API" resolves to the anthropic_api AI-provider entry', () => {
    const tool = getToolByName("Claude API")
    expect(tool).toBeDefined()
    expect(tool?.slug).toBe("anthropic_api")
    // isAIProvider drives the filter at src/app/setup/[workspaceId]/step/[n]/page.tsx
    // that removes AI-provider rows from Step 2's tool list (they live on
    // Step 1's key-override flow instead). Without this flag being true,
    // the alias would be worthless — Claude API would still appear as a
    // required tool in Step 2.
    expect(tool?.isAIProvider).toBe(true)
  })

  it('"Twitter API" resolves to the twitter-api entry with its single bearer-token field', () => {
    const tool = getToolByName("Twitter API")
    expect(tool).toBeDefined()
    expect(tool?.slug).toBe("twitter-api")
    expect(tool?.connectionType).toBe("API_KEY")
    expect(tool?.credentialFields).toHaveLength(1)
    expect(tool?.credentialFields[0]?.envVar).toBe("TWITTER_API_KEY")
    expect(tool?.credentialFields[0]?.required).toBe(true)
  })

  it("non-aliased names still resolve via the substring fallback", () => {
    // Sanity check: we didn't accidentally break substring matching by
    // adding the alias layer. Tavily has no alias but must still resolve.
    const tavily = getToolByName("Tavily")
    expect(tavily?.slug).toBe("tavily")
  })

  it("unknown names still return undefined (alias doesn't mask failure)", () => {
    // Orphan tool references that have no alias AND no substring match
    // must still fail, so the defensive modal state can fire.
    expect(getToolByName("Typefully")).toBeUndefined()
    expect(getToolByName("DocuSign")).toBeUndefined()
  })
})
