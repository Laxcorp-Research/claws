import { describe, it, expect } from "vitest"
import { TOOL_SPECIFIC_SKILLS } from "../../../../prisma/seed-data/skills-tool-specific"
import { OAUTH_TOOLS, getToolBySlug } from "@/data/tool-catalog"

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
 *   4. OAUTH_COMPOSIO seed bodies may only reference the three runtime-
 *      injected `$COMPOSIO_*` env vars — any other `$FOO_API_KEY`-style
 *      reference would imply an env var the runtime never sets and is
 *      banned (regression guard on PR #4). See PR #4 Commit 1 (generator
 *      OAuth emission) + Commit 2 (deployer container-env injection) for
 *      where the three allowlisted vars are populated.
 */

// Matches `$SOME_VAR_NAME` — has to start uppercase to avoid matching
// shell positional args or `${...}` template snippets that happen to
// appear in docs. Not a perfect regex; tightened by per-test allowlists.
const ENVVAR_REGEX = /\$[A-Z][A-Z0-9_]+/g

/**
 * $ENVVAR names the runtime legitimately injects into OAUTH_COMPOSIO
 * skill bodies. PR #4 Commit 1 emits the per-skill triple into
 * openclaw.json > skills.entries[slug].env; Commit 2 pins the first two
 * at container-env level (defense in depth — the third is per-tool and
 * therefore only per-skill). Seed bodies may reference any of these as
 * `$COMPOSIO_API_KEY` / `$COMPOSIO_USER_ID` / `$COMPOSIO_CONNECTED_ACCOUNT_ID`.
 * Any OTHER `$ENVVAR` ref in an OAUTH_COMPOSIO body is a bug because the
 * runtime never sets those vars for OAuth tools.
 */
const COMPOSIO_INJECTED_VARS: ReadonlySet<string> = new Set([
  "COMPOSIO_API_KEY",
  "COMPOSIO_USER_ID",
  "COMPOSIO_CONNECTED_ACCOUNT_ID",
])

/**
 * Returns the `$ENVVAR` refs in `body` that are NOT in the Composio
 * allowlist. Shared by the seed-data invariant test below and the two
 * regex/allowlist unit tests that guard the allowlist logic itself.
 * Empty array = body has only allowed refs (or none at all).
 */
