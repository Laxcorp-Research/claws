import { describe, expect, it } from "vitest"
import { deriveComposioAuthModeFromSchemes } from "@/lib/composio-catalog"

describe("deriveComposioAuthModeFromSchemes", () => {
  it("prefers OAuth labels when OAuth and API key schemes are both present", () => {
    expect(deriveComposioAuthModeFromSchemes(["API_KEY", "OAUTH2"])).toBe("managed-oauth")
  })

  it("labels API-key-only live tools as BYOK", () => {
    expect(deriveComposioAuthModeFromSchemes(["API_KEY"])).toBe("byok-api-key")
    expect(deriveComposioAuthModeFromSchemes(["BEARER"])).toBe("byok-api-key")
    expect(deriveComposioAuthModeFromSchemes(["BASIC"])).toBe("byok-api-key")
  })

  it("labels toolkits with no known auth scheme as custom OAuth required", () => {
    expect(deriveComposioAuthModeFromSchemes([])).toBe("custom-oauth-required")
  })

  it("keeps S2S_OAUTH2-only toolkits badged as custom setup", () => {
    expect(deriveComposioAuthModeFromSchemes(["S2S_OAUTH2"])).toBe("custom-oauth-required")
  })

  it("labels no-auth live tools as none", () => {
    expect(deriveComposioAuthModeFromSchemes(["NO_AUTH"])).toBe("none")
  })
})
