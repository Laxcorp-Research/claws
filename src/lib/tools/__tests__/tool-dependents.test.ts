/**
 * Tool dependents labeling (PR-2).
 *
 * MUTATION: drop prose pass → known-prose fixture fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import {
  formatDependentHitLabel,
  honestLimitCopyForCoverage,
  proseMentionsTool,
  resolveToolDependents,
} from "@/lib/tools/tool-dependents"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

describe("proseMentionsTool", () => {
  it("matches display name and slug in agent prose", () => {
    const text = "Query Twitter API for trending topics via twitter-api."
    expect(proseMentionsTool(text, "twitter-api", "Twitter/X API")).toContain("twitter-api")
    expect(proseMentionsTool(text, "twitter-api", "Twitter/X API").length).toBeGreaterThan(0)
  })

  it("does not match unrelated prose", () => {
    expect(proseMentionsTool("Use email outreach.", "twitter-api", "Twitter/X API")).toEqual([])
  })
})

describe("resolveToolDependents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("labels structural hits from AgentSkill", async () => {
    ;(prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "sk-1", slug: "twitter-oauth", name: "Twitter OAuth" },
      { id: "sk-2", slug: "twitter-api", name: "Twitter API" },
    ])
    ;(prismaMock.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        agent: { id: "a1", name: "Trend & Topic Scout", agentSlug: "trend-scout" },
        skill: { slug: "twitter-oauth" },
      },
      {
        agent: { id: "a1", name: "Trend & Topic Scout", agentSlug: "trend-scout" },
        skill: { slug: "twitter-api" },
      },
      {
        agent: { id: "a2", name: "Content Writer", agentSlug: "writer" },
        skill: { slug: "twitter-api" },
      },
    ])
    ;(prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await resolveToolDependents("ws-1", "twitter-api")
    expect(result.coverage).toBe("structural")
    expect(result.hits).toHaveLength(2)
    expect(formatDependentHitLabel(result.hits[0])).toMatch(/skill/)
  })

  it("labels prose hits when AgentSkill is empty (known-prose fixture)", async () => {
    ;(prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.agentSkill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "a1",
        name: "Trend & Topic Scout",
        agentSlug: "trend-scout",
        soulMd: "You monitor Twitter/X API trends daily.",
        agentsMd: "",
        heartbeatMd: null,
      },
      {
        id: "a2",
        name: "Silent Agent",
        agentSlug: "silent",
        soulMd: "No tools named.",
        agentsMd: "",
        heartbeatMd: null,
      },
    ])

    const result = await resolveToolDependents("ws-1", "twitter-api")
    expect(result.coverage).toBe("prose")
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].agentName).toBe("Trend & Topic Scout")
    expect(result.hits[0].kind).toBe("prose")
    expect(formatDependentHitLabel(result.hits[0])).toContain("mentioned in SOUL/AGENTS")
  })

  it("MUTATION: drop prose pass → known-prose fixture fails", async () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/tools/tool-dependents.ts"),
      "utf8",
    )
    expect(source).toContain("proseMentionsTool")
    expect(source).toMatch(/soulMd[\s\S]*agentsMd[\s\S]*heartbeatMd/)

    ;(prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "a1",
        name: "Trend Scout",
        agentSlug: "trend",
        soulMd: "Use twitter-api for trends.",
        agentsMd: "",
        heartbeatMd: null,
      },
    ])
    const result = await resolveToolDependents("ws-1", "twitter-api")
    // If prose pass removed, hits would be empty despite soulMd mention.
    expect(result.hits.some((h) => h.kind === "prose")).toBe(true)
  })

  it("emits honest-limit copy for none / prose", () => {
    expect(honestLimitCopyForCoverage("none")).toMatch(/No agents reference/)
    expect(honestLimitCopyForCoverage("prose")).toMatch(/text only/)
  })
})
