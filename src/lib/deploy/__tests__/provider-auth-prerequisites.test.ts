import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { evaluateProviderAuthForModels } from "@/lib/deploy/provider-auth-prerequisites"

describe("evaluateProviderAuthForModels", () => {
  it("ACTIVE credits cover Anthropic without a key", () => {
    const result = evaluateProviderAuthForModels({
      models: ["anthropic/claude-sonnet-4-6"],
      creditMode: true,
      configuredProviders: [],
    })
    expect(result.ok).toBe(true)
  })

  it("MUTATION: EXHAUSTED credits are not a deploy auth path", () => {
    const result = evaluateProviderAuthForModels({
      models: ["anthropic/claude-sonnet-4-6"],
      creditMode: false,
      configuredProviders: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("MODEL_KEY_MISSING")
      expect(result.message.toLowerCase()).toContain("anthropic")
      expect(result.missingProviders).toEqual(["ANTHROPIC"])
    }
  })

  it("valid BYOK unlocks the provider", () => {
    const result = evaluateProviderAuthForModels({
      models: ["openai/gpt-5"],
      creditMode: false,
      configuredProviders: ["OPENAI"],
    })
    expect(result.ok).toBe(true)
  })

  it("names the missing non-Anthropic key", () => {
    const result = evaluateProviderAuthForModels({
      models: ["openai/gpt-5"],
      creditMode: true,
      configuredProviders: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/OpenAI/)
    }
  })

  it("MUTATION: workspace evaluator treats only ACTIVE credits as creditMode", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/deploy/provider-auth-prerequisites.ts"),
      "utf8",
    )
    expect(src).toContain('creditStatus === "ACTIVE"')
    expect(src).toContain("evaluateWorkspaceDeployProviderAuth")
  })
})
