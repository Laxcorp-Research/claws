/**
 * container-env-actual.ts - the "ACTUAL" (observed-from-the-container) side of
 * the PR-8 reconciliation, the mirror of derive-container-env.ts's "EXPECTED"
 * (derived-from-DB) side. The reconciliation cron compares the two: actual env
 * read off the live Railway service vs. what deriveContainerEnv says it should
 * be, using fingerprints (never raw values).
 *
 * PR-8a/B/A seeds this file with the RawContainerEnv brand only.
 * PR-8a/B/B adds parseClawsEnvB64 here.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SECURITY - RAW SECRET MATERIAL                                             ║
 * ║                                                                            ║
 * ║ A RawContainerEnv is a container's live, rendered environment: real        ║
 * ║ ANTHROPIC_API_KEY, OPENCLAW_GATEWAY_TOKEN, COMPOSIO_API_KEY, channel       ║
 * ║ tokens, CLAWS_ENV_GZ_B64 / CLAWS_ENV_B64, etc. It is plaintext secret      ║
 * ║ material.                                                                  ║
 * ║                                                                            ║
 * ║ ARCHITECTURAL RULE: a RawContainerEnv may flow ONLY into the credential    ║
 * ║ comparison reducer (which emits fingerprints + booleans). It must NEVER    ║
 * ║ be logged, returned in an API response, persisted, or stringified into     ║
 * ║ any sink. The brand below is a compile-time signal; THIS RULE is the real  ║
 * ║ guarantee. See CONTAINER_ENV_RECONCILIATION_CONTRACT.md §6 / §9.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { gunzipSync } from "node:zlib"
import { parse as parseDotenv } from "dotenv"

// Phantom brand. Never present at runtime - purely a type-level marker so a
// plain Record<string,string> cannot be assigned where RawContainerEnv is
// expected without an explicit cast, and so the danger is visible in every
// signature that touches it. (Structural typing means the brand is a signal,
// not airtight enforcement - the architectural rule above is the guarantee.)
declare const __rawContainerEnvBrand: unique symbol

/**
 * A container's full env as a flat `NAME → value` map. RAW SECRET MATERIAL
 * (see the module banner). Read it as a `Record<string,string>`; produce it
 * only via the helpers that carry the security contract (getServiceVariables,
 * parseClawsEnvB64 / parseClawsEnvPayload).
 */
export type RawContainerEnv = Record<string, string> & {
  readonly [__rawContainerEnvBrand]: never
}

/**
 * SECURITY - RAW SECRET MATERIAL (see module banner). Decodes a container's
 * `CLAWS_ENV_B64` (base64 of its baked `.env`) into a flat map - including any
 * BYOK `ANTHROPIC_API_KEY`, channel tokens, etc. Pass ONLY to the credential
 * comparison reducer; NEVER log, return, or persist it.
 *
 * TOTAL function - never throws. Empty input, a non-string/undefined input
 * (e.g. a missing CLAWS_ENV_B64), or unparseable content all yield `{}` (a
 * corrupt/absent env is "nothing to compare", which the reconciliation cron
 * reads as drift). Uses `dotenv.parse` for the `.env` grammar: `#` comments,
 * single/double quotes, double-quoted multiline values, last-wins on dupes.
 */
export function parseClawsEnvB64(envB64: string): RawContainerEnv {
  try {
    const decoded = Buffer.from(envB64, "base64").toString("utf8")
    return parseDotenv(decoded) as RawContainerEnv
  } catch {
    // Buffer.from throws only if envB64 is not a string (e.g. a missing
    // CLAWS_ENV_B64 arriving as undefined). The total-function contract turns
    // that into an empty result rather than crashing the cron tick. Base64 of
    // a string is itself lenient and never throws.
    return {} as RawContainerEnv
  }
}

/**
 * SECURITY - RAW SECRET MATERIAL (see module banner). Decodes the current
 * gzipped env payload format emitted by deployer.ts. Kept separate from the
 * legacy parser so callers can explicitly prefer the new var and still fall
 * back to old running containers.
 */
export function parseClawsEnvGzB64(envGzB64: string): RawContainerEnv {
  try {
    const decoded = gunzipSync(Buffer.from(envGzB64, "base64")).toString("utf8")
    return parseDotenv(decoded) as RawContainerEnv
  } catch {
    return {} as RawContainerEnv
  }
}

/**
 * Prefer the new compressed env payload, then fall back to the old plain
 * base64 var so reconciliation keeps working across mixed deploy generations.
 */
export function parseClawsEnvPayload(env: RawContainerEnv): RawContainerEnv {
  if (env.CLAWS_ENV_GZ_B64) return parseClawsEnvGzB64(env.CLAWS_ENV_GZ_B64)
  return parseClawsEnvB64(env.CLAWS_ENV_B64 ?? "")
}
