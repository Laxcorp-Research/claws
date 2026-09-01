import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { buildRuntimeStateGzipFixture } from "@/lib/openclaw/snapshot-conversations"

const mockCreateApproval = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/openclaw/pending-approval", () => ({
  createDeliverableApprovalFromFileVersion: (...args: unknown[]) => mockCreateApproval(...args),
}))

import {
  DELIVERABLE_EXTRACT_EVENT_KIND,
  extractDeliverablesFromGzip,
  hashFileContent,
  isDeliverableExtractPath,
} from "@/lib/artifacts/extract-deliverables"

describe("isDeliverableExtractPath", () => {
  it("allows shared/deliverables markdown only", () => {
    expect(isDeliverableExtractPath("shared/deliverables/x-content-cycle.md")).toBe(true)
    expect(isDeliverableExtractPath("shared/deliverables/recap.txt")).toBe(true)
    expect(isDeliverableExtractPath("shared/USER.md")).toBe(false)
    expect(isDeliverableExtractPath("shared/deliverables/.hidden.md")).toBe(false)
    expect(isDeliverableExtractPath("shared/deliverables/../VOICE.md")).toBe(false)
    expect(isDeliverableExtractPath("openclaw.json")).toBe(false)
    expect(isDeliverableExtractPath(".env")).toBe(false)
    expect(isDeliverableExtractPath("cron/jobs.json")).toBe(false)
    expect(isDeliverableExtractPath("agents/main/sessions/s1.jsonl")).toBe(false)
    expect(isDeliverableExtractPath("shared/deliverables/photo.png")).toBe(false)
  })
})

describe("extractDeliverablesFromGzip", () => {
  beforeEach(() => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      seedFiles: [
        { path: "shared/deliverables/x-content-cycle.md", content: "# Format\nseed" },
      ],
    })
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.fileVersion.create as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ data }: { data: { logicalPath: string; version: number } }) => ({
        id: `fv-${data.logicalPath}-${data.version}`,
      }),
    )
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-1" })
    mockCreateApproval.mockReset()
    mockCreateApproval.mockResolvedValue({ created: true, id: "hr-1" })
  })

  it("inserts FileVersion + ActivityLog for a new deliverable", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "shared/deliverables/x-content-cycle.md": "# Cycle\nnew mission body",
      "shared/USER.md": "ignore me",
      "agents/main/sessions/s1.jsonl": "{}",
    })
    const result = await extractDeliverablesFromGzip({ workspaceId: "ws-1", gzip })
    expect(result.extracted).toBe(1)
    expect(result.skippedUnchanged).toBe(0)
    expect(prismaMock.fileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 1,
        trigger: "MISSION",
        createdBy: "system",
        contentHash: hashFileContent("# Cycle\nnew mission body"),
      }),
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "SYSTEM",
        metadata: expect.stringContaining(DELIVERABLE_EXTRACT_EVENT_KIND),
      }),
    })
    expect(mockCreateApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        title: "x-content-cycle",
      }),
    )
  })

  it("does not create a HUMAN_REQUEST for report-type recap files", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "shared/deliverables/x-daily-recap.md": "# Recap\ndone",
    })
    await extractDeliverablesFromGzip({ workspaceId: "ws-1", gzip })
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it("marks first extract SEED when bytes match Workspace.seedFiles", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "shared/deliverables/x-content-cycle.md": "# Format\nseed",
    })
    await extractDeliverablesFromGzip({ workspaceId: "ws-1", gzip })
    expect(prismaMock.fileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trigger: "SEED", version: 1 }),
    })
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it("does not bump when contentHash matches latest", async () => {
    const body = "# Cycle\nsame"
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 2,
      contentHash: hashFileContent(body),
    })
    const gzip = buildRuntimeStateGzipFixture({
      "shared/deliverables/x-content-cycle.md": body,
    })
    const result = await extractDeliverablesFromGzip({ workspaceId: "ws-1", gzip })
    expect(result.extracted).toBe(0)
    expect(result.skippedUnchanged).toBe(1)
    expect(prismaMock.fileVersion.create).not.toHaveBeenCalled()
  })

  it("bumps version when content changes", async () => {
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 1,
      contentHash: hashFileContent("old"),
    })
    const gzip = buildRuntimeStateGzipFixture({
      "shared/deliverables/x-content-cycle.md": "new body",
    })
    await extractDeliverablesFromGzip({ workspaceId: "ws-1", gzip })
    expect(prismaMock.fileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, trigger: "MISSION" }),
    })
  })

  it("MUTATION: finalize must call extract after persist", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/state/finalize/route.ts"),
      "utf8",
    )
    expect(src).toContain("extractDeliverablesFromGzip")
    expect(src.indexOf("extractDeliverablesFromGzip")).toBeGreaterThan(
      src.indexOf("persistRuntimeStateSnapshot"),
    )
    expect(src).toContain("deliverable extract failed (continuing)")
  })

  it("MUTATION: TASK_COMPLETE must nudge sync-now", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/activity/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain("nudgeDeliverableSyncNow")
    expect(src).toMatch(/TASK_COMPLETE[\s\S]{0,200}nudgeDeliverableSyncNow/)
  })

  it("MUTATION: activity ingest must not create approvals from outbound chat regex", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/activity/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).not.toContain("createPendingApprovalFromOutbound")
    expect(src).not.toContain("looksLikeApprovalRequest")
  })
})
