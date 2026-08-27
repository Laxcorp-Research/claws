import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((val: string) => {
    if (val.trim().startsWith("{")) {
      try {
        JSON.parse(val)
        return val
      } catch {
        /* fallthrough */
      }
    }
    return `decrypted-${val}`
  }),
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 4)}...`),
}))

vi.mock("@/lib/crypto", () => ({
  generateSecureToken: vi.fn(() => "mock-gateway-token"),
}))

import { generateWorkspace, toAgentId } from "@/lib/openclaw/generator"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"
import { ALL_TEMPLATES } from "../../../prisma/seed-data"
import { ALL_SKILLS } from "../../../prisma/seed-data/skills-index"
import type { SeedTemplate } from "../../../prisma/seed-data/types"

const SKILL_BY_SLUG = new Map(ALL_SKILLS.map((s) => [s.slug, s]))

type OpenClawListEntry = {
  id: string
  name: string
  skills?: string[]
}

function seedTemplateBySlug(slug: string): SeedTemplate {
  const template = ALL_TEMPLATES.find((t) => t.slug === slug)
  if (!template) throw new Error(`missing template ${slug}`)
  return template
}

function emptiedSkills(template: SeedTemplate): SeedTemplate {
  return {
    ...template,
    agents: template.agents.map((agent) => ({ ...agent, skills: [] })),
  }
}

function skillRowsFor(template: SeedTemplate) {
  return template.agents.map((agent, index) => {
    const workers = template.agents.filter((a) => a.role === "WORKER")
    const isOrch = agent.role === "ORCHESTRATOR"
    return {
      id: `agent-${agent.agentSlug}`,
      name: agent.name,
      role: agent.role,
      description: agent.roleDescription,
      model: agent.model,
      soulMd: agent.soulMd,
      agentsMd: agent.agentsMd,
      heartbeatMd: agent.heartbeatMd,
      heartbeatFrequency: null,
      heartbeatTime: null,
      qualityThreshold: agent.qualityThreshold ?? 8.0,
      emoji: null,
      isPaused: false,
      reportsTo: null,
      workspaceId: "ws-roundtrip",
      skills: agent.skills.map((slug) => {
        const skill = SKILL_BY_SLUG.get(slug)
        if (!skill) throw new Error(`catalog miss ${slug}`)
        return {
          skill: {
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            emoji: skill.icon,
            requiredBins: null,
            requiredEnvVars: null,
            compatibleTools: skill.compatibleTools,
            skillMd: skill.skillMd,
          },
        }
      }),
      outgoingConnections: isOrch
        ? workers.map((w) => ({
            targetAgent: { id: `agent-${w.agentSlug}`, name: w.name },
            condition: "ON_COMPLETE",
            contextNote: null,
          }))
        : [],
      incomingConnections: isOrch
        ? []
        : [{ sourceAgent: { name: template.agents.find((a) => a.role === "ORCHESTRATOR")!.name } }],
      createdAt: new Date(2026, 0, 1, 0, 0, index),
    }
  })
}

function buildWorkspaceFromSeed(template: SeedTemplate) {
  return {
    id: "ws-roundtrip",
    name: template.name,
    slug: `${template.slug}-ws`,
    status: "DRAFT",
    userId: "user-1",
    clawTemplateId: "tpl-roundtrip",
    timezone: "America/New_York",
    userContext: "Test user context",
    scheduledTasks: null,
    description: template.flowDescription,
    gatewayToken: null,
    hostPort: null,
    containerName: null,
    apiKeySourceOverride: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: skillRowsFor(template),
    toolConnections: [],
    customToolConnections: [],
    channelConfig: {},
    clawTemplate: { name: template.name, slug: template.slug },
    user: {
      id: "user-1",
      name: "Test User",
      apiKeySource: "USER_OWN_KEY",
      apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "encrypted-anthropic-key" }],
    },
  }
}

async function generateFromSeed(template: SeedTemplate) {
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
    buildWorkspaceFromSeed(template),
  )
  ;(prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  return generateWorkspace("ws-roundtrip")
}

function countEmittedSkillFiles(result: Awaited<ReturnType<typeof generateWorkspace>>): number {
  let count = 0
  for (const folder of Object.values(result.workspaces)) {
    const skills = folder.skills ?? {}
    count += Object.keys(skills).length
  }
  return count
}

function assertRoundTrip(template: SeedTemplate, result: Awaited<ReturnType<typeof generateWorkspace>>) {
  const config = JSON.parse(result["openclaw.json"]) as { agents: { list: OpenClawListEntry[] } }
  let emitted = 0

  for (const agent of template.agents) {
    const folder = result.workspaces[`workspace-${toAgentId(agent.name)}`]
    expect(folder, `missing workspace for ${agent.agentSlug}`).toBeTruthy()
    const emittedSlugs = Object.keys(folder.skills ?? {})
    expect(emittedSlugs.sort()).toEqual([...agent.skills].sort())
    for (const slug of agent.skills) {
      const skill = SKILL_BY_SLUG.get(slug)!
      const body = folder.skills[slug]["SKILL.md"]
      expect(body).toContain(skill.skillMd.slice(0, 40))
      emitted += 1
    }

    const listEntry = config.agents.list.find((a) => a.id === toAgentId(agent.name))
    expect(listEntry, `openclaw.json missing ${agent.agentSlug}`).toBeTruthy()
    if (agent.skills.length > 0) {
      expect([...listEntry!.skills ?? []].sort()).toEqual([...agent.skills].sort())
    } else {
      expect(listEntry!.skills).toBeUndefined()
    }
  }

  expect(emitted).toBeGreaterThan(0)
  return emitted
}

function setupInstallMocks(snapshotJson: string, agentCount: number) {
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  )
  ;(prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "tpl-roundtrip",
    slug: "roundtrip",
    name: "Roundtrip",
    description: "d",
    price: 0,
    workspaceSnapshot: snapshotJson,
  })
  ;(prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const calls = (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mock.calls.length
    return calls <= 1 ? 0 : 1
  })
  ;(prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-1",
    name: "Roundtrip",
  })
  const creates = Array.from({ length: agentCount }, (_, i) => ({ id: `agent-${i}` }))
  let createIdx = 0
  ;(prismaMock.agent.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const row = creates[createIdx] ?? { id: `agent-${createIdx}` }
    createIdx += 1
    return row
  })
  ;(prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.agentConnection.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "install-1" })
  ;(prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.skill.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    async ({ where }: { where: { slug: string } }) =>
      CATALOG_HAS(where.slug) ? { id: `skill-${where.slug}` } : null,
  )
  ;(prismaMock.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
}

function CATALOG_HAS(slug: string): boolean {
  return SKILL_BY_SLUG.has(slug)
}

describe("INFRA-3 install → generate skill round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    "twitter-growth-machine",
    "medical-practice-manager",
    "freelancer-revenue-engine",
  ] as const)("install snapshot from %s materializes AgentSkill rows", async (slug) => {
    const template = seedTemplateBySlug(slug)
    const snapshot = buildWorkspaceSnapshotFromSeedTemplate(template)
    const parsed = JSON.parse(snapshot) as {
      agents: Array<{ agentSlug: string; skills: Array<{ slug: string }> }>
    }
    const expected = template.agents.reduce((n, a) => n + a.skills.length, 0)
    expect(expected).toBeGreaterThan(0)
    for (const agent of parsed.agents) {
      const seed = template.agents.find((a) => a.agentSlug === agent.agentSlug)!
      expect(agent.skills.map((s) => s.slug).sort()).toEqual([...seed.skills].sort())
      for (const skill of agent.skills) {
        expect(skill).toEqual({ slug: skill.slug })
      }
    }

    setupInstallMocks(snapshot, template.agents.length)
    await createWorkspaceFromTemplate({ userId: "user-1", templateId: "tpl-roundtrip" })
    expect(prismaMock.agentSkill.create).toHaveBeenCalledTimes(expected)
  })

  it.each([
    "twitter-growth-machine",
    "medical-practice-manager",
    "freelancer-revenue-engine",
  ] as const)("generateWorkspace emits SKILL.md + per-agent openclaw.json skills for %s", async (slug) => {
    const template = seedTemplateBySlug(slug)
    const result = await generateFromSeed(template)
    assertRoundTrip(template, result)
  })

  it("MUTATION: skills:[] restored on a seeded template fails round-trip", async () => {
    const live = seedTemplateBySlug("twitter-growth-machine")
    const empty = emptiedSkills(live)

    const liveResult = await generateFromSeed(live)
    const liveCount = countEmittedSkillFiles(liveResult)
    expect(liveCount).toBeGreaterThan(0)
    assertRoundTrip(live, liveResult)

    const emptyResult = await generateFromSeed(empty)
    expect(countEmittedSkillFiles(emptyResult)).toBe(0)
    const emptyConfig = JSON.parse(emptyResult["openclaw.json"]) as {
      agents: { list: OpenClawListEntry[] }
    }
    expect(emptyConfig.agents.list.every((a) => !a.skills || a.skills.length === 0)).toBe(true)

    expect(
      live.agents.every((a) => a.skills.length === 0),
      "twitter-growth-machine seed must not be skills:[] - restoring empty fails this test",
    ).toBe(false)
  })
})
