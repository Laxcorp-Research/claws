// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CommandStrip } from "@/components/dashboard/command-strip"
import type { ChannelStatusMap } from "@/lib/openclaw/channel-config"

afterEach(() => cleanup())

const channels: ChannelStatusMap = {
  telegram: { configured: true, live: "unknown" },
  discord: { configured: true, live: "connected" },
  slack: { configured: true, live: "connecting" },
  whatsapp: { configured: true, live: "error", detail: "token expired" },
  msteams: { configured: false, live: "unknown" },
}

function renderStrip(overrides: Partial<Parameters<typeof CommandStrip>[0]> = {}) {
  render(
    <CommandStrip
      workspaceName="Sales Claw"
      workspaceStatus="RUNNING"
      agentsActive={2}
      agentsTotal={3}
      tasksToday={9}
      estimatedCostToday={1.23}
      estimatedCostTodayCalls={4}
      configuredChannelIds={["telegram", "discord", "slack", "whatsapp"]}
      channels={channels}
      {...overrides}
    />,
  )
}

describe("CommandStrip", () => {
  it("shows estimated cost honestly and labels it est.", () => {
    renderStrip()

    expect(screen.getByText("~$1.23 est.")).toBeDefined()
  })

  it("renders real cost without est. when the window is fully real", () => {
    renderStrip({ estimatedCostTodayIsEstimate: false })

    expect(screen.getByText("$1.23")).toBeDefined()
    expect(screen.queryByText("~$1.23 est.")).toBeNull()
  })

  it("renders em dash instead of fabricated $0.00 when there are no attributable calls", () => {
    renderStrip({ estimatedCostToday: 0, estimatedCostTodayCalls: 0 })

    expect(screen.getByText("-")).toBeDefined()
    expect(screen.queryByText("$0.00")).toBeNull()
  })

  it("maps channel states to dots, and unknown never renders green", () => {
    renderStrip()

    const unknown = screen.getByLabelText("Telegram: unknown")
    expect(unknown.innerHTML).toContain("bg-[var(--tx3)]")
    expect(unknown.innerHTML).not.toContain("bg-[var(--ok)]")

    expect(screen.getByLabelText("Discord: connected").innerHTML).toContain("bg-[var(--ok)]")
    expect(screen.getByLabelText("Slack: configured-not-live").innerHTML).toContain("bg-[var(--warn)]")
    expect(screen.getByLabelText("WhatsApp: error").innerHTML).toContain("bg-[var(--err)]")
  })
})
