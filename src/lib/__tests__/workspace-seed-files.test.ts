import { describe, expect, it } from "vitest"
import {
  cloneSeedFilesForWorkspace,
  expandSeedFilesForAgents,
  isSafeSeedRelativePath,
  parseSeedFiles,
  resolveWorkspaceSeedFiles,
} from "@/lib/workspace-seed-files"

describe("workspace seed files helpers", () => {
  it("rejects path traversal and non-md paths", () => {
    expect(isSafeSeedRelativePath("memory/MEMORY.md")).toBe(true)
    expect(isSafeSeedRelativePath("VOICE.md")).toBe(true)
    expect(isSafeSeedRelativePath("../etc/passwd")).toBe(false)
    expect(isSafeSeedRelativePath("/abs/VOICE.md")).toBe(false)
    expect(isSafeSeedRelativePath("foo\\VOICE.md")).toBe(false)
    expect(isSafeSeedRelativePath("VOICE.txt")).toBe(false)
  })

  it("clone drops unsafe entries", () => {
    const cloned = cloneSeedFilesForWorkspace([
      { path: "VOICE.md", content: "ok" },
      { path: "../secret", content: "no" },
    ])
    expect(cloned).toEqual([{ path: "VOICE.md", content: "ok" }])
  })

  it("dual-read prefers workspace copy then template snapshot", () => {
    expect(
      resolveWorkspaceSeedFiles({
        seedFiles: [{ path: "VOICE.md", content: "workspace" }],
        clawTemplateSnapshot: { files: [{ path: "VOICE.md", content: "template" }] },
      }),
    ).toEqual([{ path: "VOICE.md", content: "workspace" }])

    expect(
      resolveWorkspaceSeedFiles({
        seedFiles: null,
        clawTemplateSnapshot: JSON.stringify({
          files: [{ path: "memory/MEMORY.md", content: "from template" }],
        }),
      }),
    ).toEqual([{ path: "memory/MEMORY.md", content: "from template" }])
  })

  it("expand fans into every workspace-* dir and skips unsafe dirs", () => {
    const out = expandSeedFilesForAgents(
      [{ path: "VOICE.md", content: "v" }],
      ["workspace-twitter-commander", "../escape", "workspace-content-writer"],
    )
    expect(out).toEqual({
      "workspace-twitter-commander/VOICE.md": "v",
      "workspace-content-writer/VOICE.md": "v",
    })
  })

  it("parseSeedFiles returns null for garbage (legacy dual-read trigger)", () => {
    expect(parseSeedFiles({ not: "array" })).toBeNull()
    expect(parseSeedFiles(null)).toBeNull()
  })
})
