import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SUPPORTED_PROVIDERS_COPY } from "@/lib/supported-providers"

const ALIGNED = "Anthropic, OpenAI, Google, and OpenRouter"

describe("provider honesty copy alignment", () => {
  it("exports the exact aligned string", () => {
    expect(SUPPORTED_PROVIDERS_COPY).toBe(ALIGNED)
  })

  it("settings and setup use the aligned provider string", () => {
    const roots = [
      "src/components/settings/api-key-manager.tsx",
      "src/app/setup/[workspaceId]/step/[n]/page.tsx",
    ]
    for (const rel of roots) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      expect(src, rel).toContain(ALIGNED)
    }
  })

  it("pricing AI model costs is credits-honest", () => {
    const src = readFileSync(join(process.cwd(), "src/app/pricing/page.tsx"), "utf8")
    expect(src).toContain(
      "Start with $50 free credits or bring your own API keys — pay your provider directly.",
    )
  })

  it("settings and setup surface OpenRouter as a real BYOK provider; Ollama stays cut", () => {
    const settings = readFileSync(
      join(process.cwd(), "src/components/settings/api-key-manager.tsx"),
      "utf8",
    )
    expect(settings).toMatch(/key:\s*"OPENROUTER"/)
    expect(settings).toContain("OpenRouter — one key, every model")

    const setup = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    const setupCards = readFileSync(
      join(process.cwd(), "src/components/setup/provider-auth-cards.tsx"),
      "utf8",
    )
    expect(setupCards).toContain('OPENROUTER: "OpenRouter — one key, every model"')
    expect(setup).not.toMatch(/OLLAMA:\s*"Ollama/)
  })
})
