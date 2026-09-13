import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { buildRailwayEnvVars, buildWorkspaceFileMap } from "@/lib/openclaw/deployer"
import type { GeneratedWorkspace } from "@/lib/openclaw/generator"
import { UNPACK_NODE_SCRIPT } from "@/lib/openclaw/railway-client"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"
import type { SeedTemplate } from "../../../../prisma/seed-data/types"

const SAFETY_CEILING = 30_000

const workspace = {
  id: "ws-payload",
  userId: "user-payload",
  timezone: "UTC",
  containerHost: null,
  apiKeySourceOverride: null,
}

const user = {
  apiKeySource: "USER_OWN_KEY" as const,
  apiKeys: [],
}

function setRequiredEnv() {
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.METERING_MASTER_SECRET = "test-metering-secret"
  delete process.env.COMPOSIO_API_KEY
}

function executeUnpack(envVars: Record<string, string>): string {
  const outputDir = mkdtempSync(path.join(tmpdir(), "claws-unpack-"))
  execFileSync(process.execPath, ["-e", UNPACK_NODE_SCRIPT], {
    env: {
      ...process.env,
      ...envVars,
      CLAWS_UNPACK_DIR: outputDir,
    },
    stdio: "pipe",
  })
  return outputDir
}

function expectUnpackedFiles(outputDir: string, generated: GeneratedWorkspace) {
  try {
    expect(readFileSync(path.join(outputDir, "openclaw.json"), "utf8")).toBe(generated["openclaw.json"])
    expect(readFileSync(path.join(outputDir, ".env"), "utf8")).toBe(generated[".env"])

    for (const [relativePath, expected] of Object.entries(buildWorkspaceFileMap(generated))) {
      expect(readFileSync(path.join(outputDir, relativePath), "utf8")).toBe(expected)
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
}

function minimalGenerated(): GeneratedWorkspace {
  return {
    "openclaw.json": JSON.stringify({ gateway: { mode: "local" } }, null, 2),
    ".env": "OPENCLAW_GATEWAY_TOKEN=gw-test\nANTHROPIC_API_KEY=sk-ant-test\n",
    "cron/jobs.json": JSON.stringify([{ id: "job-1", name: "Daily", schedule: { kind: "cron", expr: "0 8 * * *" } }]),
    gatewayToken: "gw-test",
    workspaces: {
      "workspace-commander": {
        "SOUL.md": "# SOUL\n\nLead the team.\n",
        "AGENTS.md": "# AGENTS\n\nUse sessions_spawn.\n",
        "USER.md": "# USER\n\nHuman context.\n",
        "IDENTITY.md": "# IDENTITY\n\nCommander.\n",
        "TOOLS.md": "# TOOLS\n\nConnected tools.\n",
        "HEARTBEAT.md": "# HEARTBEAT\n\nDaily check.\n",
        "BOOT.md": "# BOOT\n\nStart cleanly.\n",
        skills: {
          research: { "SKILL.md": "# Research\n\nResearch safely.\n" },
        },
      },
    },
  }
}

function toAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 64)
}

function generatedFromTemplate(template: SeedTemplate): GeneratedWorkspace {
  const workspaces: GeneratedWorkspace["workspaces"] = {}
  for (const agent of template.agents) {
    workspaces[`workspace-${toAgentId(agent.name)}`] = {
      "SOUL.md": agent.soulMd,
      "AGENTS.md": agent.agentsMd,
      "USER.md": "# USER.md - About Your Human\n\n- **Name:** Not set\n- **Timezone:** UTC\n\n## Context\n\n_Update this as you learn about the person you're helping._\n",
      "IDENTITY.md": `# IDENTITY.md - Who Am I?\n\n- **Name:** ${agent.name}\n- **Role:** ${agent.role}\n- **Vibe:** Professional, focused, reliable\n- **Emoji:** 🤖\n`,
      "TOOLS.md": "# TOOLS.md - Environment Notes\n\nNo external tools are connected yet. The human can connect tools in the Claws setup wizard.\n",
      "HEARTBEAT.md": agent.role === "ORCHESTRATOR"
        ? agent.heartbeatMd || `# HEARTBEAT.md\n\n# Periodic tasks for ${agent.name}\n# Add tasks below. The gateway will prompt you to check this file periodically.\n# Use checklist format:\n# - [ ] Task description\n`
        : "# HEARTBEAT.md\n\n# No heartbeat tasks for this agent.\n",
      "BOOT.md": agent.role === "ORCHESTRATOR"
        ? "# BOOT.md - Startup Checklist\n\nOn gateway startup:\n1. Read SOUL.md and USER.md to restore context\n2. Read today's dated memory file (memory/YYYY-MM-DD.md) and any agent-specific workspace memory files for recent activity - never `read` the memory/ directory itself (that yields EISDIR)\n3. Verify HEARTBEAT.md has your scheduled tasks\n4. If everything looks good, reply with NO_REPLY\n5. If something is wrong (missing files, corrupted memory), send a brief status message to the human\n"
        : "# BOOT.md\n\n# No startup tasks for this agent.\n",
      skills: {},
    }
  }

  return {
    "openclaw.json": JSON.stringify({ gateway: { mode: "local" }, agents: { list: template.agents.map((a) => ({ id: toAgentId(a.name) })) } }),
    ".env": "OPENCLAW_GATEWAY_TOKEN=gw-youtube\n",
    "cron/jobs.json": "[]",
    gatewayToken: "gw-youtube",
    workspaces,
  }
}

