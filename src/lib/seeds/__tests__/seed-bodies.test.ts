import { describe, it, expect } from "vitest"
import { TOOL_SPECIFIC_SKILLS } from "../../../../prisma/seed-data/skills-tool-specific"
import { ALL_TOOLS, getToolBySlug } from "@/data/tool-catalog"

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
 *   3. Multi-cred API_KEY seeds must mention ALL declared envVars in
 *      their bodies (otherwise the agent's self-doc is incomplete for
 *      the secondary credentials).
 *   4. OAUTH_COMPOSIO seed bodies must not contain any `$ENVVAR`-shaped
 *      references — Composio delivers tokens at runtime; `$FOO_API_KEY`
 *      in a body would imply an env var the runtime never sets.
 */

// Matches `$SOME_VAR_NAME` — has to start uppercase to avoid matching
// shell positional args or `${...}` template snippets that happen to
// appear in docs. Not a perfect regex; tightened by per-test allowlists.
const ENVVAR_REGEX = /\$[A-Z][A-Z0-9_]+/g

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

  it("every $ENVVAR ref in an API_KEY seed body exists in that seed's catalog credentialFields", () => {
    type Violation = {
      skillSlug: string
      toolSlug: string
      offending: string
      allowed: string[]
    }
    const violations: Violation[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool) continue
      if (tool.connectionType !== "API_KEY") continue

      const declared = new Set(tool.credentialFields.map((f) => f.envVar))
      const refs = skill.skillMd.match(ENVVAR_REGEX) ?? []
      const uniqueRefs = [...new Set(refs.map((r) => r.slice(1)))]

      for (const varName of uniqueRefs) {
        if (!declared.has(varName)) {
          violations.push({
            skillSlug: skill.slug,
            toolSlug,
            offending: `$${varName}`,
            allowed: [...declared],
          })
        }
      }
    }

    expect(
      violations,
      `API_KEY seed bodies reference envVars not in their catalog credentialFields:\n${violations.map((v) => `  ${v.skillSlug} (-> ${v.toolSlug}): offending=${v.offending}; allowed=[${v.allowed.join(", ")}]`).join("\n")}`,
    ).toEqual([])
  })

  it("multi-cred API_KEY seed bodies reference ALL declared envVars at least once", () => {
    type Miss = { skillSlug: string; toolSlug: string; missing: string[] }
    const misses: Miss[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool || tool.connectionType !== "API_KEY") continue
      if (tool.credentialFields.length < 2) continue // only multi-cred

      const missing = tool.credentialFields
        .map((f) => f.envVar)
        .filter((envVar) => !skill.skillMd.includes(`$${envVar}`))

      if (missing.length > 0) {
        misses.push({ skillSlug: skill.slug, toolSlug, missing })
      }
    }

    expect(
      misses,
      `Multi-cred seed bodies are missing envVar references:\n${misses.map((m) => `  ${m.skillSlug} (${m.toolSlug}): missing [${m.missing.join(", ")}]`).join("\n")}`,
    ).toEqual([])
  })

  it("OAUTH_COMPOSIO seed bodies contain no $ENVVAR references (Composio handles auth)", () => {
    type OauthLeak = { skillSlug: string; refs: string[] }
    const leaks: OauthLeak[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool || tool.connectionType !== "OAUTH_COMPOSIO") continue

      const refs = [...new Set((skill.skillMd.match(ENVVAR_REGEX) ?? []).map((r) => r))]
      if (refs.length > 0) {
        leaks.push({ skillSlug: skill.slug, refs })
      }
    }

    expect(
      leaks,
      `OAUTH_COMPOSIO seed bodies have $ENVVAR refs (should use <OAUTH_TOKEN> or {placeholder} instead):\n${leaks.map((l) => `  ${l.skillSlug}: ${l.refs.join(", ")}`).join("\n")}`,
    ).toEqual([])
  })
})

