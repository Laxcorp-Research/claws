// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const push = vi.fn()
const mockStartRedeploy = vi.fn()
let redeployCompleted: (() => void) | undefined
let routeStep = "4"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ workspaceId: "ws-1", n: routeStep }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: (opts: { onCompleted?: () => void }) => {
    redeployCompleted = opts.onCompleted
    return {
      modalOpen: false,
      status: null,
      lastStage: null,
      error: null,
      redeploying: false,
      startRedeploy: mockStartRedeploy,
      closeModal: vi.fn(),
      retry: vi.fn(),
    }
  },
}))

import SetupStepPage, { Step3, Step4, Step5, mapDeployStatus } from "@/app/setup/[workspaceId]/step/[n]/page"
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

type TestDeployStatusData = {
  workspaceStatus: string
  drift: { isStale: boolean; changedAreas: string[] }
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
  let deployStatusData: TestDeployStatusData
  let accessData: {
    channels: Partial<Record<ChannelId, { configured: boolean; fields: Record<string, string>; allowedIds: string[] }>>
    configuredChannelIds: ChannelId[]
    hasConfiguredChannels: boolean
  }

  beforeEach(() => {
    push.mockReset()
    mockStartRedeploy.mockReset()
    mockStartRedeploy.mockImplementation(async () => { redeployCompleted?.() })
    redeployCompleted = undefined
    routeStep = "4"
    statusData = emptyStatusData()
    templateSlug = null
    deployStatusData = { workspaceStatus: "DRAFT", drift: { isStale: false, changedAreas: [] } }
    accessData = { channels: {}, configuredChannelIds: [], hasConfiguredChannels: false }
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/channels/ws-1/status")) {
        return jsonResponse({
          success: true,
          data: statusData,
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({ success: true, data: { name: "Your Claw", clawTemplate: templateSlug ? { slug: templateSlug } : null } })
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return jsonResponse({ success: true, data: deployStatusData })
      }
      if (href.includes("/api/channels/ws-1") && (!init?.method || init.method === "GET")) {
        return jsonResponse({ success: true, data: accessData })
      }
      if (href.includes("/api/channels/ws-1") && init?.method === "POST") {
        const body = init.body ? JSON.parse(String(init.body)) as { channel: ChannelId; config: { allowFrom?: string[] } } : null
        if (body?.config.allowFrom) {
          accessData = {
            channels: {
              ...accessData.channels,
              [body.channel]: {
                configured: true,
                fields: accessData.channels[body.channel]?.fields ?? {},
                allowedIds: body.config.allowFrom,
              },
            },
            configuredChannelIds: Array.from(new Set([...accessData.configuredChannelIds, body.channel])),
            hasConfiguredChannels: true,
          }
        }
        statusData = {
          ...statusData,
          channels: {
            ...statusData.channels,
            [body?.channel ?? "telegram"]: { configured: true, live: "unknown" },
          },
          configuredChannelIds: Array.from(new Set([...statusData.configuredChannelIds, body?.channel ?? "telegram"])),
          hasConfiguredChannels: true,
        }
        deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: true, changedAreas: ["channels"] } }
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
    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: channels")).toBeDefined()
  })

  it("saves optional Telegram allowFrom from the connect modal", async () => {
    render(<Step4 workspaceId="ws-1" />)

    fireEvent.click((await enabledConnectButtons())[0])
    await screen.findByRole("heading", { name: "Connect Telegram" })
    expect(screen.getByText(/Message @userinfobot on Telegram to get your ID/)).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText("123456789:AA..."), {
      target: { value: "123456789:telegram-secret-token" },
    })
    fireEvent.change(screen.getByPlaceholderText("123456789"), {
      target: { value: "424242" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/channels/ws-1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            channel: "telegram",
            config: { botToken: "123456789:telegram-secret-token", allowFrom: ["424242"] },
          }),
        }),
      )
    })
  })

  it("saves optional Discord allowFrom from the connect modal", async () => {
    render(<Step4 workspaceId="ws-1" />)

    fireEvent.click((await enabledConnectButtons())[1])
    await screen.findByRole("heading", { name: "Connect Discord" })
    expect(screen.getByText(/Copy your Discord user ID from Developer Mode/)).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText("Paste your Discord bot token"), {
      target: { value: "discord-secret-token" },
    })
    fireEvent.change(screen.getByPlaceholderText("123456789012345678"), {
      target: { value: "987654321" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/channels/ws-1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            channel: "discord",
            config: { token: "discord-secret-token", allowFrom: ["987654321"] },
          }),
        }),
      )
    })
  })

  it("navigates to Deploy on Next without opening the apply prompt", async () => {
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: true, changedAreas: ["channels"] } }

    render(<Step4 workspaceId="ws-1" />)

    await enabledConnectButtons()
    fireEvent.click(screen.getByRole("button", { name: "Next: Deploy →" }))

    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/4")
    expect(screen.queryByRole("heading", { name: "Apply changes now?" })).toBeNull()
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

    expect(await screen.findByText("Verified by the runtime")).toBeDefined()
    expect(screen.getByText("Connected")).toBeDefined()
    expect(screen.getByText("invalid token. Check token and redeploy.")).toBeDefined()
    expect(screen.getByText("Check token and redeploy.")).toBeDefined()
    expect(screen.getByText("Will connect when you deploy")).toBeDefined()
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(3)
  })

  it("manages access IDs without exposing secrets and saves allowFrom through the merge route", async () => {
    statusData = {
      ...emptyStatusData(),
      channels: {
        ...emptyStatusData().channels,
        telegram: { configured: true, live: "unknown" },
      },
      configuredChannelIds: ["telegram"],
      hasConfiguredChannels: true,
    }
    accessData = {
      channels: {
        telegram: {
          configured: true,
          fields: { botToken: "1234...oken" },
          allowedIds: ["111"],
        },
      },
      configuredChannelIds: ["telegram"],
      hasConfiguredChannels: true,
    }

    render(<Step4 workspaceId="ws-1" />)

    await screen.findByText("Will connect when you deploy")
    fireEvent.click(screen.getByRole("button", { name: "Manage" }))

    expect(await screen.findByRole("heading", { name: "Manage Telegram access" })).toBeDefined()
    expect(await screen.findByText("111")).toBeDefined()
    expect(screen.queryByText("telegram-secret-token")).toBeNull()
    expect(screen.getByText(/If someone messages your bot and gets an 'access not configured' reply/)).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText("Paste sender ID"), { target: { value: "222" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Save access" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/channels/ws-1",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ channel: "telegram", config: { allowFrom: ["222"] } }),
        }),
      )
    })
    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: channels")).toBeDefined()
  })

  it("renders generic drift copy for a tools-only change on the Channels step", async () => {
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: true, changedAreas: ["tools"] } }

    render(<Step4 workspaceId="ws-1" />)

    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: tools")).toBeDefined()
    expect(screen.queryByText("Channel changes saved — redeploy to apply")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Go to deploy" }))
    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/4")
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

    await screen.findByText("Will connect when you deploy")
    expect(screen.queryByText("This Claw's emergency alerts require a connected channel")).toBeNull()
  })

  it("hides Applying channel config deploy step when no channel is configured", () => {
    expect(mapDeployStatus("HEALTH_CHECK", null, false).map((step) => step.label)).not.toContain("Applying channel config")
    expect(mapDeployStatus("HEALTH_CHECK", null, true).map((step) => step.label)).toContain("Applying channel config")
  })

  it("routes setup step 3 to Channels and step 4 to Deploy", async () => {
    routeStep = "3"
    const { unmount } = render(<SetupStepPage />)
    expect(await screen.findByText("How should your Claw talk to you?")).toBeDefined()
    expect(screen.getByText("Channels")).toBeDefined()
    unmount()

    routeStep = "4"
    render(<SetupStepPage />)
    expect(await screen.findByText("Deploy your Claw")).toBeDefined()
    expect(screen.getByText("Deploy")).toBeDefined()
  })

  it("deletes timeout-based fake channel connection mutation", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )

    expect(source).not.toContain("setChannelStatuses")
    expect(source).not.toContain("setTimeout(resolve")
  })

  it("does not hardcode area-specific drift banner headlines in setup surfaces", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )

    expect(source).not.toContain("Channel changes saved")
    expect(source).not.toContain("Your latest changes")
    expect(source).not.toContain("Your channel changes take effect")
  })
})

