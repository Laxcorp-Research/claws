import { describe, expect, it } from "vitest"
import {
  NO_AUTH_PATH_LABEL,
  NO_KEY_LABEL,
  POWERED_BY_CLAWS_CREDITS,
  isCreditAuthPath,
  isModelSelectable,
  modelDeployWarning,
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
    expect(or.unlockReason).toMatch(/OpenRouter key/)
  })

  it("credits + OpenRouter key: both selectable", () => {
    const opts = { creditMode: true, configuredProviders: ["OPENROUTER"] }
    expect(resolveProviderAuth("ANTHROPIC", opts).selectable).toBe(true)
    expect(resolveProviderAuth("OPENROUTER", opts).selectable).toBe(true)
    expect(isModelSelectable("openrouter/openai/gpt-4o-mini", opts)).toBe(true)
  })

  it("none: Anthropic is no-auth-path, not no-key", () => {
    const anthropic = resolveProviderAuth("ANTHROPIC", { creditMode: false, configuredProviders: [] })
    expect(anthropic.selectable).toBe(false)
    expect(anthropic.cardState).toBe("no-auth-path")
    expect(anthropic.cardLabel).toBe(NO_AUTH_PATH_LABEL)
    expect(modelDeployWarning("anthropic/claude-sonnet-5", { creditMode: false, configuredProviders: [] })).toBe(
      "No auth path for Anthropic — add a key or use Claws credits",
    )
    expect(modelDeployWarning("openai/gpt-4o", { creditMode: false, configuredProviders: [] })).toMatch(
      /Needs an OpenAI key before deploy/,
    )
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
