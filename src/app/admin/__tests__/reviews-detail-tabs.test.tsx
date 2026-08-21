// @vitest-environment jsdom
/**
 * Batch G - reviews detail×tabs:
 * - tab switch clears detail
 * - skill item approve hits /skills/ endpoint (not templates)
 * MUTATION: template endpoint for skill item → fail
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import AdminReviewsPage from "@/app/admin/reviews/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: vi.fn() }),
}))

const skillItem = {
  id: "skill-1",
  name: "Research Skill",
  slug: "research-skill",
  description: "desc",
  category: "ops",
  trustTier: "UNREVIEWED",
  reviewStatus: "PENDING",
  skillMd: "# Skill",
  autoScanPassed: true,
  autoScanReport: null,
  sandboxPassed: null,
  sandboxReport: null,
  createdAt: new Date().toISOString(),
  creator: null,
}

const templateItem = {
  id: "tpl-1",
  name: "Sales Claw",
  slug: "sales-claw",
  tagline: "t",
  description: "d",
  category: "sales",
  trustTier: "UNREVIEWED",
  reviewStatus: "PENDING",
  createdAt: new Date().toISOString(),
  creator: null,
  workspaceSnapshot: JSON.stringify({ agents: [], connections: [] }),
  autoScanPassed: true,
  autoScanReport: null,
  reviewNotes: null,
  isFree: true,
  price: 0,
  tags: [] as string[],
  estimatedMonthlyCost: null,
  agentCount: 1,
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || "GET").toUpperCase()
    if (url.includes("/review-queue/templates") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [templateItem] }),
      } as Response
    }
    if (url.includes("/review-queue/skills") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [skillItem] }),
      } as Response
    }
    if (method === "POST") {
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) } as Response
  }) as unknown as typeof fetch
})

describe("Admin reviews detail × tabs (Batch G)", () => {
  it("tab switch clears detail panel", async () => {
    render(<AdminReviewsPage />)
    expect(await screen.findByRole("button", { name: "Sales Claw" })).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Sales Claw" }))
    // Detail side panel: close control appears
    expect(await screen.findByLabelText(/close/i)).toBeDefined()

    fireEvent.click(screen.getByRole("tab", { name: /Skills/i }))

    await waitFor(() => {
      expect(screen.getByText("Research Skill")).toBeDefined()
    })
    expect(screen.queryByLabelText(/close/i)).toBeNull()
    expect(screen.queryByRole("button", { name: "Sales Claw" })).toBeNull()
  })

  it("skill Approve hits /skills/ endpoint", async () => {
    render(<AdminReviewsPage />)
    fireEvent.click(await screen.findByRole("tab", { name: /Skills/i }))
    expect(await screen.findByText("Research Skill")).toBeDefined()

    const approveButtons = screen.getAllByRole("button", { name: "Approve" })
    fireEvent.click(approveButtons[0])

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      const approveCall = calls.find(
        (c) =>
          String(c[0]).includes("/approve") &&
          String(c[1]?.method || "").toUpperCase() === "POST",
      )
      expect(approveCall, "expected approve POST").toBeTruthy()
      expect(String(approveCall![0])).toContain("/review-queue/skills/skill-1/approve")
      expect(String(approveCall![0])).not.toContain("/templates/")
    })
  })

  it("MUTATION: template endpoint for skill item → fail", () => {
    const src = readFileSync(join(process.cwd(), "src/app/admin/reviews/page.tsx"), "utf8")
    expect(src).toContain("reviewQueueType")
    expect(src).toContain("handleApprove(reviewQueueType(selectedItem)")
    expect(src).toContain("reviewQueueType(rejectItem)")
    expect(src).toContain("setSelectedItem(null)")
  })
})
