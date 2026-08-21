// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ProviderAuthCards } from "@/components/setup/provider-auth-cards"
import { NO_AUTH_PATH_LABEL, NO_KEY_LABEL, POWERED_BY_CLAWS_CREDITS } from "@/lib/models/provider-auth"

afterEach(() => cleanup())

const NO_KEYS = [
  {
    provider: "ANTHROPIC",
    hasGlobalKey: false,
    globalKeyHint: null,
    globalKeyValid: false,
    hasOverride: false,
    overrideKeyHint: null,
    overrideKeyValid: false,
    hasKey: false,
    effectiveSource: "none" as const,
  },
]

describe("ProviderAuthCards credit-mode truth", () => {
  it("credit-mode Anthropic reads Powered by Claws credits, not No key", () => {
    render(
      <ProviderAuthCards
        agents={[{ name: "Commander", model: "anthropic/claude-sonnet-5" }]}
        keyStatus={NO_KEYS}
        creditMode
        configuredProviders={[]}
        onEnterKey={() => {}}
        onChangeKey={() => {}}
        onUseGlobal={() => {}}
      />,
    )
    const anthropic = screen.getByTestId("provider-auth-card-ANTHROPIC")
    expect(anthropic.textContent).toContain(POWERED_BY_CLAWS_CREDITS)
    expect(anthropic.textContent).not.toContain(NO_KEY_LABEL)
    expect(anthropic.textContent).not.toContain("Needs")
    expect(screen.getByTestId("provider-auth-card-OPENAI").textContent).toContain(NO_KEY_LABEL)
  })

  it("no credits and no key: Anthropic is no auth path, OpenAI is no key", () => {
    render(
      <ProviderAuthCards
        agents={[{ name: "Commander", model: "anthropic/claude-sonnet-5" }]}
        keyStatus={NO_KEYS}
        creditMode={false}
        configuredProviders={[]}
        onEnterKey={() => {}}
        onChangeKey={() => {}}
        onUseGlobal={() => {}}
      />,
    )
    expect(screen.getByTestId("provider-auth-missing-ANTHROPIC").textContent).toBe(NO_AUTH_PATH_LABEL)
    expect(screen.getByTestId("provider-auth-missing-OPENAI").textContent).toBe(NO_KEY_LABEL)
  })
})
