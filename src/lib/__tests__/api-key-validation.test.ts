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

  it("rejects provider with no validator (OLLAMA stays cut)", async () => {
    const ollama = await validateApiKey("OLLAMA", "local")
    expect(ollama.valid).toBe(false)
    expect(ollama.error).toMatch(/Unsupported provider/i)

    // MUTATION tripwire: source must not auto-pass unknown providers.
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/api-key-validation.ts"), "utf8")
    expect(src).not.toMatch(/if\s*\(\s*!validator\s*\)\s*return\s*\{\s*valid:\s*true/)
  })

  it("validates OpenRouter via GET /api/v1/key (not public /models)", async () => {
    const result = await validateApiKey("OPENROUTER", "sk-or-test")
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-or-test" }),
      }),
    )
    expect(result.valid).toBe(true)

    // MUTATION: must not treat public /models alone as credential proof.
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/api-key-validation.ts"), "utf8")
    expect(src).toContain("openrouter.ai/api/v1/key")
    expect(src).toMatch(/GET \/models is PUBLIC/)
  })

  it("rejects invalid OpenRouter key on 401 from /key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)
    const result = await validateApiKey("OPENROUTER", "sk-or-bad")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Invalid/i)
  })

  it("delegates known providers to live validators", async () => {
    const result = await validateApiKey("ANTHROPIC", "sk-ant-test")
    expect(fetch).toHaveBeenCalled()
    expect(result.valid).toBe(true)
  })
})
