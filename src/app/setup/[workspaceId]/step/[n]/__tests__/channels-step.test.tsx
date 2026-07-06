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
import type { ChannelId, ChannelLiveState } from "@/lib/openclaw/channel-config"

function jsonResponse(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
}

function deferredResponse(data: unknown) {
  let resolve!: () => void
  const gate = new Promise<void>((r) => { resolve = r })
  return {
    resolve,
    promise: gate.then(() => new Response(JSON.stringify(data), { status: 200 })),
  }
}

type TestChannelStatusData = {
  channels: Record<ChannelId, { configured: boolean; live: ChannelLiveState; detail?: string }>
  configuredChannelIds: ChannelId[]
  hasConfiguredChannels: boolean
}

function emptyStatusData(): TestChannelStatusData {
  return {
    channels: {
      telegram: { configured: false, live: "unknown" },
      discord: { configured: false, live: "unknown" },
      slack: { configured: false, live: "unknown" },
      whatsapp: { configured: false, live: "unknown" },
      msteams: { configured: false, live: "unknown" },
    },
    configuredChannelIds: [],
    hasConfiguredChannels: false,
  }
}

async function enabledConnectButtons(): Promise<HTMLButtonElement[]> {
  await waitFor(() => {
    const buttons = screen.getAllByRole("button", { name: "Connect" }) as HTMLButtonElement[]
    expect(buttons).toHaveLength(3)
    expect(buttons.every((button) => !button.disabled)).toBe(true)
  })
  return screen.getAllByRole("button", { name: "Connect" }) as HTMLButtonElement[]
}