describe("Setup Step 5 drift-aware go live", () => {
  let deployStatusData: TestDeployStatusData

  beforeEach(() => {
    push.mockReset()
    mockStartRedeploy.mockReset()
    redeployCompleted = undefined
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: false, changedAreas: [] } }
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({ success: true, data: { name: "Live Claw" } })
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return jsonResponse({ success: true, data: deployStatusData })
      }
      return jsonResponse({ success: true, data: {} })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows stale channel changes on step 5 and hides the connected-channel tip", async () => {
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: true, changedAreas: ["channels"] } }

    render(<Step5 workspaceId="ws-1" />)

    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: channels")).toBeDefined()
    expect(screen.queryByText("Message your Orchestrator anytime through the connected channels.")).toBeNull()
    expect(screen.getByRole("button", { name: "Go to deploy" })).toBeDefined()
  })

  it("keeps the celebration unchanged when drift is fresh", async () => {
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: false, changedAreas: [] } }

    render(<Step5 workspaceId="ws-1" />)

    expect(await screen.findByText("Your Live Claw is live!")).toBeDefined()
    expect(screen.getByText("Message your Orchestrator anytime through the connected channels.")).toBeDefined()
    expect(screen.queryByText(/aren't live yet/)).toBeNull()
  })

  it("does not warn for draft or never-deployed workspaces", async () => {
    deployStatusData = { workspaceStatus: "DRAFT", drift: { isStale: true, changedAreas: ["channels"] } }

    render(<Step5 workspaceId="ws-1" />)

    expect(await screen.findByText("Your Live Claw is live!")).toBeDefined()
    expect(screen.getByText("Message your Orchestrator anytime through the connected channels.")).toBeDefined()
    expect(screen.queryByText(/aren't live yet/)).toBeNull()
  })
})

