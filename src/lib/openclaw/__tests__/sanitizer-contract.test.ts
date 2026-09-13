import { describe, it, expect, vi } from "vitest"
import yaml from "yaml"
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

import { generateWorkspace } from "@/lib/openclaw/generator"
import { sanitizeSkillEnvOverrides } from "@/test/fixtures/openclaw-sanitizer/skill-env-sanitizer"
import { ALL_TOOLS, type ToolDefinition } from "@/data/tool-catalog"

// ─── Helpers ────────────────────────────────────────────

type EmittedFrontmatter = {
  name: string
  description: string
  metadata?: {
    openclaw?: {
      emoji?: string
      primaryEnv?: string
      requires?: { env?: string[]; bins?: string[] }
    }
  }
}

function parseEmittedFrontmatter(skillMd: string): EmittedFrontmatter {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) throw new Error("SKILL.md has no frontmatter block")
  return yaml.parse(match[1]) as EmittedFrontmatter
}

function buildAllowlistFromFrontmatter(fm: EmittedFrontmatter): Set<string> {
  const allowlist = new Set<string>()
  const primary = fm.metadata?.openclaw?.primaryEnv?.trim()
  if (primary) allowlist.add(primary)
  for (const env of fm.metadata?.openclaw?.requires?.env ?? []) {
    const trimmed = env.trim()
    if (trimmed) allowlist.add(trimmed)
  }
  return allowlist
}

function buildWorkspaceWith(skills: Array<{ slug: string; compatibleTools: string[] }>) {
  return {
    id: "ws-1",
    name: "Test",
    slug: "test",
    status: "DRAFT",
    userId: "u-1",
    clawTemplateId: "tpl-1",
    timezone: "UTC",
    userContext: null,
    scheduledTasks: null,
    description: null,
    gatewayToken: null,
    hostPort: null,
    containerName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [
      {
        id: "a-orch",
        name: "Orch",
        role: "ORCHESTRATOR",
        description: null,
        model: "HAIKU_4_5",
        soulMd: "",
        agentsMd: "",
        heartbeatMd: "",
        heartbeatFrequency: "off",
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        reportsTo: null,
        workspaceId: "ws-1",
        skills: skills.map((s) => ({
          skill: {
            slug: s.slug,
            name: s.slug,
            description: `test skill ${s.slug}`,
            emoji: null,
            requiredBins: null,
            compatibleTools: s.compatibleTools,
            skillMd: `---\nname: ${s.slug}\ndescription: leftover seed frontmatter\n---\n\n## Body\nauthoritative content.`,
          },
        })),
        outgoingConnections: [],
        incomingConnections: [],
      },
      {
        id: "a-worker",
        name: "Worker",
        role: "WORKER",
        description: null,
        model: "HAIKU_4_5",
        soulMd: "",
        agentsMd: "",
        heartbeatMd: "",
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        reportsTo: "a-orch",
        workspaceId: "ws-1",
        skills: [],
        outgoingConnections: [],
        incomingConnections: [],
      },
      {
        id: "a-critic",
        name: "Critic",
        role: "CRITIC",
        description: null,
        model: "HAIKU_4_5",
        soulMd: "",
        agentsMd: "",
        heartbeatMd: "",
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        reportsTo: "a-orch",
        workspaceId: "ws-1",
        skills: [],
        outgoingConnections: [],
        incomingConnections: [],
      },
    ],
    toolConnections: [],
    channelConfig: {},
    clawTemplate: { name: "Test", slug: "test" },
    user: { name: "Test", apiKeys: [] },
  }
}

async function emitSkillMd(skillSlug: string, compatibleTools: string[]): Promise<string> {
  const ws = buildWorkspaceWith([{ slug: skillSlug, compatibleTools }])
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws)
  const result = await generateWorkspace("ws-1")
  const orchKey = Object.keys(result.workspaces).find((k) => k.includes("orch"))!
  return result.workspaces[orchKey].skills[skillSlug]["SKILL.md"]
}

// ─── Tests ──────────────────────────────────────────────

