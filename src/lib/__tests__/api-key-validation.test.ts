import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }),
)

import { validateApiKey } from "@/lib/api-key-validation"

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it("rejects provider with no validator", async () => {
    const result = await validateApiKey("OPENROUTER", "sk-or-fake")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Unsupported provider/i)

    const ollama = await validateApiKey("OLLAMA", "local")
    expect(ollama.valid).toBe(false)

    // MUTATION tripwire: source must not auto-pass unknown providers.
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/api-key-validation.ts"), "utf8")
    expect(src).not.toMatch(/if\s*\(\s*!validator\s*\)\s*return\s*\{\s*valid:\s*true/)
  })

  it("delegates known providers to live validators", async () => {
    const result = await validateApiKey("ANTHROPIC", "sk-ant-test")
    expect(fetch).toHaveBeenCalled()
    expect(result.valid).toBe(true)
  })
})
