import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CHANNEL_BETA_LABEL,
  CHANNELS_WITH_BETA,
  PROVIDER_BYOK_BETA_LABEL,
  PROVIDERS_WITH_BYOK_BETA,
  isBetaChannel,
  isByokBetaProvider,
} from "@/lib/ui/beta-labels"

describe("PR-0 beta honesty labels", () => {
  it("exports exact founder-locked label strings", () => {
    expect(CHANNEL_BETA_LABEL).toBe("beta")
    expect(PROVIDER_BYOK_BETA_LABEL).toBe("beta — bring your own key")
    expect(CHANNELS_WITH_BETA).toEqual(["discord", "slack"])
    expect(PROVIDERS_WITH_BYOK_BETA).toEqual(["OPENAI", "GOOGLE", "OPENROUTER"])
  })

  it("classifies Discord/Slack as beta; Telegram is not", () => {
    expect(isBetaChannel("discord")).toBe(true)
    expect(isBetaChannel("slack")).toBe(true)
    expect(isBetaChannel("telegram")).toBe(false)
  })

  it("classifies OpenAI/Google/OpenRouter as BYOK beta; Anthropic is not", () => {
    expect(isByokBetaProvider("OPENAI")).toBe(true)
    expect(isByokBetaProvider("GOOGLE")).toBe(true)
    expect(isByokBetaProvider("OPENROUTER")).toBe(true)
    expect(isByokBetaProvider("ANTHROPIC")).toBe(false)
  })

  it("MUTATION: setup channels wire Discord/Slack beta badges and Telegram proven-default copy", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    expect(src).toContain("CHANNEL_BETA_LABEL")
    expect(src).toContain('badgeLabel: CHANNEL_BETA_LABEL')
    expect(src).toContain("Proven default — enter bot token from @BotFather")
    // Removing Discord/Slack badgeLabel lines must fail this test.
    const discordBlock = src.slice(src.indexOf('id: "discord"'), src.indexOf('id: "slack"'))
    const slackBlock = src.slice(src.indexOf('id: "slack"'), src.indexOf('id: "whatsapp"'))
    expect(discordBlock).toContain("badgeLabel: CHANNEL_BETA_LABEL")
    expect(slackBlock).toContain("badgeLabel: CHANNEL_BETA_LABEL")
  })

  it("MUTATION: setup + settings surface BYOK beta label for OpenAI/Google", () => {
    const setup = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    const settings = readFileSync(
      join(process.cwd(), "src/components/settings/api-key-manager.tsx"),
      "utf8",
    )
    expect(setup).toContain("PROVIDER_BYOK_BETA_LABEL")
    expect(setup).toContain("isByokBetaProvider")
    expect(settings).toContain("PROVIDER_BYOK_BETA_LABEL")
    expect(settings).toContain("isByokBetaProvider")
    // Proven default must stay labeled on Anthropic.
    expect(setup).toContain('provider === "ANTHROPIC"')
    expect(settings).toContain('provider.key === "ANTHROPIC"')
  })

  it("MUTATION: dashboard channel status shows beta for Discord/Slack", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
      "utf8",
    )
    expect(src).toContain("isBetaChannel")
    expect(src).toContain("CHANNEL_BETA_LABEL")
  })
})
