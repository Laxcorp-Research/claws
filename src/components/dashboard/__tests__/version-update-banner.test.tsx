// @vitest-environment jsdom
//
// PR (version-ui-honesty): the banner only prompts when the stable row is
// genuinely NEWER than the deployed image (BUG-1), and its copy is truthful
// about applying on the next redeploy - no "auto-updated in 48h / apply
// immediately" (BUG-2).

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
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

describe("VersionUpdateBanner - prompts only when stable is genuinely newer", () => {
  it("renders when stable is newer and uses the redeploy CTA", async () => {
    stubStable("2026.5.22-3")
    const onRedeploy = vi.fn()
    const { container } = render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-2")} onRedeploy={onRedeploy} />,
    )
    expect(await screen.findByText("A runtime update is available - redeploy to apply")).toBeTruthy()
    expect(screen.queryByText(/queue/i)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Redeploy" }))
    expect(onRedeploy).toHaveBeenCalledTimes(1)
    expect(container.textContent ?? "").toMatch(/current stable runtime is v2026\.5\.22-3/i)
  })

  it("HIDDEN when stable (-2) is OLDER than deployed (-3) - BUG-1 regression", async () => {
    stubStable("2026.5.22-2")
    const { container } = render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-3")} onRedeploy={vi.fn()} />,
    )
    await flush()
    expect(screen.queryByText("Update available")).toBeNull()
    expect(container.textContent ?? "").toBe("")
  })

  it("HIDDEN when deployed equals stable", async () => {
    stubStable("2026.5.22-3")
    const { container } = render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-3")} onRedeploy={vi.fn()} />,
    )
    await flush()
    expect(container.textContent ?? "").toBe("")
  })

  it("clears after redeploy when current image equals stable", async () => {
    stubStable("2026.5.22-3")
    const { container, rerender } = render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-2")} onRedeploy={vi.fn()} />,
    )
    expect(await screen.findByText("A runtime update is available - redeploy to apply")).toBeTruthy()

    rerender(<VersionUpdateBanner currentImage={IMG("2026.5.22-3")} onRedeploy={vi.fn()} />)
    await flush()
    expect(container.textContent ?? "").toBe("")
  })

  it("BUG-2 copy lock: no queue, auto-update, or immediate claims on the security banner", async () => {
    stubStable("2026.5.22-3", true)
    const { container } = render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-2")} onRedeploy={vi.fn()} />,
    )
    expect(await screen.findByText("A runtime update is available - redeploy to apply")).toBeTruthy()
    const text = container.textContent ?? ""
    expect(text).not.toMatch(/queue/i)
    expect(text).not.toMatch(/automatically updated within 48 hours/i)
    expect(text).not.toMatch(/apply immediately/i)
  })

  it("dedupe: can render update copy without a second Redeploy button when drift banner already has one", async () => {
    stubStable("2026.5.22-3")
    render(
      <VersionUpdateBanner currentImage={IMG("2026.5.22-2")} onRedeploy={vi.fn()} showRedeployAction={false} />,
    )

    expect(await screen.findByText("A runtime update is available - redeploy to apply")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Redeploy" })).toBeNull()
  })
})