function highEntropyText(bytesTarget: number): string {
  let out = ""
  for (let i = 0; out.length < bytesTarget; i++) {
    out += createHash("sha256").update(`payload-${i}`).digest("hex")
  }
  return out
}

describe("container payload delivery", () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of [
      "NEXT_PUBLIC_APP_URL",
      "ACTIVITY_ENDPOINT",
      "METERING_ENDPOINT",
      "METERING_MASTER_SECRET",
      "COMPOSIO_API_KEY",
    ]) {
      savedEnv[key] = process.env[key]
    }
    setRequiredEnv()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  // Real child-process I/O (execFileSync + gzip unpack) - can exceed the
  // default 5s under full-suite parallel load. Not a timer race.
  it("round-trips gzipped payload vars through the actual UNPACK_NODE_SCRIPT", () => {
    const generated = minimalGenerated()
    const env = buildRailwayEnvVars(generated, workspace, user)

    expect(env.CLAWS_CONFIG_GZ_B64).toBeDefined()
    expect(env.CLAWS_ENV_GZ_B64).toBeDefined()
    expect(env.CLAWS_FILES_GZ_B64).toBeDefined()
    expect(env.CLAWS_CONFIG_B64).toBeUndefined()
    expect(env.CLAWS_ENV_B64).toBeUndefined()
    expect(env.CLAWS_FILES_B64).toBeUndefined()

    const outputDir = executeUnpack(env)
    expectUnpackedFiles(outputDir, generated)
  }, 15_000)

  it("keeps WAVE-2 creator seed payloads under the 30,000 char safety ceiling", () => {
    for (const slug of [
      "youtube-channel-os",
      "newsletter-empire",
      "podcast-production-studio",
    ] as const) {
      const seed = ALL_TEMPLATES.find((template) => template.slug === slug)
      expect(seed, slug).toBeDefined()
      const generated = generatedFromTemplate(seed!)
      const env = buildRailwayEnvVars(generated, workspace, user)
      expect(env.CLAWS_FILES_GZ_B64.length, `${slug} files`).toBeLessThan(SAFETY_CEILING)
      expect(env.CLAWS_CONFIG_GZ_B64.length, `${slug} config`).toBeLessThan(SAFETY_CEILING)
      expect(env.CLAWS_ENV_GZ_B64.length, `${slug} env`).toBeLessThan(SAFETY_CEILING)
    }
  })

  it("throws a named pre-flight error when CLAWS_FILES_GZ_B64 exceeds the safety ceiling", () => {
    const generated = minimalGenerated()
    generated.workspaces["workspace-commander"]["TOOLS.md"] = highEntropyText(160_000)

    expect(() => buildRailwayEnvVars(generated, workspace, user)).toThrow(
      /Container payload CLAWS_FILES_GZ_B64 is \d+ chars - exceeds the 30,000 safety ceiling \(Railway hard limit 32,768\)\. Workspace too large to deploy\./,
    )
  })

  it("R16: empty cron/jobs.json still unpacks (removes stale store)", () => {
    const generated = minimalGenerated()
    generated["cron/jobs.json"] = "[]"
    const files = buildWorkspaceFileMap(generated)
    expect(files["cron/jobs.json"]).toBe("[]")
    const outputDir = executeUnpack({
      CLAWS_FILES_B64: Buffer.from(JSON.stringify(files)).toString("base64"),
    })
    try {
      expect(readFileSync(path.join(outputDir, "cron", "jobs.json"), "utf8")).toBe("[]")
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)

  it("still unpacks legacy CLAWS_FILES_B64 payloads byte-identically", () => {
    const generated = minimalGenerated()
    const files = buildWorkspaceFileMap(generated)
    const outputDir = executeUnpack({
      CLAWS_FILES_B64: Buffer.from(JSON.stringify(files)).toString("base64"),
    })

    try {
      for (const [relativePath, expected] of Object.entries(files)) {
        expect(readFileSync(path.join(outputDir, relativePath), "utf8")).toBe(expected)
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)
})
