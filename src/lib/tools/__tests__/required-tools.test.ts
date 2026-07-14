/**
 * Finding F — required-tool satisfaction (deploy gate + Step 2 shared truth).
 *
 * MUTATION contracts (must fail if someone regresses the fix):
 *   - Flip PENDING acceptance off → founder repro no longer passes.
 *   - Drop isAIProvider filter → anthropic_api re-blocks the repro fixture.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  connectionSatisfiesRequired,
  filterNonAiProviderRequiredEntries,
  isAiProviderSlug,
  isCredentialedKeyPending,
  missingRequiredToolsBannerTitle,
  MISSING_REQUIRED_TOOLS_BANNER_BODY,
  REQUIRED_TOOLS_SECTION_SUBTITLE,
  requiredToolsSatisfied,
  unverifiedToolsInfoLine,
  type RequiredToolConnection,
  type RequiredToolEntry,
} from "@/lib/tools/required-tools"

const UNVERIFIED =
  "Connected but not verified — will be tested on first use."

const TWITTER_GROWTH_REQUIRED: RequiredToolEntry[] = [
  { slug: "anthropic_api", name: "Anthropic (Claude)" },
  { slug: "twitter-api", name: "Twitter/X API" },
]

/** Mirrors staging founder cmrbpav2i… — credentialed PENDING twitter, zero anthropic rows. */
const FOUNDER_CONNECTIONS: RequiredToolConnection[] = [
  {
    toolSlug: "twitter-api",
    status: "PENDING",
    connectionType: "API_KEY",
    hasCredentials: true,
    lastError: UNVERIFIED,
  },
]

describe("connectionSatisfiesRequired matrix", () => {
  it("CONNECTED ✓", () => {
    expect(
      connectionSatisfiesRequired({
        toolSlug: "twitter-api",
        status: "CONNECTED",
        connectionType: "API_KEY",
        hasCredentials: true,
      }),
    ).toBe(true)
  })

  it("credentialed-key PENDING-unverified ✓", () => {
    expect(isCredentialedKeyPending(FOUNDER_CONNECTIONS[0])).toBe(true)
    expect(connectionSatisfiesRequired(FOUNDER_CONNECTIONS[0])).toBe(true)
  })

  it("bare PENDING OAuth ✗", () => {
    expect(
      connectionSatisfiesRequired({
        toolSlug: "gmail",
        status: "PENDING",
        connectionType: "OAUTH_COMPOSIO",
        lastError: "waiting",
        hasCredentials: false,
      }),
    ).toBe(false)
  })

  it("ERROR ✗", () => {
    expect(
      connectionSatisfiesRequired({
        toolSlug: "twitter-api",
        status: "ERROR",
        connectionType: "API_KEY",
        hasCredentials: true,
        lastError: "Invalid key",
      }),
    ).toBe(false)
  })

  it("PENDING API_KEY without credentials ✗", () => {
    expect(
      connectionSatisfiesRequired({
        toolSlug: "twitter-api",
        status: "PENDING",
        connectionType: "API_KEY",
        hasCredentials: false,
        lastError: UNVERIFIED,
      }),
    ).toBe(false)
  })
})

describe("AI-provider exclusion", () => {
  it("marks anthropic_api as AI provider; twitter-api is not", () => {
    expect(isAiProviderSlug("anthropic_api")).toBe(true)
    expect(isAiProviderSlug("twitter-api")).toBe(false)
  })

  it("filters anthropic_api out of the gated required set", () => {
    const gated = filterNonAiProviderRequiredEntries(TWITTER_GROWTH_REQUIRED)
    expect(gated.map((e) => e.slug)).toEqual(["twitter-api"])
  })
})

describe("requiredToolsSatisfied — founder repro (cmrbpav2i…)", () => {
  it("PASSES the gate with credentialed PENDING twitter + zero anthropic rows", () => {
    const gated = filterNonAiProviderRequiredEntries(TWITTER_GROWTH_REQUIRED)
    const result = requiredToolsSatisfied(gated, FOUNDER_CONNECTIONS)
    expect(result.satisfied).toBe(true)
    expect(result.missingSlugs).toEqual([])
    expect(result.unverifiedCount).toBe(1)
  })

  it("MUTATION source lock: connectionSatisfiesRequired accepts credentialed PENDING", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/tools/required-tools.ts"),
      "utf8",
    )
    // If PENDING acceptance is removed from connectionSatisfiesRequired, this fails.
    expect(source).toMatch(
      /export function connectionSatisfiesRequired[\s\S]*return isCredentialedKeyPending\(conn\)/,
    )
  })

  it("MUTATION: without PENDING acceptance the founder fixture fails the gate", () => {
    // Simulate pre-fix CONNECTED-only predicate against the same fixture.
    const connectedOnly = FOUNDER_CONNECTIONS.some((c) => c.status === "CONNECTED")
    expect(connectedOnly).toBe(false)
    // Lock the real predicate still accepts PENDING — if flipped, this fails.
    expect(connectionSatisfiesRequired(FOUNDER_CONNECTIONS[0])).toBe(true)
  })

  it("MUTATION: dropping isAIProvider filter re-blocks the founder fixture", () => {
    const withoutFilter = requiredToolsSatisfied(TWITTER_GROWTH_REQUIRED, FOUNDER_CONNECTIONS)
    expect(withoutFilter.satisfied).toBe(false)
    expect(withoutFilter.missingSlugs).toContain("anthropic_api")
    // With filter applied, same connections pass.
    const withFilter = requiredToolsSatisfied(
      filterNonAiProviderRequiredEntries(TWITTER_GROWTH_REQUIRED),
      FOUNDER_CONNECTIONS,
    )
    expect(withFilter.satisfied).toBe(true)
  })

  it("MUTATION source lock: gate filters AI providers and uses requiredToolsSatisfied", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    expect(page).toContain("filterNonAiProviderRequiredEntries")
    expect(page).toContain("requiredToolsSatisfied")
    expect(page).not.toMatch(
      /connection\.status === ["']CONNECTED["']\s*\)/,
    )
  })
})

describe("gate copy helpers", () => {
  it("names a single missing tool in the blocker title", () => {
    expect(missingRequiredToolsBannerTitle(["Twitter/X API"])).toBe(
      "Connect Twitter/X API before deployment",
    )
  })

  it("lists multiple missing tools in the blocker title", () => {
    expect(missingRequiredToolsBannerTitle(["Twitter/X API", "Tavily"])).toBe(
      "Connect required tools before deployment: Twitter/X API, Tavily",
    )
  })

  it("emits unverified info only when count > 0", () => {
    expect(unverifiedToolsInfoLine(0)).toBeNull()
    expect(unverifiedToolsInfoLine(1)).toBe("1 tool will be verified on first use.")
    expect(unverifiedToolsInfoLine(2)).toBe("2 tools will be verified on first use.")
  })

  it("locks UX rider + banner body strings", () => {
    expect(REQUIRED_TOOLS_SECTION_SUBTITLE).toBe(
      "Required for this template — you can add anything else via Browse or Custom API",
    )
    expect(MISSING_REQUIRED_TOOLS_BANNER_BODY).toBe(
      "Go back to Tools and connect the required services for this Claw.",
    )
  })
})
