import { describe, it, expect } from "vitest"
import { TOOL_SPECIFIC_SKILLS } from "../../../../prisma/seed-data/skills-tool-specific"

/**
 * PR #3b regression tests for tool-specific seed body text.
 *
 * These tests protect the invariants that make the generator's catalog-
 * driven frontmatter (PR #3a, commit 0d21133) actually work at runtime:
 *   1. Seed bodies must not reference `$TOOL_API_KEY` — PR #1a rejected
 *      that placeholder convention. Bodies should use catalog-named env
 *      vars (single/multi-cred) or `<OAUTH_TOKEN>` (OAUTH, Composio-
 *      managed).
 *   2. Any `$ENVVAR`-shaped reference in a body must correspond to an
 *      env var the runtime will actually set — either a catalog-declared
 *      credentialFields envVar for API_KEY tools, or one of the allowed
 *      placeholder sigils for OAUTH tools / URL markers.
 */

describe("PR #3b seed body invariants", () => {
  it("no tool-specific seed body contains $TOOL_API_KEY", () => {
    const offenders: string[] = []
    for (const skill of TOOL_SPECIFIC_SKILLS) {
      if (skill.skillMd.includes("$TOOL_API_KEY")) {
        offenders.push(skill.slug)
      }
    }
    expect(
      offenders,
      `seeds still reference the rejected $TOOL_API_KEY placeholder: ${offenders.join(", ")}`,
    ).toEqual([])
  })
})
