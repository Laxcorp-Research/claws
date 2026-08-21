import { createHash } from "crypto"
import type { ApiKeySource, ApiProvider } from "@/generated/prisma/client"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import { decrypt } from "@/lib/encryption"

// The in-container credit proxy (container/credit-proxy.mjs) listens here, so
// credit-mode containers point ANTHROPIC_BASE_URL at it. MUST match
// deployer.ts and api/internal/container-secrets/route.ts.
export const ANTHROPIC_PROXY_URL = "http://localhost:3789"

/**
 * The credential-relevant subset of a container's env, derived purely from
 * current DB state. Single source of truth shared by the deploy path
 * (buildRailwayEnvVars) and the PR-8 reconciliation cron.
 *
 * `keyFingerprint` is the drift-detection surface: a short sha256 of the key
 * that proves *change* without revealing the value. It is `string | null`
 * (always present; `null` when no key) rather than optional, so the cron's
 * comparison reads it uniformly and never confuses "no key" with "field
 * forgotten". The raw key is NEVER logged - only this fingerprint.
 */
export interface DerivedContainerEnv {
  /** Present only when a key applies (PLATFORM_CREDIT master, or a BYOK key). */
  ANTHROPIC_API_KEY?: string
  /** Always present. */
  CLAWS_CREDIT_MODE: boolean
  /** Present iff credit mode (points at the in-container proxy). */
  ANTHROPIC_BASE_URL?: string
  /** sha256(key) base64, first 16 chars; `null` when no key. */
  keyFingerprint: string | null
}

/** Minimal structural inputs - Prisma row subsets, so the helper stays pure. */
export interface DeriveWorkspaceInput {
  apiKeySourceOverride: ApiKeySource | null
}
export interface DeriveUserInput {
  apiKeySource: ApiKeySource
  apiKeys: Array<{ provider: ApiProvider; encryptedKey: string }>
}

/**
 * sha256 of the key → base64 → first 16 chars. Detects *change*, never reveals
 * the value (safe to log). Short + length-stable for log columns / dashboards.
 */
export function fingerprintKey(key: string): string {
  return createHash("sha256").update(key).digest("base64").slice(0, 16)
}

/**
 * Local `.env.local` sometimes carries `placeholder-*` stubs (e.g.
 * `METERING_MASTER_SECRET=placeholder-generate-random-hex`). Baking those into
 * a live container makes reserve/report-batch 401 forever while the proxy
 * still looks "healthy". Refuse loudly at derive/deploy time.
 */
export const PLACEHOLDER_ENV_VALUE_RE = /^placeholder-/

/**
 * Throw if any string value in `env` matches `/^placeholder-/`.
 * Used by `deriveContainerEnv` and `buildRailwayEnvVars`.
 */
export function assertNoPlaceholderEnvValues(
  env: Record<string, unknown>,
  source: string,
): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length === 0) continue
    if (PLACEHOLDER_ENV_VALUE_RE.test(value)) {
      throw new Error(
        `${source}: refusing to bake placeholder env value for ${key} ` +
          `(matches /^placeholder-/). Fix the control-plane secret ` +
          `(do not deploy with local placeholder stubs).`,
      )
    }
  }
}

/**
 * Derive a container's credential env from current DB state. Pure: no DB or
 * network - callers pass row subsets.
 *
 * Matrix (see CONTAINER_ENV_RECONCILIATION_CONTRACT.md §1–§3):
 *   PLATFORM_CREDIT            → platform master key + credit mode + proxy URL
 *   USER_OWN_KEY / NONE + key  → decrypted user ANTHROPIC key, no credit mode
 *   USER_OWN_KEY / NONE, no key→ no key, no credit mode
 * `apiKeySourceOverride` wins over `user.apiKeySource` (via getApiKeySource).
 */
export function deriveContainerEnv(
  workspace: DeriveWorkspaceInput,
  user: DeriveUserInput,
): DerivedContainerEnv {
  const source = getApiKeySource(workspace, user)

  let derived: DerivedContainerEnv
  if (source === "PLATFORM_CREDIT") {
    // Platform master key - NOT the user's key. Matches deployer.ts:551.
    const masterKey = process.env.CLAWS_MASTER_ANTHROPIC_KEY || ""
    derived = {
      ANTHROPIC_API_KEY: masterKey,
      CLAWS_CREDIT_MODE: true,
      ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_URL,
      keyFingerprint: masterKey ? fingerprintKey(masterKey) : null,
    }
  } else {
    // USER_OWN_KEY or NONE → the user's own ANTHROPIC key if present, else none.
    // (NONE-with-key is the "stale BYOK" state surfaced in the PR-8 investigation.)
    const anthropicKey = user.apiKeys.find((k) => k.provider === "ANTHROPIC")
    if (anthropicKey) {
      const decrypted = decrypt(anthropicKey.encryptedKey)
      derived = {
        ANTHROPIC_API_KEY: decrypted,
        CLAWS_CREDIT_MODE: false,
        keyFingerprint: fingerprintKey(decrypted),
      }
    } else {
      derived = { CLAWS_CREDIT_MODE: false, keyFingerprint: null }
    }
  }

  assertNoPlaceholderEnvValues(
    {
      ANTHROPIC_API_KEY: derived.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: derived.ANTHROPIC_BASE_URL,
    },
    "deriveContainerEnv",
  )
  return derived
}
