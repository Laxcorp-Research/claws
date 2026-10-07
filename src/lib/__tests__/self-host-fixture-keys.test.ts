import { afterEach, describe, expect, it, vi } from "vitest"
import { validateApiKey } from "@/lib/api-key-validation"
import { validateToolKey } from "@/lib/tools/validators"

afterEach(() => {
  delete process.env.CLAWS_PROFILE
  vi.unstubAllGlobals()
})

describe("self-host fixture credentials", () => {
  it("accepts a fixture- model key only when CLAWS_PROFILE=self-host", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }))
    vi.stubGlobal("fetch", fetchImpl)

    process.env.CLAWS_PROFILE = "self-host"
    expect(await validateApiKey("ANTHROPIC", "fixture-model-key")).toEqual({ valid: true })
    expect(fetchImpl).not.toHaveBeenCalled()

    delete process.env.CLAWS_PROFILE
    const hosted = await validateApiKey("ANTHROPIC", "fixture-model-key")
    expect(hosted.valid).toBe(false)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it("accepts a fixture- tool credential only when CLAWS_PROFILE=self-host", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }))
    vi.stubGlobal("fetch", fetchImpl)
    process.env.CLAWS_PROFILE = "self-host"
    const result = await validateToolKey("twitter-api", { TWITTER_BEARER_TOKEN: "fixture-twitter" })
    expect(result.valid).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
