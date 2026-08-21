import { describe, expect, it } from "vitest"
import {
  ANTHROPIC_NO_AUTH_LABEL,
  NO_KEY_LABEL,
  POWERED_BY_CLAWS_CREDITS,
  isCreditAuthPath,
  isModelSelectable,
  modelDeployWarning,
  providerUnlockReason,
  resolveProviderAuth,
  validConfiguredProviders,
} from "@/lib/models/provider-auth"

describe("isCreditAuthPath", () => {
  it("treats ACTIVE and EXHAUSTED credit accounts as an auth path", () => {
    expect(isCreditAuthPath({ hasCredits: true, status: "ACTIVE" })).toBe(true)
    expect(isCreditAuthPath({ hasCredits: true, status: "EXHAUSTED" })).toBe(true)
  })

  it("rejects missing account, suspended, or converted", () => {
    expect(isCreditAuthPath({ hasCredits: false, status: null })).toBe(false)
    expect(isCreditAuthPath({ hasCredits: true, status: "SUSPENDED" })).toBe(false)
    expect(isCreditAuthPath(null)).toBe(false)
  })
})

describe("resolveProviderAuth enablement matrix", () => {
  it("credits-only: Anthropic selectable, OpenRouter locked", () => {
    const anthropic = resolveProviderAuth("ANTHROPIC", { creditMode: true, configuredProviders: [] })
    const or = resolveProviderAuth("OPENROUTER", { creditMode: true, configuredProviders: [] })
    expect(anthropic.selectable).toBe(true)
    expect(anthropic.cardState).toBe("credits")
    expect(anthropic.cardLabel).toBe(POWERED_BY_CLAWS_CREDITS)
    expect(or.selectable).toBe(false)
    expect(or.cardLabel).toBe(NO_KEY_LABEL)
    expect(or.unlockReason).toBe("Add an OpenRouter API key to unlock these models")
  })

  it("credits + OpenRouter key: both selectable", () => {
    const opts = { creditMode: true, configuredProviders: ["OPENROUTER"] }
    expect(resolveProviderAuth("ANTHROPIC", opts).selectable).toBe(true)
    expect(resolveProviderAuth("OPENROUTER", opts).selectable).toBe(true)
    expect(isModelSelectable("openrouter/openai/gpt-4o-mini", opts)).toBe(true)
  })

  it("none: Anthropic reads 'No credits or API key', others 'No API key'", () => {
    const anthropic = resolveProviderAuth("ANTHROPIC", { creditMode: false, configuredProviders: [] })
    expect(anthropic.selectable).toBe(false)
    expect(anthropic.cardState).toBe("no-auth-path")
    expect(anthropic.cardLabel).toBe(ANTHROPIC_NO_AUTH_LABEL)
    expect(ANTHROPIC_NO_AUTH_LABEL).toBe("No credits or API key")
    expect(NO_KEY_LABEL).toBe("No API key")
  })

  it("validConfiguredProviders keeps only valid keys", () => {
    expect(
      validConfiguredProviders([
        { provider: "OPENAI", effectiveSource: "global", overrideKeyValid: false, globalKeyValid: true },
        { provider: "GOOGLE", effectiveSource: "global", overrideKeyValid: false, globalKeyValid: false },
      ]),
    ).toEqual(["OPENAI"])
  })
})

describe("human copy (founder ruling: no jargon, credits never read as a user action)", () => {
  it("deploy warning explains missing credits and names the fix - never 'auth path'", () => {
    const warning = modelDeployWarning("anthropic/claude-sonnet-5", {
      creditMode: false,
      configuredProviders: [],
    })
    expect(warning).toBe("No active credits on this account - add an Anthropic API key before deploy")
    expect(modelDeployWarning("openai/gpt-4o", { creditMode: false, configuredProviders: [] })).toBe(
      "Add an OpenAI API key before deploy",
    )
  })

  it("REGRESSION: 'No auth path' and 'or use Claws credits' never come back", () => {
    const surfaces = [
      resolveProviderAuth("ANTHROPIC", { creditMode: false, configuredProviders: [] }).cardLabel,
      resolveProviderAuth("ANTHROPIC", { creditMode: false, configuredProviders: [] }).unlockReason ?? "",
      resolveProviderAuth("OPENAI", { creditMode: false, configuredProviders: [] }).cardLabel,
      providerUnlockReason("ANTHROPIC"),
      providerUnlockReason("GOOGLE"),
      modelDeployWarning("anthropic/claude-sonnet-5", { creditMode: false, configuredProviders: [] }) ?? "",
      modelDeployWarning("google/gemini-2.5-pro", { creditMode: false, configuredProviders: [] }) ?? "",
    ]
    for (const text of surfaces) {
      expect(text.toLowerCase()).not.toContain("auth path")
      expect(text.toLowerCase()).not.toContain("use claws credits")
    }
  })

  it("no warning when the auth path is satisfied", () => {
    expect(
      modelDeployWarning("anthropic/claude-sonnet-5", { creditMode: true, configuredProviders: [] }),
    ).toBeNull()
    expect(
      modelDeployWarning("openai/gpt-4o", { creditMode: false, configuredProviders: ["OPENAI"] }),
    ).toBeNull()
  })
})