describe("Setup Step 4 Deploy exit drift prompt", () => {
  let deployStatusData: TestDeployStatusData
  let workspaceClawTemplate: { recommendedAlwaysOn?: boolean } | null

  beforeEach(() => {
    push.mockReset()
    mockStartRedeploy.mockReset()
    mockStartRedeploy.mockImplementation(async () => { redeployCompleted?.() })
    redeployCompleted = undefined
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: true, changedAreas: ["channels"] } }
    workspaceClawTemplate = null
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/api/user/billing")) {
        return jsonResponse({ success: true, data: { trialUsed: false, trialEndsAt: null, hasActiveSubscription: false } })
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return jsonResponse({
          success: true,
          data: {
            workspaceStatus: deployStatusData.workspaceStatus,
            apiKeySource: "USER_OWN_KEY",
            deployment: { status: "COMPLETED", errorMessage: null },
            drift: deployStatusData.drift,
          },
        })
      }
      if (href.includes("/api/channels/ws-1")) {
        return jsonResponse({ success: true, data: { hasConfiguredChannels: true } })
      }
      if (href.includes("/api/workspaces/ws-1/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: { tools: [], required: [], recommended: [], source: "empty" },
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({ success: true, data: { clawTemplate: workspaceClawTemplate } })
      }
      if (href.includes("/api/tools/ws-1")) {
        return jsonResponse({ success: true, data: { connections: [] } })
      }
      return jsonResponse({ success: true, data: {} })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("opens the apply prompt on Deploy Next when channel drift is stale", async () => {
    render(<Step3 workspaceId="ws-1" />)

    expect(await screen.findByText("Deploy your Claw")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Next: Go live →" }))

    expect(await screen.findByRole("heading", { name: "Apply changes now?" })).toBeDefined()
    expect(screen.getByText("Your Claw is running an older configuration. Redeploy to apply changes to channels.")).toBeDefined()
  })

  it("confirming the Deploy apply prompt invokes shared redeploy then navigates to step 5", async () => {
    render(<Step3 workspaceId="ws-1" />)

    expect(await screen.findByText("Deploy your Claw")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Next: Go live →" }))
    expect(await screen.findByRole("heading", { name: "Apply changes now?" })).toBeDefined()
    const redeployButtons = screen.getAllByRole("button", { name: "Redeploy" })
    fireEvent.click(redeployButtons[redeployButtons.length - 1])

    await waitFor(() => expect(mockStartRedeploy).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/5")
  })

  it("cancelling the Deploy apply prompt navigates to step 5", async () => {
    render(<Step3 workspaceId="ws-1" />)

    expect(await screen.findByText("Deploy your Claw")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Next: Go live →" }))
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }))

    expect(mockStartRedeploy).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/5")
  })

  it("surfaces recommendedAlwaysOn banner when template metadata says so", async () => {
    deployStatusData = {
      workspaceStatus: "DRAFT",
      drift: { isStale: false, changedAreas: [] },
    }
    // Fresh deploy surface (no prior deployment status) so the banner is visible.
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/api/user/billing")) {
        return jsonResponse({
          success: true,
          data: { trialUsed: false, trialEndsAt: null, hasActiveSubscription: false },
        })
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return jsonResponse({
          success: true,
          data: {
            workspaceStatus: "DRAFT",
            apiKeySource: "USER_OWN_KEY",
            deployment: null,
            drift: { isStale: false, changedAreas: [] },
          },
        })
      }
      if (href.includes("/api/channels/ws-1")) {
        return jsonResponse({ success: true, data: { hasConfiguredChannels: false } })
      }
      if (href.includes("/api/workspaces/ws-1/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: { tools: [], required: [], recommended: [], source: "empty" },
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({
          success: true,
          data: { clawTemplate: { slug: "quant-trader", recommendedAlwaysOn: true } },
        })
      }
      return jsonResponse({ success: true, data: {} })
    }))

    render(<Step3 workspaceId="ws-1" />)

    expect(await screen.findByText("This template recommends Always on")).toBeDefined()
  })
})
