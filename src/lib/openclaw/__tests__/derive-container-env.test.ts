// PR-8a/A: deriveContainerEnv is the single source of truth for a container's
// credential env. These lock the apiKeySource × hasKey matrix (incl. the
// override precedence and the "master key wins for credit users" rule) and the
// keyFingerprint contract (deterministic, length-stable, never the raw key).
//
// decrypt() is mocked to a predictable plaintext so we can assert exact values
// without ENCRYPTION_MASTER_KEY / real ciphertext.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("@/lib/encryption", () => ({
  decrypt: (encoded: string) => `sk-ant-plain-${encoded}`,
}))

import {
  assertNoPlaceholderEnvValues,
  deriveContainerEnv,
  fingerprintKey,
  ANTHROPIC_PROXY_URL,
  type DeriveWorkspaceInput,
  type DeriveUserInput,
} from "@/lib/openclaw/derive-container-env"

const MASTER = "sk-ant-master-platform-key"

function ws(override: DeriveWorkspaceInput["apiKeySourceOverride"] = null): DeriveWorkspaceInput {
  return { apiKeySourceOverride: override }
}
function usr(
  apiKeySource: DeriveUserInput["apiKeySource"],
  apiKeys: DeriveUserInput["apiKeys"] = [],
): DeriveUserInput {
  return { apiKeySource, apiKeys }
}
const anthropicKey = { provider: "ANTHROPIC" as const, encryptedKey: "ENC_ANTHROPIC" }
const openaiKey = { provider: "OPENAI" as const, encryptedKey: "ENC_OPENAI" }

