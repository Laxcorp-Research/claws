import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  agentLabelFromMemoryPath,
  catalogOwner,
  isAgentMemoryPath,
  isFilesCatalogPath,
  mergeCatalogEntries,
} from "@/lib/artifacts/files-catalog"

describe("isAgentMemoryPath", () => {
  it("allows workspace-{agent}/memory text files", () => {
    expect(isAgentMemoryPath("workspace-twitter-commander/memory/MEMORY.md")).toBe(true)
    expect(isAgentMemoryPath("workspace-scout/memory/2026-09-01.md")).toBe(true)
    expect(isAgentMemoryPath("workspace-scout/memory/notes.txt")).toBe(true)
  })

  it("rejects agent workspace files that are not memory, plus traversal", () => {
    expect(isAgentMemoryPath("workspace-twitter-commander/SOUL.md")).toBe(false)
    expect(isAgentMemoryPath("workspace-twitter-commander/USER.md")).toBe(false)
    expect(isAgentMemoryPath("agents/main/agent/MEMORY.md")).toBe(false)
    expect(isAgentMemoryPath("shared/USER.md")).toBe(false)
    expect(isAgentMemoryPath("workspace-x/memory/.hidden.md")).toBe(false)
    expect(isAgentMemoryPath("workspace-x/memory/../SOUL.md")).toBe(false)
    expect(isAgentMemoryPath("workspace-x/memory/openclaw.json")).toBe(false)
    expect(isAgentMemoryPath("/etc/passwd")).toBe(false)
  })
})

describe("isFilesCatalogPath / catalogOwner", () => {
  it("lists shared human-owned files and agent memory", () => {
    expect(isFilesCatalogPath("shared/USER.md")).toBe(true)
    expect(isFilesCatalogPath("shared/VOICE.md")).toBe(true)
    expect(isFilesCatalogPath("shared/deliverables/x-content-cycle.md")).toBe(true)
    expect(isFilesCatalogPath("workspace-main/memory/MEMORY.md")).toBe(true)
    expect(catalogOwner("shared/USER.md")).toBe("human")
    expect(catalogOwner("workspace-main/memory/MEMORY.md")).toBe("agent")
  })

  it("never lists config, secrets, or host-absolute paths", () => {
    expect(isFilesCatalogPath("openclaw.json")).toBe(false)
    expect(isFilesCatalogPath(".env")).toBe(false)
    expect(isFilesCatalogPath("cron/jobs.json")).toBe(false)
    expect(isFilesCatalogPath("shared/.env")).toBe(false)
    expect(catalogOwner("workspace-main/SOUL.md")).toBeNull()
  })
})

describe("mergeCatalogEntries", () => {
  it("prefers FileVersion over snapshot over seed", () => {
    const merged = mergeCatalogEntries([
      {
        logicalPath: "shared/USER.md",
        layer: "seed",
        bytes: 4,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        logicalPath: "shared/USER.md",
        layer: "snapshot",
        bytes: 8,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        logicalPath: "shared/USER.md",
        layer: "versioned",
        bytes: 12,
        updatedAt: "2026-03-01T00:00:00.000Z",
        latestVersion: 3,
        latestFileVersionId: "fv-3",
        createdBy: "founder@test.com",
      },
      {
        logicalPath: "workspace-scout/memory/MEMORY.md",
        layer: "snapshot",
        bytes: 20,
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ])
    expect(merged).toEqual([
      expect.objectContaining({
        logicalPath: "shared/USER.md",
        owner: "human",
        editable: true,
        source: "versioned",
        latestVersion: 3,
        latestFileVersionId: "fv-3",
      }),
      expect.objectContaining({
        logicalPath: "workspace-scout/memory/MEMORY.md",
        owner: "agent",
        editable: false,
        source: "snapshot",
      }),
    ])
  })

  it("drops paths outside the catalog allowlist", () => {
    const merged = mergeCatalogEntries([
      {
        logicalPath: "workspace-scout/SOUL.md",
        layer: "snapshot",
        bytes: 10,
        updatedAt: null,
      },
    ])
    expect(merged).toEqual([])
  })

  it("labels the agent from the workspace-* prefix", () => {
    expect(agentLabelFromMemoryPath("workspace-twitter-commander/memory/MEMORY.md")).toBe(
      "twitter-commander",
    )
  })
})

describe("MUTATION: catalog module stays prisma-free", () => {
  it("does not import db or live-write", () => {
    const src = readFileSync(resolve("src/lib/artifacts/files-catalog.ts"), "utf8")
    expect(src).not.toContain("@/lib/db")
    expect(src).not.toContain("@prisma")
    expect(src).not.toContain("writeWorkspaceSharedFile")
  })

  it("MUTATION: Files tab client does not import prisma loaders", () => {
    const src = readFileSync(resolve("src/components/dashboard/files-tab.tsx"), "utf8")
    expect(src).not.toContain("load-workspace-files")
    expect(src).not.toContain("extract-deliverables")
    expect(src).not.toContain("@/lib/db")
  })
})
