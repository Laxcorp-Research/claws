// @vitest-environment jsdom
//
// PR (version-ui-honesty): the banner only prompts when the stable row is
// genuinely NEWER than the deployed image (BUG-1), and its copy is truthful
// about applying on the next redeploy — no "auto-updated in 48h / apply
// immediately" (BUG-2).

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { VersionUpdateBanner } from "@/components/dashboard/version-update-banner"

const IMG = (v: string) => `ghcr.io/laxcorp-research/openclaw-runtime:${v}`

function stubStable(version: string, isSecurityPatch = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { version, dockerImage: IMG(version), isSecurityPatch, releaseNotes: null },
      }),
    }),
  )
}

// Flush the fetch().then(json).then(setState) chain so the effect's state update
// has rendered before we assert.
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("VersionUpdateBanner — prompts only when stable is genuinely newer", () => {
  it("SHOWS when stable (-3) is newer than deployed (-2), with truthful pending copy", async () => {
    stubStable("2026.5.22-3")
    const { container } = render(
      <VersionUpdateBanner workspaceId="ws-1" currentImage={IMG("2026.5.22-2")} onUpdated={vi.fn()} />,
    )
    expect(await screen.findByText("Update available")).toBeTruthy()
    expect(screen.getByText("Queue update")).toBeTruthy()
    expect(container.textContent ?? "").toMatch(/applies on the next redeploy/i)
  })

  it("HIDDEN when stable (-2) is OLDER than deployed (-3) — BUG-1 regression", async () => {
    stubStable("2026.5.22-2")
    const { container } = render(
      <VersionUpdateBanner workspaceId="ws-1" currentImage={IMG("2026.5.22-3")} onUpdated={vi.fn()} />,
    )
    await flush()
    expect(screen.queryByText("Update available")).toBeNull()
    expect(container.textContent ?? "").toBe("")
  })

  it("HIDDEN when deployed equals stable", async () => {
    stubStable("2026.5.22-3")
    const { container } = render(
      <VersionUpdateBanner workspaceId="ws-1" currentImage={IMG("2026.5.22-3")} onUpdated={vi.fn()} />,
    )
    await flush()
    expect(container.textContent ?? "").toBe("")
  })

  it("BUG-2 copy lock: no 'auto-updated in 48h' / 'apply immediately' claims on the security banner", async () => {
    stubStable("2026.5.22-3", true)
    const { container } = render(
      <VersionUpdateBanner workspaceId="ws-1" currentImage={IMG("2026.5.22-2")} onUpdated={vi.fn()} />,
    )
    expect(await screen.findByText("Security update available")).toBeTruthy()
    const text = container.textContent ?? ""
    expect(text).not.toMatch(/automatically updated within 48 hours/i)
    expect(text).not.toMatch(/apply immediately/i)
    expect(text).toMatch(/has not been updated yet/i)
  })
})