describe("PR #3a sanitizer contract - emitted frontmatter passes runtime sanitizer", () => {
  it("single-cred tool (tavily): generator emits primaryEnv + requires.env, runtime allows the key", async () => {
    const skillMd = await emitSkillMd("tavily-search", ["tavily"])
    const fm = parseEmittedFrontmatter(skillMd)

    expect(fm.metadata?.openclaw?.primaryEnv).toBe("TAVILY_API_KEY")
    expect(fm.metadata?.openclaw?.requires?.env).toEqual(["TAVILY_API_KEY"])

    const allowlist = buildAllowlistFromFrontmatter(fm)
    const sanitized = sanitizeSkillEnvOverrides({
      overrides: { TAVILY_API_KEY: "tvly-test-secret" },
      allowedSensitiveKeys: allowlist,
    })

    expect(sanitized.blocked).toEqual([])
    expect(sanitized.allowed).toEqual({ TAVILY_API_KEY: "tvly-test-secret" })
  })

  it("multi-cred tool (binance): generator emits requires.env (2 fields) with no primaryEnv; both names pass", async () => {
    const skillMd = await emitSkillMd("binance-trading", ["binance"])
    const fm = parseEmittedFrontmatter(skillMd)

    expect(fm.metadata?.openclaw?.primaryEnv).toBeUndefined()
    expect(fm.metadata?.openclaw?.requires?.env).toEqual([
      "BINANCE_API_KEY",
      "BINANCE_API_SECRET",
    ])

    const allowlist = buildAllowlistFromFrontmatter(fm)
    const sanitized = sanitizeSkillEnvOverrides({
      overrides: {
        BINANCE_API_KEY: "b-key",
        BINANCE_API_SECRET: "b-secret",
      },
      allowedSensitiveKeys: allowlist,
    })

    expect(sanitized.blocked).toEqual([])
    expect(sanitized.allowed).toEqual({
      BINANCE_API_KEY: "b-key",
      BINANCE_API_SECRET: "b-secret",
    })
  })

  it("multi-cred tool (twilio): both ACCOUNT_SID and AUTH_TOKEN pass", async () => {
    const skillMd = await emitSkillMd("twilio-sms", ["twilio"])
    const fm = parseEmittedFrontmatter(skillMd)

    expect(fm.metadata?.openclaw?.requires?.env).toEqual([
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
    ])

    const allowlist = buildAllowlistFromFrontmatter(fm)
    const sanitized = sanitizeSkillEnvOverrides({
      overrides: {
        TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
        TWILIO_AUTH_TOKEN: "auth",
      },
      allowedSensitiveKeys: allowlist,
    })

    expect(sanitized.blocked).toEqual([])
    expect(Object.keys(sanitized.allowed).sort()).toEqual([
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
    ])
  })

  it("OAUTH_COMPOSIO tool (hubspot): generator emits NO env frontmatter (Composio handles auth)", async () => {
    const skillMd = await emitSkillMd("hubspot-crm", ["hubspot"])
    const fm = parseEmittedFrontmatter(skillMd)

    expect(fm.metadata?.openclaw?.primaryEnv).toBeUndefined()
    expect(fm.metadata?.openclaw?.requires?.env).toBeUndefined()
  })

  it("negative: skill with primaryEnv='TAVILY_API_KEY' + injecting BAR_API_KEY blocks BAR_API_KEY", async () => {
    const skillMd = await emitSkillMd("tavily-search", ["tavily"])
    const fm = parseEmittedFrontmatter(skillMd)
    const allowlist = buildAllowlistFromFrontmatter(fm)

    const sanitized = sanitizeSkillEnvOverrides({
      overrides: {
        TAVILY_API_KEY: "tvly-valid",
        BAR_API_KEY: "unauthorized", // not declared, not in allowlist
      },
      allowedSensitiveKeys: allowlist,
    })

    expect(sanitized.blocked).toEqual(["BAR_API_KEY"])
    expect(sanitized.allowed).toEqual({ TAVILY_API_KEY: "tvly-valid" })
  })

  it("negative: multi-cred with extra unwanted env var blocks only the extra", async () => {
    const skillMd = await emitSkillMd("binance-trading", ["binance"])
    const fm = parseEmittedFrontmatter(skillMd)
    const allowlist = buildAllowlistFromFrontmatter(fm)

    const sanitized = sanitizeSkillEnvOverrides({
      overrides: {
        BINANCE_API_KEY: "b-key",
        BINANCE_API_SECRET: "b-secret",
        EXTRA_SMUGGLED_TOKEN: "sneaky",
      },
      allowedSensitiveKeys: allowlist,
    })

    expect(sanitized.blocked).toEqual(["EXTRA_SMUGGLED_TOKEN"])
    expect(sanitized.allowed.BINANCE_API_KEY).toBe("b-key")
    expect(sanitized.allowed.BINANCE_API_SECRET).toBe("b-secret")
  })

  it("negative: declaring the WRONG primaryEnv causes the real key to get blocked", async () => {
    // Simulate what happens without PR #3a's catalog lookup: skill has
    // primaryEnv=FOO_API_KEY but the injected env var is TAVILY_API_KEY.
    // The runtime sanitizer blocks TAVILY_API_KEY because it's not in the
    // allowlist. This test proves the WARN would fire on misconfiguration -
    // i.e. PR #3a's catalog-driven emission is what prevents this.
    const misconfiguredAllowlist = new Set(["FOO_API_KEY"])
    const sanitized = sanitizeSkillEnvOverrides({
      overrides: { TAVILY_API_KEY: "tvly-real" },
      allowedSensitiveKeys: misconfiguredAllowlist,
    })
    expect(sanitized.blocked).toEqual(["TAVILY_API_KEY"])
    expect(sanitized.allowed).toEqual({})
  })

  it("seed frontmatter is stripped (no double --- block in output)", async () => {
    const skillMd = await emitSkillMd("tavily-search", ["tavily"])
    // Count leading `---` blocks. Should be exactly one.
    const frontmatterBlocks = skillMd.match(/^---\r?\n/gm) ?? []
    // Frontmatter uses 2 `---` markers per block (open + close). One block = 2 markers.
    const openerCount = skillMd.split("\n").filter((line) => line === "---").length
    expect(openerCount).toBe(2) // exactly 1 frontmatter block (2 markers)
    expect(skillMd.indexOf("leftover seed frontmatter")).toBe(-1)
    expect(skillMd).toContain("authoritative content")
  })
})

