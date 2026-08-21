// @vitest-environment jsdom
/**
 * Batch F - Creator profile Save routes through mutateWithFeedback.
 * MUTATION: silent catch / bypass helper → fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const show = vi.fn()

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show }),
}))

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: import("react").ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

import { CreatorDashboard } from "@/components/settings/creator-dashboard"

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || "GET").toUpperCase()
    if (url.includes("/api/creator/profile") && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          data: {
            enrolled: true,
            profile: {
              id: "c1",
              displayName: "Ada",
              bio: null,
              avatarUrl: null,
              twitterUrl: null,
              githubUrl: null,
              websiteUrl: null,
              totalTemplates: 0,
              totalSkills: 0,
              totalInstalls: 0,
              averageRating: 0,
            },
          },
        }),
      } as Response
    }
    if (url.includes("/api/creator/earnings")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            totalEarned: 0,
            pendingPayout: 0,
            paidOut: 0,
            nextPayoutDate: null,
            totalSales: 0,
          },
        }),
      } as Response
    }
    if (url.includes("/api/creator/skills") || url.includes("/api/creator/templates")) {
      return { ok: true, json: async () => ({ data: [] }) } as Response
    }
    if (method === "PUT") {
      return { ok: false, status: 500, json: async () => ({ success: false }) } as Response
    }
    return { ok: true, json: async () => ({ data: {} }) } as Response
  }) as unknown as typeof fetch
})

describe("CreatorDashboard save feedback (Batch F)", () => {
  it("PUT failure shows error snackbar (not silent)", async () => {
    render(<CreatorDashboard />)
    expect(await screen.findByDisplayValue("Ada")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }))

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      )
    })
  })

  it("MUTATION: silent catch / bypass helper → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/settings/creator-dashboard.tsx"),
      "utf8",
    )
    expect(src).toContain("mutateWithFeedback")
    expect(src).not.toMatch(/catch\s*\{\s*\/\*\s*show nothing/)
    const saveBlock = src.slice(
      src.indexOf("handleSaveProfile"),
      src.indexOf("if (isLoadingProfile)"),
    )
    expect(saveBlock).toContain("mutateWithFeedback")
    expect(saveBlock).toContain("Profile saved")
  })
})
