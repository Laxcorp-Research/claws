// @vitest-environment jsdom
//
// GH #5: the "Latest" badge must be DERIVED from the data (newest by
// releasedAt), not read from the stored isLatest flag — which drifts on prod
// (seed sets it on v2.5.0; the stable/promote path never updates it). This test
// reproduces the prod bug: stored isLatest is on the WRONG (oldest) row, and we
// prove the badge renders on the newest row instead.
// Mutation: revert the badge to {v.isLatest && …} → the badge lands on v2.5.0
// and this test fails.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import AdminVersionsPage from "@/app/admin/versions/page"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

// API returns orderBy releasedAt desc; mirror that (newest first). The stored
// isLatest is deliberately on the OLDER row to model prod's stale state.
const ROWS = [
  {
    id: "v-new",
    version: "2026.5.22-2",
    isStable: true,
    isLatest: false, // stale: NOT flagged latest on prod
    isSecurityPatch: false,
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-2",
    releaseNotes: null,
    breakingChanges: null,
    releasedAt: "2026-05-22T00:00:00.000Z",
    stableAt: "2026-05-22T01:00:00.000Z",
    deploymentCount: 3,
  },
  {
    id: "v-seed",
    version: "2.5.0",
    isStable: false,
    isLatest: true, // stale flag stuck on the oldest row (the bug)
    isSecurityPatch: false,
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:latest",
    releaseNotes: "Initial stable release for Claws platform launch.",
    breakingChanges: null,
    releasedAt: "2026-03-01T00:00:00.000Z",
    stableAt: null,
    deploymentCount: 0,
  },
]

afterEach(() => cleanup())
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: ROWS }),
  }) as unknown as typeof fetch
})

describe("admin/versions Latest badge is derived from newest releasedAt (GH #5)", () => {
  it("renders exactly one Latest badge, on the newest row — not the stale-flagged v2.5.0", async () => {
    render(<AdminVersionsPage />)

    const badge = await screen.findByText("Latest")
    expect(screen.getAllByText("Latest")).toHaveLength(1)

    // The badge shares its flex container with the version label.
    const flex = badge.parentElement as HTMLElement
    expect(flex.textContent).toContain("2026.5.22-2")
    expect(flex.textContent).not.toContain("2.5.0")
  })

  it("labels 2.5.0 as Never promotable and hides Promote on that row", async () => {
    render(<AdminVersionsPage />)

    const neverBadges = await screen.findAllByText("Never promotable")
    expect(neverBadges.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("Promote to Stable")).toBeNull()
  })
})