describe("deriveContainerEnv — apiKeySource × hasKey matrix", () => {
  let prevMaster: string | undefined
  beforeEach(() => {
    prevMaster = process.env.CLAWS_MASTER_ANTHROPIC_KEY
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = MASTER
  })
  afterEach(() => {
    if (prevMaster === undefined) delete process.env.CLAWS_MASTER_ANTHROPIC_KEY
    else process.env.CLAWS_MASTER_ANTHROPIC_KEY = prevMaster
  })

  it("PLATFORM_CREDIT → master key + credit_mode + proxy base URL", () => {
    const env = deriveContainerEnv(ws(), usr("PLATFORM_CREDIT"))
    expect(env.ANTHROPIC_API_KEY).toBe(MASTER)
    expect(env.CLAWS_CREDIT_MODE).toBe(true)
    expect(env.ANTHROPIC_BASE_URL).toBe(ANTHROPIC_PROXY_URL)
    expect(env.keyFingerprint).toBe(fingerprintKey(MASTER))
  })

  it("PLATFORM_CREDIT with a user BYOK key present → master key still wins (user key ignored)", () => {
    const env = deriveContainerEnv(ws(), usr("PLATFORM_CREDIT", [anthropicKey]))
    expect(env.ANTHROPIC_API_KEY).toBe(MASTER)
    expect(env.ANTHROPIC_API_KEY).not.toContain("ENC_ANTHROPIC")
  })

  it("USER_OWN_KEY + ANTHROPIC key → decrypted user key, no credit mode, no base URL", () => {
    const env = deriveContainerEnv(ws(), usr("USER_OWN_KEY", [anthropicKey]))
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-plain-ENC_ANTHROPIC")
    expect(env.CLAWS_CREDIT_MODE).toBe(false)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.keyFingerprint).toBe(fingerprintKey("sk-ant-plain-ENC_ANTHROPIC"))
  })

  it("USER_OWN_KEY without an ANTHROPIC key → no key, no credit mode", () => {
    const env = deriveContainerEnv(ws(), usr("USER_OWN_KEY", [openaiKey]))
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAWS_CREDIT_MODE).toBe(false)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.keyFingerprint).toBeNull()
  })

  it("NONE + ANTHROPIC key → decrypted user key (the stale-BYOK pattern)", () => {
    const env = deriveContainerEnv(ws(), usr("NONE", [anthropicKey]))
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-plain-ENC_ANTHROPIC")
    expect(env.CLAWS_CREDIT_MODE).toBe(false)
    expect(env.keyFingerprint).toBe(fingerprintKey("sk-ant-plain-ENC_ANTHROPIC"))
  })

  it("NONE without a key → no key (the WIRE-TEST current state)", () => {
    const env = deriveContainerEnv(ws(), usr("NONE"))
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAWS_CREDIT_MODE).toBe(false)
    expect(env.keyFingerprint).toBeNull()
  })

  it("apiKeySourceOverride=PLATFORM_CREDIT beats user.apiKeySource=USER_OWN_KEY → master key", () => {
    const env = deriveContainerEnv(ws("PLATFORM_CREDIT"), usr("USER_OWN_KEY", [anthropicKey]))
    expect(env.CLAWS_CREDIT_MODE).toBe(true)
    expect(env.ANTHROPIC_API_KEY).toBe(MASTER)
  })

  it("apiKeySourceOverride=USER_OWN_KEY beats user.apiKeySource=PLATFORM_CREDIT → decrypted user key", () => {
    const env = deriveContainerEnv(ws("USER_OWN_KEY"), usr("PLATFORM_CREDIT", [anthropicKey]))
    expect(env.CLAWS_CREDIT_MODE).toBe(false)
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-plain-ENC_ANTHROPIC")
  })

  it("throws loud when CLAWS_MASTER_ANTHROPIC_KEY is a placeholder-* stub (WAKE-4 class)", () => {
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "placeholder-generate-random-hex"
    expect(() => deriveContainerEnv(ws(), usr("PLATFORM_CREDIT"))).toThrow(
      /deriveContainerEnv: refusing to bake placeholder env value for ANTHROPIC_API_KEY/,
    )
  })

  it("mutation: assertNoPlaceholderEnvValues must reject placeholder-* (remove guard → fail)", () => {
    // Locks the shared helper; deriveContainerEnv + buildRailwayEnvVars both call it.
    expect(() =>
      assertNoPlaceholderEnvValues(
        { CLAWS_METERING_SECRET: "placeholder-generate-random-hex" },
        "buildRailwayEnvVars",
      ),
    ).toThrow(/buildRailwayEnvVars: refusing to bake placeholder env value for CLAWS_METERING_SECRET/)
    expect(() =>
      assertNoPlaceholderEnvValues({ CLAWS_METERING_SECRET: "817bc44add3b-real" }, "buildRailwayEnvVars"),
    ).not.toThrow()
  })
})

describe("fingerprintKey — drift-detection surface", () => {
  it("is deterministic (same key → same fingerprint)", () => {
    expect(fingerprintKey("sk-ant-abc")).toBe(fingerprintKey("sk-ant-abc"))
  })
  it("differs for different keys", () => {
    expect(fingerprintKey("sk-ant-abc")).not.toBe(fingerprintKey("sk-ant-xyz"))
  })
  it("is exactly 16 chars (length-stable for logging)", () => {
    expect(fingerprintKey("sk-ant-abc")).toHaveLength(16)
    expect(fingerprintKey("x")).toHaveLength(16)
    expect(fingerprintKey("a-very-long-anthropic-key-value-1234567890")).toHaveLength(16)
  })
  it("never contains the raw key (security)", () => {
    const key = "sk-ant-supersecret-1234567890"
    const fp = fingerprintKey(key)
    expect(fp).not.toContain(key)
    expect(key).not.toContain(fp)
  })
  it("keyFingerprint is null (not undefined, not empty string) when no key", () => {
    const env = deriveContainerEnv(ws(), usr("NONE"))
    expect(env.keyFingerprint).toBeNull()
    expect(env.keyFingerprint).not.toBeUndefined()
    expect(env.keyFingerprint).not.toBe("")
  })
})
