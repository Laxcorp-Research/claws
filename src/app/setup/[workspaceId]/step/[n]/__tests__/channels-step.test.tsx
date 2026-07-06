// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ workspaceId: "ws-1", n: "4" }),
  useSearchParams: () => new URLSearchParams(),
}))

import { Step4, mapDeployStatus } from "@/app/setup/[workspaceId]/step/[n]/page"

function jsonResponse(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
}

describe("Setup Step 4 channel persistence UI", () => {
  beforeEach(() => {
    push.mockReset()
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/channels/ws-1") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          success: true,
          data: { channels: {}, configuredChannelIds: [], hasConfiguredChannels: false },
        })
      }
      if (href.includes("/api/channels/ws-1") && init?.method === "POST") {
        return jsonResponse({
          success: true,
          data: {
            channels: { telegram: { configured: true, fields: { botToken: "1234...oken" } } },
            configuredChannelIds: ["telegram"],
            hasConfiguredChannels: true,
          },
        })
      }
      return jsonResponse({ success: true, data: {} })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders real launch-channel modals and coming-soon staged rows", async () => {
    render(<Step4 workspaceId="ws-1" />)

    expect(await screen.findByText(/No channel\? Your Claw is fully usable from the dashboard/i)).toBeDefined()
    expect(screen.getAllByText("Coming soon")).toHaveLength(2)
    expect(screen.getByText("WhatsApp")).toBeDefined()
    expect(screen.getByText("Microsoft Teams")).toBeDefined()

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0])
    expect(await screen.findByRole("heading", { name: "Connect Telegram" })).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText("123456789:AA..."), {
      target: { value: "123456789:telegram-secret-token" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/channels/ws-1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            channel: "telegram",
            config: { botToken: "123456789:telegram-secret-token" },
          }),
        }),
      )
    })
    expect(await screen.findByText(/1234\.\.\.oken/)).toBeDefined()
  })

  it("renders persisted configured channels as connected truth from GET", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({
      success: true,
      data: {
        channels: { discord: { configured: true, fields: { token: "disc...oken" } } },
        configuredChannelIds: ["discord"],
        hasConfiguredChannels: true,
      },
    })))

    render(<Step4 workspaceId="ws-1" />)

    expect(await screen.findByText(/disc\.\.\.oken/)).toBeDefined()
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined()
  })

  it("hides Applying channel config deploy step when no channel is configured", () => {
    expect(mapDeployStatus("HEALTH_CHECK", null, false).map((step) => step.label)).not.toContain("Applying channel config")
    expect(mapDeployStatus("HEALTH_CHECK", null, true).map((step) => step.label)).toContain("Applying channel config")
  })

  it("deletes timeout-based fake channel connection mutation", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )

    expect(source).not.toContain("setChannelStatuses")
    expect(source).not.toContain("setTimeout(resolve")
  })
})
