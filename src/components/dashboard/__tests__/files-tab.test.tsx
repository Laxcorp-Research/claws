// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FilesTab } from "@/components/dashboard/files-tab"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockFilesApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/api/workspaces/ws-1/files") && (!init || init.method === undefined || init.method === "GET")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            files: [
              {
                logicalPath: "shared/USER.md",
                owner: "human",
                editable: true,
                source: "seed",
                bytes: 8,
                updatedAt: null,
                latestVersion: 1,
                latestFileVersionId: "fv-1",
                createdBy: "system",
              },
              {
                logicalPath: "workspace-scout/memory/MEMORY.md",
                owner: "agent",
                editable: false,
                source: "snapshot",
                bytes: 12,
                updatedAt: "2026-09-01T12:00:00.000Z",
                latestVersion: null,
                latestFileVersionId: null,
                createdBy: null,
              },
            ],
          },
        }),
      } as Response
    }
    if (url.includes("/files/content?path=")) {
      const path = decodeURIComponent(url.split("path=")[1] ?? "")
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            logicalPath: path,
            content: path === "shared/USER.md" ? "# Founder" : "# Agent memory",
            bytes: 10,
            source: path.startsWith("shared/") ? "versioned" : "snapshot",
            owner: path.startsWith("shared/") ? "human" : "agent",
            editable: path.startsWith("shared/"),
            latestVersion: path.startsWith("shared/") ? 1 : null,
            latestFileVersionId: path.startsWith("shared/") ? "fv-1" : null,
            history: path.startsWith("shared/")
              ? [
                  {
                    id: "fv-1",
                    version: 1,
                    trigger: "SEED",
                    createdAt: "2026-09-01T00:00:00.000Z",
                    createdBy: "system",
                    decision: "NONE",
                  },
                ]
              : [],
          },
        }),
      } as Response
    }
    if (url.endsWith("/files/restore")) {
      return { ok: true, json: async () => ({ success: true, data: { trigger: "RESTORE" } }) } as Response
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) } as Response
  })
  global.fetch = fetchMock
  return fetchMock
}

describe("FilesTab", () => {
  it("lists shared files and agent memory through truncation-ready paths", async () => {
    mockFilesApi()
    render(<FilesTab workspaceId="ws-1" />)

    const shared = await screen.findByText("shared/USER.md")
    const memory = await screen.findByText("workspace-scout/memory/MEMORY.md")
    expect(shared.className).toContain("text-ellipsis")
    expect(memory.className).toContain("text-ellipsis")
    expect(screen.getByText(/Per-agent memory is read-only/)).toBeTruthy()
  })

  it("opens a shared file with Edit and Restore; memory stays read-only", async () => {
    mockFilesApi()
    render(<FilesTab workspaceId="ws-1" />)

    fireEvent.click(await screen.findByText("shared/USER.md"))
    expect(await screen.findByRole("heading", { name: "Founder" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy()

    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.click(await screen.findByText("workspace-scout/memory/MEMORY.md"))
    expect(await screen.findByRole("heading", { name: "Agent memory" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull()
  })
})
