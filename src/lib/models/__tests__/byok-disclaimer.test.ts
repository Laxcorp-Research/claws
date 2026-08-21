import { describe, expect, it } from "vitest"
import {
  BYOK_COST_DISCLAIMER,
  shouldShowByokCostDisclaimer,
} from "@/lib/models/byok-disclaimer"

describe("BYOK cost disclaimer", () => {
  it("copy snapshot", () => {
    expect(BYOK_COST_DISCLAIMER).toMatchInlineSnapshot(
      `"BYOK models: cost figures are estimates - billed by your provider."`,
    )
  })

  it("omits in credit-mode with no BYOK keys or models", () => {
    expect(
      shouldShowByokCostDisclaimer({
        creditMode: true,
        configuredProviders: ["ANTHROPIC"],
        selectedModels: ["anthropic/claude-sonnet-4-6"],
      }),
    ).toBe(false)
  })

  it("shows when a BYOK provider key is available in credit-mode", () => {
    expect(
      shouldShowByokCostDisclaimer({
        creditMode: true,
        configuredProviders: ["ANTHROPIC", "OPENAI"],
        selectedModels: ["anthropic/claude-sonnet-4-6"],
      }),
    ).toBe(true)
  })

  it("shows when a BYOK model is selected in credit-mode", () => {
    expect(
      shouldShowByokCostDisclaimer({
        creditMode: true,
        configuredProviders: [],
        selectedModels: ["openrouter/openai/gpt-4o-mini"],
      }),
    ).toBe(true)
  })

  it("shows for non-credit (own-key) accounts", () => {
    expect(
      shouldShowByokCostDisclaimer({
        creditMode: false,
        configuredProviders: ["ANTHROPIC"],
        selectedModels: ["anthropic/claude-haiku-4-5-20251001"],
      }),
    ).toBe(true)
  })
})
