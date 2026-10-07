import { gunzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { buildWorkspaceFileMap } from "@/lib/openclaw/deployer"
import type { GeneratedWorkspace } from "@/lib/openclaw/generator"
import {
  dockerRuntimeCommandMatchesRailway,
  runtimeLaunchEnv,
  workspaceFilesForBoot,
} from "@/lib/openclaw/docker-runtime-launch"

const generated = {
  "openclaw.json": "{\"gateway\":{}}",
  ".env": "ANTHROPIC_API_KEY=sk-ant-founder-local\n# comment\nOPENCLAW_GATEWAY_TOKEN=from-file\n",
  workspaces: {
    "workspace-a": {
      "SOUL.md": "soul",
      "AGENTS.md": "agents",
      "USER.md": "user",
      "IDENTITY.md": "id",
      "TOOLS.md": "tools",
      "HEARTBEAT.md": "hb",
      "BOOT.md": "boot",
      skills: { writer: { "SKILL.md": "skill" } },
    },
  },
  "cron/jobs.json": "{\"jobs\":[]}",
  gatewayToken: "generated-token",
  seedFiles: { "shared/VOICE.md": "voice" },
  runtimeContract: "9.4",
} as GeneratedWorkspace

describe("docker runtime launch", () => {
  it("file map matches the Railway unpack payload", () => {
    expect(workspaceFilesForBoot(generated)).toEqual(buildWorkspaceFileMap(generated))
  })

  it("puts the pasted key in process env and in the gzipped .env the boot script unpacks", () => {
    expect(dockerRuntimeCommandMatchesRailway()).toBe(true)
    const env = runtimeLaunchEnv({
      generated,
      files: workspaceFilesForBoot(generated),
      gatewayToken: "persisted-token",
    })
    expect(env).toContain("ANTHROPIC_API_KEY=sk-ant-founder-local")
    expect(env).toContain("OPENCLAW_GATEWAY_TOKEN=persisted-token")
    expect(env.some((line) => line.startsWith("OPENCLAW_GATEWAY_TOKEN=from-file"))).toBe(false)
    const packed = env.find((line) => line.startsWith("CLAWS_ENV_GZ_B64="))
    expect(packed).toBeDefined()
    const raw = gunzipSync(
      Buffer.from(packed!.slice("CLAWS_ENV_GZ_B64=".length), "base64"),
    ).toString("utf8")
    expect(raw).toContain("ANTHROPIC_API_KEY=sk-ant-founder-local")
    const filesPacked = env.find((line) => line.startsWith("CLAWS_FILES_GZ_B64="))
    const files = JSON.parse(
      gunzipSync(
        Buffer.from(filesPacked!.slice("CLAWS_FILES_GZ_B64=".length), "base64"),
      ).toString("utf8"),
    ) as Record<string, string>
    expect(files["workspace-a/SOUL.md"]).toBe("soul")
    expect(files["workspace-a/skills/writer/SKILL.md"]).toBe("skill")
  })
})