describe("PR #3a sanitizer contract - catalog-wide integrity check", () => {
  it("every API_KEY catalog entry's envVars would pass the sanitizer when declared as allowlist", () => {
    const apiKeyTools = ALL_TOOLS.filter((t: ToolDefinition) => t.connectionType === "API_KEY")
    expect(apiKeyTools.length).toBeGreaterThan(0)

    for (const tool of apiKeyTools) {
      const allowlist = new Set(tool.credentialFields.map((f) => f.envVar))
      const overrides: Record<string, string> = {}
      for (const field of tool.credentialFields) {
        overrides[field.envVar] = `test-value-${field.envVar.toLowerCase()}`
      }

      const sanitized = sanitizeSkillEnvOverrides({
        overrides,
        allowedSensitiveKeys: allowlist,
      })

      expect(
        sanitized.blocked,
        `Tool ${tool.slug}: expected allowlist ${[...allowlist].join(",")} to allow all declared envVars, but these got blocked: ${sanitized.blocked.join(",")}`,
      ).toEqual([])
      expect(Object.keys(sanitized.allowed).sort()).toEqual(
        tool.credentialFields.map((f) => f.envVar).sort(),
      )
    }
  })

  it("no API_KEY catalog entry declares an envVar that would be BLANKET-blocked by the sanitizer", () => {
    // The tier-1 pattern /^OPENSSL_CONF$/i and isDangerousHostEnvVarName
    // (NODE_OPTIONS, LD_*, etc.) are ALWAYS blocked regardless of allowlist.
    // If any catalog entry ever declared one of those names, the tier-2
    // allowlist can't save it. This test prevents that class of mistake.
    const BLANKET_BLOCKED_NAMES = new Set([
      "OPENSSL_CONF",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONHOME",
      "PYTHONPATH",
      "BASH_ENV",
      "SHELL",
      "SHELLOPTS",
      "IFS",
      "SSLKEYLOGFILE",
    ])
    const BLANKET_BLOCKED_PREFIXES = ["LD_", "DYLD_", "BASH_FUNC_"]
    const apiKeyTools = ALL_TOOLS.filter((t: ToolDefinition) => t.connectionType === "API_KEY")
    for (const tool of apiKeyTools) {
      for (const f of tool.credentialFields) {
        const upper = f.envVar.toUpperCase()
        expect(BLANKET_BLOCKED_NAMES.has(upper)).toBe(false)
        for (const prefix of BLANKET_BLOCKED_PREFIXES) {
          expect(
            upper.startsWith(prefix),
            `Tool ${tool.slug} declared envVar '${f.envVar}' starting with dangerous prefix '${prefix}'`,
          ).toBe(false)
        }
      }
    }
  })
})
