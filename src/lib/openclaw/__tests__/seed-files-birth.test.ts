import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { buildRailwayEnvVars } from "@/lib/openclaw/deployer"
import type { GeneratedWorkspace } from "@/lib/openclaw/generator"
import { UNPACK_NODE_SCRIPT } from "@/lib/openclaw/railway-client"

const workspace = {
  id: "ws-seed-birth",
  userId: "user-seed",
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

function generatedWithSeeds(): GeneratedWorkspace {
  return {
    "openclaw.json": JSON.stringify({ gateway: { mode: "local" } }, null, 2),
    ".env": "OPENCLAW_GATEWAY_TOKEN=gw-seed\n",
    "cron/jobs.json": "[]",
    gatewayToken: "gw-seed",
    workspaces: {
      "workspace-twitter-commander": {
        "SOUL.md": "# SOUL stub\n",
        "AGENTS.md": "# AGENTS stub\n",
        "USER.md": "# USER stub\n",
        "IDENTITY.md": "# IDENTITY stub\n",
        "TOOLS.md": "# TOOLS stub\n",
        "HEARTBEAT.md": "# HEARTBEAT stub\n",
        "BOOT.md": "# BOOT stub\n",
        skills: {},
      },
    },
    seedFiles: {
      "workspace-twitter-commander/memory/MEMORY.md":
        "# MEMORY.md\n\nMaintained by this agent.\n\n## Schema\n- date\n\n## Entries\n_stub_\n",
      "shared/VOICE.md":
        "# VOICE.md\n\nMaintained by content-writer.\n\n## Schema\n- tone\n\n## Entries\n_voice stub_\n",
    },
  }
}

function executeUnpack(envVars: Record<string, string>, outputDir?: string): string {
  const dir = outputDir ?? mkdtempSync(path.join(tmpdir(), "claws-seed-unpack-"))
  execFileSync(process.execPath, ["-e", UNPACK_NODE_SCRIPT], {
    env: {
      ...process.env,
      ...envVars,
      CLAWS_UNPACK_DIR: dir,
    },
    stdio: "pipe",
  })
  return dir
}

describe("INFRA-2 birth-only seed files (the trap)", () => {
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

  it("ground-truth: boot unpacks before process-manager restore always-overwrites", () => {
    const railway = readFileSync(
      path.join(process.cwd(), "src/lib/openclaw/railway-client.ts"),
      "utf8",
    )
    expect(railway.indexOf("Unpacking config...")).toBeLessThan(
      railway.indexOf("process-manager.mjs"),
    )

    const pm = readFileSync(path.join(process.cwd(), "container/process-manager.mjs"), "utf8")
    const restoreIdx = pm.indexOf("function restoreRuntimeState")
    const restoreEnd = pm.indexOf("async function syncState")
    const restoreBody = pm.slice(restoreIdx, restoreEnd)
    expect(restoreBody).toContain("writeFileSync")
    expect(restoreBody).not.toContain("existsSync")

    const mainBody = pm.slice(pm.indexOf("async function main()"))
    expect(mainBody.indexOf("await restoreStateFromPlatform()")).toBeGreaterThan(-1)
    expect(mainBody.indexOf("await restoreStateFromPlatform()")).toBeLessThan(
      mainBody.indexOf("spawnGateway()"),
    )
  })

  it("MUTATION: seed unpack uses existsSync (always-overwrite restored → this fails)", () => {
    expect(UNPACK_NODE_SCRIPT).toContain("CLAWS_SEED_FILES_GZ_B64")
    expect(UNPACK_NODE_SCRIPT).toContain("existsSync")
    const seedIdx = UNPACK_NODE_SCRIPT.indexOf("CLAWS_SEED_FILES_GZ_B64")
    const seedSlice = UNPACK_NODE_SCRIPT.slice(seedIdx, seedIdx + 280)
    expect(seedSlice).toContain("wa(")
    expect(seedSlice).not.toMatch(/for\(const\[p,c\]of Object\.entries\(f\)\)if\(safe\(p\)\)w\(/)
  })

  it("deploy → simulate agent write → redeploy: seed content survives; config overwrites", () => {
    const generated = generatedWithSeeds()
    const env = buildRailwayEnvVars(generated, workspace, user)
    expect(env.CLAWS_SEED_FILES_GZ_B64).toBeDefined()
    const packedFiles = JSON.parse(
      gunzipSync(Buffer.from(env.CLAWS_FILES_GZ_B64, "base64")).toString("utf8"),
    ) as Record<string, string>
    expect(packedFiles).not.toHaveProperty("workspace-twitter-commander/memory/MEMORY.md")
    expect(packedFiles).not.toHaveProperty("shared/VOICE.md")

    const outputDir = executeUnpack(env)
    const memoryPath = path.join(outputDir, "workspace-twitter-commander/memory/MEMORY.md")
    const soulPath = path.join(outputDir, "workspace-twitter-commander/SOUL.md")
    const voicePath = path.join(outputDir, "shared/VOICE.md")

    try {
      expect(readFileSync(memoryPath, "utf8")).toContain("_stub_")
      expect(readFileSync(soulPath, "utf8")).toBe("# SOUL stub\n")
      expect(readFileSync(voicePath, "utf8")).toContain("_voice stub_")

      const agentMemory =
        "# MEMORY.md\n\nAGENT WROTE THIS during the session. Must survive redeploy.\n"
      const agentVoice =
        "# VOICE.md\n\nAGENT WROTE THIS voice. Must survive redeploy.\n"
      writeFileSync(memoryPath, agentMemory)
      writeFileSync(voicePath, agentVoice)
      writeFileSync(soulPath, "# SOUL.md\nagent edited soul - should NOT survive\n")

      generated.workspaces["workspace-twitter-commander"]["SOUL.md"] = "# SOUL.md\nredeployed soul\n"
      generated.seedFiles = {
        "workspace-twitter-commander/memory/MEMORY.md":
          "# MEMORY.md\n\nBIRTH STUB - must not clobber agent write.\n",
        "shared/VOICE.md": "# VOICE.md\n\nBIRTH STUB - must not clobber agent voice.\n",
      }
      const redeployEnv = buildRailwayEnvVars(generated, workspace, user)
      executeUnpack(redeployEnv, outputDir)

      expect(readFileSync(memoryPath, "utf8")).toBe(agentMemory)
      expect(readFileSync(soulPath, "utf8")).toBe("# SOUL.md\nredeployed soul\n")
      expect(readFileSync(voicePath, "utf8")).toBe(agentVoice)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)

  it("hibernation restore after unpack wins over birth stubs (Railway order)", () => {
    const generated = generatedWithSeeds()
    const env = buildRailwayEnvVars(generated, workspace, user)
    const outputDir = executeUnpack(env)
    const memoryPath = path.join(outputDir, "workspace-twitter-commander/memory/MEMORY.md")

    try {
      mkdirSync(path.dirname(memoryPath), { recursive: true })
      const hibernated = "# MEMORY.md\n\nhibernation snapshot content\n"
      writeFileSync(memoryPath, hibernated)

      executeUnpack(env, outputDir)
      expect(readFileSync(memoryPath, "utf8")).toBe(hibernated)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  }, 15_000)

  it("keeps twitter seed payload under the 30,000 char safety ceiling", () => {
    const generated = generatedWithSeeds()
    const env = buildRailwayEnvVars(generated, workspace, user)
    expect(env.CLAWS_SEED_FILES_GZ_B64.length).toBeLessThan(30_000)
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(env.CLAWS_SEED_FILES_GZ_B64, "base64")).toString("utf8"),
    ) as Record<string, string>
    expect(decoded["workspace-twitter-commander/memory/MEMORY.md"]).toContain("Maintained by")
    expect(decoded["shared/VOICE.md"]).toContain("content-writer")
  })
})
