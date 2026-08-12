// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChannelStatusSection } from "@/app/dashboard/[workspaceId]/page"

describe("ChannelStatusSection", () => {
  it("renders configured channel gateway-truth states", () => {
    render(
      <ChannelStatusSection
        channelStatus={{
          configuredChannelIds: ["telegram", "discord", "slack"],
          hasConfiguredChannels: true,
          channels: {
            telegram: { configured: true, live: "connected" },
            discord: { configured: true, live: "error", detail: "invalid token" },
            slack: { configured: true, live: "unknown" },
            whatsapp: { configured: false, live: "unknown" },
            msteams: { configured: false, live: "unknown" },
          },
        }}
      />,
    )

    expect(screen.getByText("Channel status")).toBeDefined()
    expect(screen.getByText("Verified from the runtime when reachable")).toBeDefined()
    expect(screen.getByText("Telegram")).toBeDefined()
    expect(screen.getByText("Discord")).toBeDefined()
    expect(screen.getByText("Slack")).toBeDefined()
    // PR-0: Discord/Slack labeled beta; Telegram has no beta badge.
    expect(screen.getAllByText("beta")).toHaveLength(2)
    expect(screen.getByText("Running")).toBeDefined()
    expect(screen.getByText("Error")).toBeDefined()
    expect(screen.getByText("Setup")).toBeDefined()
    expect(screen.getByText("invalid token")).toBeDefined()
  })

  it("renders nothing when no channels are configured", () => {
    const { container } = render(
      <ChannelStatusSection
        channelStatus={{
          configuredChannelIds: [],
          hasConfiguredChannels: false,
          channels: {
            telegram: { configured: false, live: "unknown" },
            discord: { configured: false, live: "unknown" },
            slack: { configured: false, live: "unknown" },
            whatsapp: { configured: false, live: "unknown" },
            msteams: { configured: false, live: "unknown" },
          },
        }}
      />,
    )

    expect(container.firstChild).toBeNull()
  })
})