describe("Setup Step 4 channel persistence UI", () => {
  let statusData: TestChannelStatusData
  let templateSlug: string | null

  beforeEach(() => {
    push.mockReset()
    statusData = emptyStatusData()
    templateSlug = null
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/channels/ws-1/status")) {
        return jsonResponse({
          success: true,
          data: statusData,
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({ success: true, data: { clawTemplate: templateSlug ? { slug: templateSlug } : null } })
      }
      if (href.includes("/api/channels/ws-1") && init?.method === "POST") {
        statusData = {
          ...statusData,
          channels: {
            ...statusData.channels,
            telegram: { configured: true, live: "unknown" },
          },
          configuredChannelIds: ["telegram"],
          hasConfiguredChannels: true,
        }
        return jsonResponse({
          success: true,
          data: statusData,
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
    expect(screen.getByText("QR pairing — coming soon")).toBeDefined()
    expect(screen.getByText("Microsoft Teams")).toBeDefined()
    expect(screen.getByText("Requires Azure Bot Service setup — coming soon")).toBeDefined()

    fireEvent.click((await enabledConnectButtons())[0])
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
    expect(await screen.findByText("Configured — deploys with next redeploy")).toBeDefined()
  })

  it("renders loading rows and no Connect buttons until channel state is known", async () => {
    const status = deferredResponse({ success: true, data: emptyStatusData() })
    const workspace = deferredResponse({ success: true, data: { clawTemplate: null } })
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/api/channels/ws-1/status")) return status.promise
      if (href.includes("/api/workspaces/ws-1")) return workspace.promise
      return jsonResponse({ success: true, data: {} })
    }))

    render(<Step4 workspaceId="ws-1" />)

    expect(screen.getByLabelText("Loading channel status")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull()

    status.resolve()
    workspace.resolve()

    expect((await enabledConnectButtons()).length).toBe(3)
  })

  it("renders Telegram setup steps and guide link", async () => {
    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText(/No channel\?/)
    fireEvent.click((await enabledConnectButtons())[0])

    expect(await screen.findByText("Open Telegram and message @BotFather")).toBeDefined()
    expect(screen.getByText("Send /newbot and follow the prompts")).toBeDefined()
    expect(screen.getByText("Copy the token it gives you and paste it below.")).toBeDefined()
    expect(screen.getByRole("link", { name: "Setup guide →" }).getAttribute("href")).toBe("https://core.telegram.org/bots#botfather")
  })

  it("renders Discord setup steps and guide link", async () => {
    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText(/No channel\?/)
    fireEvent.click((await enabledConnectButtons())[1])

    expect(await screen.findByText("Discord Developer Portal → New Application")).toBeDefined()
    expect(screen.getByText("Bot tab → Reset Token → copy")).toBeDefined()
    expect(screen.getByText("Enable 'Message Content Intent' under Privileged Gateway Intents")).toBeDefined()
    expect(screen.getByText("Invite the bot to your server (OAuth2 URL Generator, bot scope).")).toBeDefined()
    expect(screen.getByRole("link", { name: "Setup guide →" }).getAttribute("href")).toBe("https://discord.com/developers/applications")
  })

  it("renders Slack setup steps, token-specific labels, and guide link", async () => {
    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText(/No channel\?/)
    fireEvent.click((await enabledConnectButtons())[2])

    expect(await screen.findByText("Create an app at api.slack.com/apps")).toBeDefined()
    expect(screen.getByText("Enable Socket Mode → copy the App token (xapp-…)")).toBeDefined()
    expect(screen.getByText("OAuth & Permissions → install → copy the Bot token (xoxb-…)")).toBeDefined()
    expect(screen.getByText("Paste both.")).toBeDefined()
    expect(screen.getByText("App token (xapp-…)")).toBeDefined()
    expect(screen.getByText("Bot token (xoxb-…)")).toBeDefined()
    expect(screen.getByRole("link", { name: "Setup guide →" }).getAttribute("href")).toBe("https://api.slack.com/apis/socket-mode")
  })

  it("renders configured rows from gateway-truth states", async () => {
    statusData = {
      channels: {
        telegram: { configured: true, live: "connected" },
        discord: { configured: true, live: "error", detail: "invalid token" },
        slack: { configured: true, live: "unknown" },
        whatsapp: { configured: false, live: "unknown" },
        msteams: { configured: false, live: "unknown" },
      },
      configuredChannelIds: ["telegram", "discord", "slack"],
      hasConfiguredChannels: true,
    }

    render(<Step4 workspaceId="ws-1" />)

    expect(await screen.findByText("Verified by gateway")).toBeDefined()
    expect(screen.getByText("Connected")).toBeDefined()
    expect(screen.getByText("invalid token. Check token and redeploy.")).toBeDefined()
    expect(screen.getByText("Check token and redeploy.")).toBeDefined()
    expect(screen.getByText("Configured — deploys with next redeploy")).toBeDefined()
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(3)
  })

  it.each(["law-firm-intake-os", "home-services-dispatcher", "medical-practice-manager"])(
    "shows the emergency-channel warning for %s when zero channels are configured",
    async (slug) => {
      templateSlug = slug

      render(<Step4 workspaceId="ws-1" />)

      expect(await screen.findByText("This Claw's emergency alerts require a connected channel")).toBeDefined()
      expect(screen.getByText("Without one, urgent alerts appear only on this dashboard.")).toBeDefined()
    },
  )

  it("does not show the emergency-channel warning for non-emergency templates", async () => {
    templateSlug = "sales-outreach-os"

    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText(/No channel\?/)
    expect(screen.queryByText("This Claw's emergency alerts require a connected channel")).toBeNull()
  })

  it("clears the emergency-channel warning when any channel is configured", async () => {
    templateSlug = "medical-practice-manager"
    statusData = {
      ...emptyStatusData(),
      channels: {
        ...emptyStatusData().channels,
        telegram: { configured: true, live: "unknown" },
      },
      configuredChannelIds: ["telegram"],
      hasConfiguredChannels: true,
    }

    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText("Configured — deploys with next redeploy")
    expect(screen.queryByText("This Claw's emergency alerts require a connected channel")).toBeNull()
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
