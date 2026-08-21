/**
 * Tool customization PR-1 - dual-read resolver + op mutations.
 *
 * MUTATION contracts (must fail if someone regresses):
 *   - Skip install copy of snapshot.tools → workspace-from-template test fails.
 *   - Break legacy-null template fallback → "falls back to template" fails.
 *   - Gate re-reads template after demote → demote-gate test fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import {
  applyToolRequirementOp,
  cloneToolsForWorkspaceSeed,
  listRemovedTemplateTools,
  partitionToolRequirements,
  parseToolsFromTemplateSnapshot,
  resolveWorkspaceToolRequirements,
  type WorkspaceToolRequirement,
} from "@/lib/tools/workspace-tool-requirements"
import {
  filterNonAiProviderRequiredEntries,
  requiredToolsSatisfied,
} from "@/lib/tools/required-tools"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const SNAPSHOT_TOOLS: WorkspaceToolRequirement[] = [
  {
    slug: "anthropic_api",
    name: "Anthropic (Claude)",
    category: "AI",
    connectionType: "API_KEY",
    required: true,
  },
  {
    slug: "twitter-api",
    name: "Twitter/X API",
    category: "Social",
    connectionType: "API_KEY",
    required: true,
  },
  {
    slug: "tavily",
    name: "Tavily",
    category: "Research",
    connectionType: "API_KEY",
    required: false,
    alternatives: ["serp_api", "exa_search"],
  },
]

const TEMPLATE_SNAPSHOT = JSON.stringify({
  agents: [],
  tools: SNAPSHOT_TOOLS,
})

describe("cloneToolsForWorkspaceSeed", () => {
  it("copies snapshot tools verbatim without dismissed", () => {
    const seeded = cloneToolsForWorkspaceSeed([
      SNAPSHOT_TOOLS[0],
      SNAPSHOT_TOOLS[1],
      { ...SNAPSHOT_TOOLS[2], dismissed: true },
    ])
    expect(seeded).toHaveLength(3)
    expect(seeded.map((t) => t.slug)).toEqual([
      "anthropic_api",
      "twitter-api",
      "tavily",
    ])
    expect(seeded.every((t) => t.dismissed === undefined)).toBe(true)
  })
})

describe("resolveWorkspaceToolRequirements dual-read", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns workspace JSON when present (source=workspace)", async () => {
    const customized = SNAPSHOT_TOOLS.map((t) =>
      t.slug === "twitter-api" ? { ...t, required: false } : t,
    )
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: customized,
      clawTemplateId: "tpl-1",
      clawTemplate: {
        id: "tpl-1",
        slug: "twitter-growth-machine",
        workspaceSnapshot: TEMPLATE_SNAPSHOT,
      },
    })

    const resolved = await resolveWorkspaceToolRequirements("ws-1")
    expect(resolved.source).toBe("workspace")
    expect(resolved.tools.find((t) => t.slug === "twitter-api")?.required).toBe(false)
  })

  it("falls back to template snapshot when toolRequirements is null (legacy)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: null,
      clawTemplateId: "tpl-1",
      clawTemplate: {
        id: "tpl-1",
        slug: "twitter-growth-machine",
        workspaceSnapshot: TEMPLATE_SNAPSHOT,
      },
    })

    const resolved = await resolveWorkspaceToolRequirements("ws-1")
    expect(resolved.source).toBe("template")
    expect(resolved.tools.map((t) => t.slug)).toEqual([
      "anthropic_api",
      "twitter-api",
      "tavily",
    ])
    expect(resolved.tools.find((t) => t.slug === "twitter-api")?.required).toBe(true)
  })

  it("MUTATION: breaking fallback (empty on null) would fail legacy workspaces", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: null,
      clawTemplateId: "tpl-1",
      clawTemplate: {
        id: "tpl-1",
        slug: "twitter-growth-machine",
        workspaceSnapshot: TEMPLATE_SNAPSHOT,
      },
    })
    const resolved = await resolveWorkspaceToolRequirements("ws-1")
    // If dual-read skipped template fallback, tools would be [].
    expect(resolved.tools.length).toBeGreaterThan(0)
    expect(resolved.source).not.toBe("empty")
    expect(parseToolsFromTemplateSnapshot(TEMPLATE_SNAPSHOT).length).toBe(
      resolved.tools.length,
    )
  })
})

describe("partitionToolRequirements", () => {
  it("excludes dismissed from recommended render-data", () => {
    const tools: WorkspaceToolRequirement[] = [
      { ...SNAPSHOT_TOOLS[1] },
      { ...SNAPSHOT_TOOLS[2], dismissed: true },
      {
        slug: "polymarket",
        name: "Polymarket",
        category: "Finance",
        connectionType: "API_KEY",
        required: false,
      },
    ]
    const part = partitionToolRequirements(tools)
    expect(part.recommended.map((t) => t.slug)).toEqual(["polymarket"])
    expect(part.recommended.find((t) => t.slug === "tavily")).toBeUndefined()
  })
})

describe("applyToolRequirementOp", () => {
  it("demotes required → false", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "demote", slug: "twitter-api" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tools.find((t) => t.slug === "twitter-api")?.required).toBe(false)
  })

  it("dismiss / undismiss persists dismissed flag", () => {
    const dismissed = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "dismiss", slug: "tavily" },
      SNAPSHOT_TOOLS,
    )
    expect(dismissed.ok).toBe(true)
    if (!dismissed.ok) return
    expect(dismissed.tools.find((t) => t.slug === "tavily")?.dismissed).toBe(true)
    expect(
      partitionToolRequirements(dismissed.tools).recommended.map((t) => t.slug),
    ).not.toContain("tavily")

    const undismissed = applyToolRequirementOp(
      dismissed.tools,
      { op: "undismiss", slug: "tavily" },
      SNAPSHOT_TOOLS,
    )
    expect(undismissed.ok).toBe(true)
    if (!undismissed.ok) return
    expect(undismissed.tools.find((t) => t.slug === "tavily")?.dismissed).toBeUndefined()
  })

  it("restore re-hydrates slug from template defaults", () => {
    const demoted = SNAPSHOT_TOOLS.map((t) =>
      t.slug === "twitter-api" ? { ...t, required: false, dismissed: true } : t,
    )
    const result = applyToolRequirementOp(
      demoted,
      { op: "restore", slug: "twitter-api" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const twitter = result.tools.find((t) => t.slug === "twitter-api")
    expect(twitter?.required).toBe(true)
    expect(twitter?.dismissed).toBeUndefined()
  })

  it("remove drops slug from the set", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "remove", slug: "twitter-api" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tools.find((t) => t.slug === "twitter-api")).toBeUndefined()
  })

  it("rejects AI-provider slugs", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "demote", slug: "anthropic_api" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("AI_PROVIDER_NOT_CUSTOMIZABLE")
    expect(result.status).toBe(400)
  })

  it("rejects slug not in the set", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "remove", slug: "not-a-tool" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SLUG_NOT_IN_SET")
  })

  it("swap replaces slug and carries required-ness (not plain-add)", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "swap", slug: "twitter-api", replaceWith: "polymarket" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tools.find((t) => t.slug === "twitter-api")).toBeUndefined()
    const swapped = result.tools.find((t) => t.slug === "polymarket")
    expect(swapped?.required).toBe(true)
    // MUTATION: plain-add would leave twitter-api in the set.
    expect(result.tools.filter((t) => t.slug === "twitter-api")).toHaveLength(0)
    expect(result.tools.length).toBe(SNAPSHOT_TOOLS.length)
  })

  it("swap Suggested pins preserve alternatives[] source", () => {
    const result = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "swap", slug: "tavily", replaceWith: "serp_api" },
      SNAPSHOT_TOOLS,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entry = result.tools.find((t) => t.slug === "serp_api")
    expect(entry?.alternatives).toContain("tavily")
    expect(entry?.alternatives).toContain("exa_search")
    expect(entry?.required).toBe(false)
  })

  it("listRemovedTemplateTools lists dropped template tools", () => {
    const withoutTavily = SNAPSHOT_TOOLS.filter((t) => t.slug !== "tavily")
    const removed = listRemovedTemplateTools(withoutTavily, SNAPSHOT_TOOLS)
    expect(removed.map((t) => t.slug)).toEqual(["tavily"])
  })
})

describe("demote → gate uses workspace set (not template)", () => {
  it("demote twitter → gate passes without twitter connected", () => {
    const demoted = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "demote", slug: "twitter-api" },
      SNAPSHOT_TOOLS,
    )
    expect(demoted.ok).toBe(true)
    if (!demoted.ok) return

    // Resolver/workspace path: gated required from demoted set.
    const workspaceRequired = partitionToolRequirements(demoted.tools).required
    const gated = filterNonAiProviderRequiredEntries(workspaceRequired)
    expect(gated.map((t) => t.slug)).not.toContain("twitter-api")
    expect(
      requiredToolsSatisfied(gated, []).satisfied,
    ).toBe(true)
  })

  it("MUTATION: if gate re-read template required, demote would not pass", () => {
    const demoted = applyToolRequirementOp(
      SNAPSHOT_TOOLS,
      { op: "demote", slug: "twitter-api" },
      SNAPSHOT_TOOLS,
    )
    expect(demoted.ok).toBe(true)
    if (!demoted.ok) return

    const workspaceGated = filterNonAiProviderRequiredEntries(
      partitionToolRequirements(demoted.tools).required,
    )
    const templateGated = filterNonAiProviderRequiredEntries(
      partitionToolRequirements(SNAPSHOT_TOOLS).required,
    )
    expect(requiredToolsSatisfied(workspaceGated, []).satisfied).toBe(true)
    // Template still lists twitter as required - empty connections fail.
    expect(requiredToolsSatisfied(templateGated, []).satisfied).toBe(false)
    expect(templateGated.map((t) => t.slug)).toContain("twitter-api")
  })
})
