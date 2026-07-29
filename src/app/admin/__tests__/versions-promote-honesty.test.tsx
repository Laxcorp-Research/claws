// @vitest-environment jsdom
/**
 * Promote-flow honesty (PR-D / promote-truth Phase B).
 * - Surface API error detail in snackbar (not a generic catch string)
 * - Refetch versions before success verdict
 * - Success snackbar "vX is now Stable"
 * - Disabled-while-pending on Promote buttons
 * MUTATION: restore generic `throw new Error("Could not promote version")` alone → fails
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import AdminVersionsPage from "@/app/admin/versions/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const showSnackbar = vi.fn()
vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: showSnackbar }),
}))

interface VersionRow {
  id: string
  version: string
  isStable: boolean
  isLatest: boolean
  isSecurityPatch: boolean
  dockerImage: string
  releaseNotes: string | null
  breakingChanges: string | null
  releasedAt: string
  stableAt: string | null
  deploymentCount: number
}

const PROMOTE_OK: VersionRow = {
  id: "v-ok",
  version: "2026.5.22-9",
  isStable: false,
  isLatest: true,
  isSecurityPatch: false,
  dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-9",
  releaseNotes: null,
  breakingChanges: null,
  releasedAt: "2026-05-22T00:00:00.000Z",
  stableAt: null,
  deploymentCount: 1,
}

const PROMOTE_OTHER: VersionRow = {
  ...PROMOTE_OK,
  id: "v-other",
  version: "2026.5.22-8",
  isLatest: false,
  dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-8",
}

function listResponse(rows: VersionRow[] = [PROMOTE_OK, PROMOTE_OTHER]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: rows }),
  }
}

afterEach(() => {
  cleanup()
  showSnackbar.mockReset()
})

beforeEach(() => {
  showSnackbar.mockReset()
})

describe("admin/versions promote-flow honesty", () => {
  it("surfaces API error detail in the snackbar (not generic catch)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/admin/versions" && (!init || !init.method || init.method === "GET")) {
        return listResponse()
      }
      if (url.includes("/promote")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            error: { code: "INVALID_STATE", message: "GHCR manifest missing for :2026.5.22-9" },
          }),
        }
      }
      return listResponse()
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminVersionsPage />)
    const promote = await screen.findAllByRole("button", { name: "Promote to Stable" })
    fireEvent.click(promote[0]!)

    await waitFor(() => {
      expect(showSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "GHCR manifest missing for :2026.5.22-9",
        }),
      )
    })
    expect(showSnackbar).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Could not promote version" }),
    )
  })

  it("success snackbar says vX is now Stable after refetch", async () => {
    let listCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/admin/versions" && (!init || !init.method || init.method === "GET")) {
        listCalls += 1
        if (listCalls === 1) return listResponse()
        return listResponse([
          {
            ...PROMOTE_OK,
            isStable: true,
            stableAt: "2026-05-22T02:00:00.000Z",
          },
          PROMOTE_OTHER,
        ])
      }
      if (url.includes("/promote")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { ...PROMOTE_OK, isStable: true } }),
        }
      }
      return listResponse()
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminVersionsPage />)
    const promote = await screen.findAllByRole("button", { name: "Promote to Stable" })
    fireEvent.click(promote[0]!)

    await waitFor(() => {
      expect(showSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "v2026.5.22-9 is now Stable",
        }),
      )
    })
    // Initial load + post-promote refetch before verdict
    expect(listCalls).toBeGreaterThanOrEqual(2)
  })

  it("disables Promote buttons while a promote is pending", async () => {
    let resolvePromote!: (value: unknown) => void
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/admin/versions" && (!init || !init.method || init.method === "GET")) {
        return listResponse()
      }
      if (url.includes("/promote")) {
        return new Promise((resolve) => {
          resolvePromote = resolve
        })
      }
      return listResponse()
    })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<AdminVersionsPage />)
    const buttons = await screen.findAllByRole("button", { name: "Promote to Stable" })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(buttons[0]!)

    await waitFor(() => {
      const pending = screen.getAllByRole("button", { name: "Promote to Stable" })
      for (const btn of pending) {
        expect(btn).toHaveProperty("disabled", true)
      }
    })

    resolvePromote({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: PROMOTE_OK }),
    })
  })

  it("MUTATION: generic-catch restored → honesty contract fails", () => {
    const src = readFileSync(join(process.cwd(), "src/app/admin/versions/page.tsx"), "utf8")
    expect(src).toContain("json.error?.message")
    expect(src).toContain("is now Stable")
    expect(src).toContain("disabled={actionLoading !== null}")
    // Must not hardcode-only throw without reading API body
    expect(src).not.toMatch(
      /if\s*\(\s*!res\.ok\s*\)\s*throw\s+new\s+Error\(\s*["']Could not promote version["']\s*\)/,
    )
    // Must not pin a fixed errorMessage that masks thrown detail
    expect(src).not.toMatch(
      /mutateWithFeedback\([\s\S]*?errorMessage:\s*["']Could not promote version["']/,
    )
  })
})
