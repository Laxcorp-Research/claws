import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  WORKSPACE_SNAPSHOT_PARITY_KEYS,
  buildWorkspaceSnapshotFromSeedTemplate,
  buildWorkspaceSnapshotFromWorkspace,
  buildWorkspaceSnapshotObject,
} from "@/lib/marketplace/workspace-snapshot"

describe("PR-2 workspace snapshot parity", () => {
  it("emits every parity key seed embeds (recommendedAlwaysOn when set)", () => {
    const obj = buildWorkspaceSnapshotObject({
      agents: [],
      connections: [],
      tools: [],
      flowDescription: "Flow",
      legalDisclaimer: "Legal",
      maxRevisionRounds: 5,
      deliveryMode: "AUTO_PROCEED",
      recommendedAlwaysOn: true,
    })
    for (const key of WORKSPACE_SNAPSHOT_PARITY_KEYS) {
      expect(obj).toHaveProperty(key)
    }
    expect(obj.maxRevisionRounds).toBe(5)
    expect(obj.deliveryMode).toBe("AUTO_PROCEED")
    expect(obj.recommendedAlwaysOn).toBe(true)
  })

  it("seed helper and workspace helper share the same parity keys", () => {
    const fromSeed = JSON.parse(
      buildWorkspaceSnapshotFromSeedTemplate({
        agents: [
          {
            name: "Lead",
            agentSlug: "lead",
            role: "ORCHESTRATOR",
            color: "#000",
            model: "anthropic/claude-sonnet-4-6",
            roleDescription: "Lead",
            soulMd: "soul",
            agentsMd: "agents",
            heartbeatMd: "hb",
            skills: ["git-operations"],
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
        tools: [{ slug: "gmail", name: "Gmail", connectionType: "OAUTH_COMPOSIO", required: true }],
        flowDescription: "seed flow",
        legalDisclaimer: "seed legal",
        recommendedAlwaysOn: true,
        knobs: { maxRevisionRounds: 4, deliveryMode: "APPROVAL_REQUIRED" },
      }),
    ) as Record<string, unknown>

    const fromWorkspace = JSON.parse(
      buildWorkspaceSnapshotFromWorkspace({
        maxRevisionRounds: 4,
        deliveryMode: "APPROVAL_REQUIRED",
        alwaysOn: true,
        description: "ws flow",
        agents: [
          {
            id: "a1",
            name: "Lead",
            agentSlug: "lead",
            role: "ORCHESTRATOR",
            soulMd: "soul",
            agentsMd: "agents",
            heartbeatMd: "hb",
            model: "anthropic/claude-sonnet-4-6",
            positionX: 0,
            positionY: 0,
            skills: [],
          },
        ],
        connections: [],
        toolConnections: [
          { toolSlug: "gmail", displayName: "Gmail", connectionType: "OAUTH_COMPOSIO" },
        ],
      }),
    ) as Record<string, unknown>

    for (const key of [
      "flowDescription",
      "legalDisclaimer",
      "maxRevisionRounds",
      "deliveryMode",
      "recommendedAlwaysOn",
      "agents",
      "connections",
      "tools",
    ]) {
      expect(fromSeed).toHaveProperty(key)
      expect(fromWorkspace).toHaveProperty(key)
    }
    expect(fromSeed.maxRevisionRounds).toBe(fromWorkspace.maxRevisionRounds)
    expect(fromSeed.deliveryMode).toBe(fromWorkspace.deliveryMode)
    expect(fromSeed.recommendedAlwaysOn).toBe(true)
    expect(fromWorkspace.recommendedAlwaysOn).toBe(true)
    const seedAgents = fromSeed.agents as Array<{ skills?: Array<{ slug: string }> }>
    expect(seedAgents[0].skills).toEqual([{ slug: "git-operations" }])
  })

  it("round-trip: workspace knobs survive publish snapshot → parse → install fields", () => {
    const json = buildWorkspaceSnapshotFromWorkspace({
      maxRevisionRounds: 7,
      deliveryMode: "AUTO_PROCEED",
      alwaysOn: false,
      description: "user flow",
      agents: [
        {
          id: "a1",
          name: "Worker",
          agentSlug: "worker",
          role: "WORKER",
          soulMd: "s",
          agentsMd: "a",
          model: "anthropic/claude-sonnet-4-6",
          skills: [],
          positionX: 10,
          positionY: 20,
        },
      ],
      connections: [],
      toolConnections: [],
    })
    const snap = JSON.parse(json) as {
      maxRevisionRounds: number
      deliveryMode: string
      flowDescription: string | null
      agents: Array<{ agentSlug: string; positionX: number }>
    }
    // createWorkspaceFromTemplate reads these knobs into Workspace columns.
    expect(snap.maxRevisionRounds).toBe(7)
    expect(snap.deliveryMode).toBe("AUTO_PROCEED")
    expect(snap.flowDescription).toBe("user flow")
    expect(snap.agents[0].agentSlug).toBe("worker")
    expect(snap.agents[0].positionX).toBe(10)
  })

  it("MUTATION: seed.ts and publish route use shared builder", () => {
    const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8")
    const publish = readFileSync(
      join(process.cwd(), "src/app/api/marketplace/templates/route.ts"),
      "utf8",
    )
    const script = readFileSync(
      join(process.cwd(), "scripts/seed-claw-templates-only.ts"),
      "utf8",
    )
    expect(seed).toContain("buildWorkspaceSnapshotFromSeedTemplate")
    expect(publish).toContain("buildWorkspaceSnapshotFromWorkspace")
    expect(script).toContain("buildWorkspaceSnapshotFromSeedTemplate")
    // Inline JSON.stringify choreography blob must not return in seed.
    expect(seed).not.toMatch(/flowDescription:\s*template\.flowDescription/)
  })

  it("MUTATION: republish + skill report routes exist", () => {
    const republish = readFileSync(
      join(process.cwd(), "src/app/api/marketplace/templates/[slug]/republish/route.ts"),
      "utf8",
    )
    const skillReport = readFileSync(
      join(process.cwd(), "src/app/api/marketplace/skills/[slug]/report/route.ts"),
      "utf8",
    )
    expect(republish).toContain("pendingWorkspaceSnapshot")
    expect(republish).toContain("pendingVersion")
    expect(republish).toContain("liveStaysPublic")
    expect(skillReport).toContain("skillId: skill.id")
    expect(skillReport).toContain("VALID_REASONS")
  })

  it("seed snapshot may emit files[]; publish builder never does (privacy rail v1)", () => {
    const fromSeed = JSON.parse(
      buildWorkspaceSnapshotFromSeedTemplate({
        agents: [
          {
            name: "Lead",
            agentSlug: "lead",
            role: "ORCHESTRATOR",
            color: "#000",
            model: "anthropic/claude-sonnet-4-6",
            roleDescription: "Lead",
            soulMd: "soul",
            agentsMd: "agents",
            heartbeatMd: "hb",
            skills: [],
            position: { x: 0, y: 0 },
          },
        ],
        connections: [],
        tools: [],
        flowDescription: "seed flow",
        files: [{ path: "VOICE.md", content: "creator memory - must not publish" }],
      }),
    ) as Record<string, unknown>

    const fromWorkspace = JSON.parse(
      buildWorkspaceSnapshotFromWorkspace({
        maxRevisionRounds: 3,
        deliveryMode: "APPROVAL_REQUIRED",
        description: "ws flow",
        agents: [
          {
            id: "a1",
            name: "Lead",
            agentSlug: "lead",
            role: "ORCHESTRATOR",
            soulMd: "soul",
            agentsMd: "agents",
            model: "anthropic/claude-sonnet-4-6",
            skills: [],
            positionX: 0,
            positionY: 0,
          },
        ],
        connections: [],
        toolConnections: [],
      }),
    ) as Record<string, unknown>

    expect(fromSeed.files).toEqual([
      { path: "VOICE.md", content: "creator memory - must not publish" },
    ])
    expect(fromWorkspace).not.toHaveProperty("files")
    expect(WORKSPACE_SNAPSHOT_PARITY_KEYS).not.toContain("files")
  })
})
