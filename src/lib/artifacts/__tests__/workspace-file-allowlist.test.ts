import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  isSharedWritePath,
  WORKSPACE_FILE_MAX_BYTES,
  WORKSPACE_FILE_PREFIX,
  WORKSPACE_FILE_TEXT_EXT,
} from "@/lib/artifacts/workspace-file-allowlist"
import {
  isSharedWritePath as isSharedWritePathMjs,
  WORKSPACE_FILE_MAX_BYTES as MJS_MAX,
  WORKSPACE_FILE_PREFIX as MJS_PREFIX,
  WORKSPACE_FILE_TEXT_EXT as MJS_EXT,
} from "../../../../container/claws-activity-reporter/workspace-files.mjs"

const CASES: Array<[string, boolean]> = [
  ["shared/USER.md", true],
  ["shared/VOICE.md", true],
  ["shared/deliverables/x-content-cycle.md", true],
  ["shared/deliverables/recap.txt", true],
  ["shared/deliverables/x-content-cycle.md.status.json", true],
  ["shared/notes.JSON", true],
  ["shared/deliverables/.status.json", false],
  ["shared/.hidden.md", false],
  ["shared/deliverables/../VOICE.md", false],
  ["shared/photo.png", false],
  ["shared/openclaw.json", false],
  ["openclaw.json", false],
  [".env", false],
  ["shared/.env", false],
  ["cron/jobs.json", false],
  ["shared/cron/jobs.json", false],
  ["agents/main/agent/MEMORY.md", false],
  ["workspace-main/memory/MEMORY.md", false],
  ["/etc/passwd", false],
  ["shared", false],
  ["shared/", false],
]

describe("isSharedWritePath (TS + overlay stay in lockstep)", () => {
  it("exports match the overlay module", () => {
    expect(WORKSPACE_FILE_PREFIX).toBe("shared/")
    expect(WORKSPACE_FILE_PREFIX).toBe(MJS_PREFIX)
    expect(WORKSPACE_FILE_MAX_BYTES).toBe(256 * 1024)
    expect(WORKSPACE_FILE_MAX_BYTES).toBe(MJS_MAX)
    expect([...WORKSPACE_FILE_TEXT_EXT]).toEqual([...MJS_EXT])
  })

  it.each(CASES)("%s → %s", (path, allowed) => {
    expect(isSharedWritePath(path)).toBe(allowed)
    expect(isSharedWritePathMjs(path)).toBe(allowed)
  })
})

describe("MUTATION: overlay auth is gateway token, not metering secret", () => {
  it("workspace-files.mjs never accepts the metering secret", () => {
    const src = readFileSync(
      join(process.cwd(), "container/claws-activity-reporter/workspace-files.mjs"),
      "utf8",
    )
    expect(src).toContain("OPENCLAW_GATEWAY_TOKEN")
    expect(src).not.toContain("CLAWS_METERING_SECRET")
    expect(src).not.toContain("METERING_MASTER_SECRET")
    expect(src).not.toContain("x-metering-secret")
  })

  it("plugin registers PUT /internal/workspace-files", () => {
    const src = readFileSync(
      join(process.cwd(), "container/claws-activity-reporter/index.mjs"),
      "utf8",
    )
    expect(src).toContain("/internal/workspace-files")
    expect(src).toContain("handleWorkspaceFilesWrite")
    expect(src).toContain("assertGatewayToken")
    expect(src).toMatch(/registerHttpRoute\(\{[\s\S]*\/internal\/workspace-files/)
  })
})