function findDisallowedEnvRefsInOauthBody(body: string): string[] {
  const refs = [...new Set(body.match(ENVVAR_REGEX) ?? [])]
  return refs.filter((r) => !COMPOSIO_INJECTED_VARS.has(r.slice(1)))
}

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

  it("no seed body begins with a YAML frontmatter block (generator builds it from catalog)", () => {
    // Per PR #3a commit 0d21133, the generator emits authoritative
    // frontmatter from Prisma columns + tool catalog. Seed-side frontmatter
    // in `skillMd` bodies gets stripped at emit time, so leaving it in the
    // seed source is dead weight + misleading to readers. Commit 3 of
    // PR #3b removed it from every seed; this test prevents re-introduction.
    const offenders: string[] = []
    for (const skill of TOOL_SPECIFIC_SKILLS) {
      if (/^---\r?\n/.test(skill.skillMd)) {
        offenders.push(skill.slug)
      }
    }
    expect(
      offenders,
      `seeds have a leading YAML frontmatter block in skillMd (should be stripped): ${offenders.join(", ")}`,
    ).toEqual([])
  })

  it("OAUTH_COMPOSIO seed bodies reference only the 3 runtime-injected $COMPOSIO_* env vars", () => {
    // Pre-PR #4, this test banned ALL $ENVVAR refs in OAuth bodies (Composio
    // tokens were expected to arrive as `<OAUTH_TOKEN>` placeholders, not env
    // vars). PR #4 changed the contract: the runtime now injects three
    // COMPOSIO_* vars, and OAuth skill bodies are expected to read them.
    // Everything ELSE is still banned — no $HUBSPOT_API_KEY, no $GITHUB_TOKEN,
    // etc. in an OAUTH_COMPOSIO body.
    type OauthLeak = { skillSlug: string; disallowed: string[] }
    const leaks: OauthLeak[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool || tool.connectionType !== "OAUTH_COMPOSIO") continue

      const disallowed = findDisallowedEnvRefsInOauthBody(skill.skillMd)
      if (disallowed.length > 0) {
        leaks.push({ skillSlug: skill.slug, disallowed })
      }
    }

    expect(
      leaks,
      `OAUTH_COMPOSIO seed bodies reference env vars the runtime does not inject. Only $COMPOSIO_API_KEY, $COMPOSIO_USER_ID, $COMPOSIO_CONNECTED_ACCOUNT_ID are allowed:\n${leaks.map((l) => `  ${l.skillSlug}: ${l.disallowed.join(", ")}`).join("\n")}`,
    ).toEqual([])
  })

  // ------------------------------------------------------------------------
  // Allowlist-logic unit tests (PR #4 Commit 4)
  //
  // Purpose: guard the allowlist check itself (the regex + the 3-var Set),
  // so a future edit that accidentally widens or narrows the allowlist
  // fails loud in tests rather than only at seed-review time. These tests
  // run against synthetic bodies, not the actual seed data — no seed in
  // the repo has `$COMPOSIO_*` refs yet (that lands in PR #4 Commit 6's
  // skillMd rewrites) and no live OAuth seed still has the pre-PR #4
  // `$HUBSPOT_API_KEY`-style refs (Commit 1 removed the 4 dead tools).
  // ------------------------------------------------------------------------

  it("allowlist passes: an OAuth body with only $COMPOSIO_* refs has zero disallowed refs", () => {
    // This is the exact shape PR #4 Commit 6's rewritten OAuth seeds will
    // use. `tools.execute` with x-api-key + user_id + connected_account_id.
    const syntheticOauthBody = `
## Authentication
This skill calls Composio's REST endpoint at runtime using three env vars
the runtime injects (per PR #4). No OAuth tokens live in this container.

\`\`\`bash
curl -X POST "https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL" \\
  -H "x-api-key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d "{\\"user_id\\":\\"$COMPOSIO_USER_ID\\",\\"connected_account_id\\":\\"$COMPOSIO_CONNECTED_ACCOUNT_ID\\",\\"arguments\\":{\\"recipient_email\\":\\"foo@bar.com\\"}}"
\`\`\`
`
    const disallowed = findDisallowedEnvRefsInOauthBody(syntheticOauthBody)
    expect(
      disallowed,
      `body references only allowlisted COMPOSIO_* vars but findDisallowedEnvRefsInOauthBody flagged some as disallowed`,
    ).toEqual([])

    // Sanity: the body DOES contain the 3 Composio refs — otherwise the
    // assertion above is vacuously true.
    const allRefs = [...new Set(syntheticOauthBody.match(ENVVAR_REGEX) ?? [])].sort()
    expect(allRefs).toEqual([
      "$COMPOSIO_API_KEY",
      "$COMPOSIO_CONNECTED_ACCOUNT_ID",
      "$COMPOSIO_USER_ID",
    ])
  })

  it("allowlist blocks: an OAuth body with $HUBSPOT_API_KEY or similar direct-token refs is flagged", () => {
    // Regression guard. PR #4 intentionally broadens what's allowed in
    // OAUTH_COMPOSIO bodies to include the 3 Composio vars. This test
    // ensures we did not accidentally allowlist the world — non-Composio
    // direct-token env vars are STILL banned. If this ever passes silently
    // (zero disallowed refs on a body containing $HUBSPOT_API_KEY), the
    // allowlist logic has regressed and a future OAuth seed rewrite could
    // ship with a broken env-var contract without the test catching it.
    const nonComposioSyntheticBodies = [
      `Call HubSpot with $HUBSPOT_API_KEY and $HUBSPOT_PORTAL_ID`,
      `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user`,
      `axios.post(url, {headers: {"x-api-key": $SLACK_API_KEY}})`,
      `// Mixed: legit + illegit. Runtime injects the first; not the second.\n` +
        `curl ... -H "x-api-key: $COMPOSIO_API_KEY" -H "x-hubspot-key: $HUBSPOT_API_KEY"`,
    ]

    for (const body of nonComposioSyntheticBodies) {
      const disallowed = findDisallowedEnvRefsInOauthBody(body)
      expect(
        disallowed.length,
        `body "${body.slice(0, 80).replace(/\n/g, " ")}..." should have been flagged as disallowed`,
      ).toBeGreaterThan(0)
    }

    // Assert the specific ban on $HUBSPOT_API_KEY for the most likely
    // regression path (someone pastes a pre-PR #3 curl example into an
    // OAuth seed). Named assertion keeps the failure message readable.
    const hubspotBody = `curl -H "x-api-key: $HUBSPOT_API_KEY"`
    expect(findDisallowedEnvRefsInOauthBody(hubspotBody)).toEqual(["$HUBSPOT_API_KEY"])
  })

  // ------------------------------------------------------------------------
  // OAuth body content invariants (PR #4 Commit 5)
  //
  // These three assertions guard against "forgot to rewrite" and "pasted
  // generic template" classes of bug across all OAUTH_COMPOSIO seeds:
  //
  //  1. Every OAuth body must reference Composio's execute endpoint — either
  //     as the literal path `/api/v3/tools/execute/` or the SDK call
  //     `composio.tools.execute` (we accept either for forward-compat).
  //  2. Every OAuth body must reference at least one toolkit-specific tool
  //     name using the uppercase composio slug as prefix (e.g., `GMAIL_*`,
  //     `GITHUB_*`). Catches bodies that were rewritten with the generic
  //     template but never customized with per-toolkit operations.
  //  3. Each of the 4 OAuth skills added in this PR (gmail, google_calendar,
  //     github, twitter) must have both a catalog entry AND a seed row in
  //     lockstep — if one side is removed without the other, the test fails.
  //
  // Test #5 (the $ENVVAR allowlist) runs first and catches different
  // regressions. These three stack on top of it.
  // ------------------------------------------------------------------------

  it("every OAUTH_COMPOSIO seed body references Composio's tools.execute endpoint", () => {
    type Miss = { skillSlug: string; toolSlug: string }
    const misses: Miss[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool || tool.connectionType !== "OAUTH_COMPOSIO") continue

      const hasEndpoint =
        skill.skillMd.includes("/api/v3/tools/execute/") ||
        skill.skillMd.includes("composio.tools.execute")
      if (!hasEndpoint) {
        misses.push({ skillSlug: skill.slug, toolSlug })
      }
    }

    expect(
      misses,
      `OAUTH_COMPOSIO seed bodies missing Composio execute reference (expected /api/v3/tools/execute/ or composio.tools.execute literal):\n${misses.map((m) => `  ${m.skillSlug} (-> ${m.toolSlug})`).join("\n")}`,
    ).toEqual([])
  })

  it("every OAUTH_COMPOSIO seed body references at least one toolkit-prefixed tool name", () => {
    // Map catalog slug → expected tool-name prefix in the body. The prefix
    // is derived from the composioToolkitId (not the catalog slug) because
    // Composio's tool names are prefixed with the toolkit id uppercased.
    // Two drift-corrected cases: `google_calendar` → `GOOGLECALENDAR_`
    // (no underscore in Composio slug); `convertkit` → `KIT_` (vendor rebrand).
    type Miss = { skillSlug: string; toolSlug: string; expectedPrefix: string }
    const misses: Miss[] = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      const toolSlug = skill.compatibleTools[0]
      if (!toolSlug) continue
      const tool = getToolBySlug(toolSlug)
      if (!tool || tool.connectionType !== "OAUTH_COMPOSIO") continue
      if (!tool.composioToolkitId) continue

      // Composio tool names are prefixed with the toolkit id uppercased
      // + underscore. GA uses an underscore-bearing id (`google_analytics`)
      // which uppercases fine; others are single-token so the prefix is
      // trivial.
      const prefix = tool.composioToolkitId.toUpperCase() + "_"

      if (!skill.skillMd.includes(prefix)) {
        misses.push({ skillSlug: skill.slug, toolSlug, expectedPrefix: prefix })
      }
    }

    expect(
      misses,
      `OAUTH_COMPOSIO seed bodies missing at least one tool-name literal starting with expected toolkit prefix:\n${misses.map((m) => `  ${m.skillSlug} (-> ${m.toolSlug}): expected prefix ${m.expectedPrefix}`).join("\n")}`,
    ).toEqual([])
  })

  it("4 new OAuth skills (gmail, google_calendar, github, twitter) have both a catalog entry AND a seed row — lockstep", () => {
    // If either side is removed without the other, this test surfaces the
    // drift immediately. The 4 skills were added in PR #4 Commit 5 to fill
    // the gap left by the OAuth catalog entries that previously had no
    // matching compatibleTools skill row.
    const NEW_OAUTH_SKILL_TOOLS = ["gmail", "google_calendar", "github", "twitter"] as const

    type Miss = { toolSlug: string; hasCatalogEntry: boolean; hasSeedRow: boolean }
    const misses: Miss[] = []

    for (const toolSlug of NEW_OAUTH_SKILL_TOOLS) {
      const catalogEntry = OAUTH_TOOLS.find((t) => t.slug === toolSlug)
      const seedRow = TOOL_SPECIFIC_SKILLS.find((s) => s.compatibleTools.includes(toolSlug))

      const hasCatalogEntry = Boolean(catalogEntry)
      const hasSeedRow = Boolean(seedRow)

      if (!hasCatalogEntry || !hasSeedRow) {
        misses.push({ toolSlug, hasCatalogEntry, hasSeedRow })
      }
    }

    expect(
      misses,
      `catalog/seed lockstep broken for newly-added OAuth skills:\n${misses.map((m) => `  ${m.toolSlug}: catalog=${m.hasCatalogEntry} seed=${m.hasSeedRow}`).join("\n")}`,
    ).toEqual([])
  })
})

