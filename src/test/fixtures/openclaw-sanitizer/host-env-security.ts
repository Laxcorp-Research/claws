// Vendored reconstruction from OpenClaw v2026.9.4
// `src/infra/host-env-security.ts` + `src/infra/host-env-security-policy.json`.
// Only `isDangerousHostEnvVarName` and `isDangerousHostEnvOverrideVarName`
// are needed for the sanitizer contract test; exec-filter machinery is elided.
//
// See README.md in this directory for source provenance and re-sync.
// Do not modify except to re-sync from upstream.

import HOST_ENV_SECURITY_POLICY from "./host-env-security-policy.json"

const PORTABLE_ENV_VAR_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

const HOST_DANGEROUS_ENV_KEYS = new Set(
  HOST_ENV_SECURITY_POLICY.blockedEverywhereKeys.map((key) => key.toUpperCase()),
)
const HOST_DANGEROUS_ENV_PREFIXES = HOST_ENV_SECURITY_POLICY.blockedPrefixes.map((prefix) =>
  prefix.toUpperCase(),
)
const HOST_DANGEROUS_OVERRIDE_ENV_KEYS = new Set(
  HOST_ENV_SECURITY_POLICY.blockedOverrideOnlyKeys.map((key) => key.toUpperCase()),
)
const HOST_DANGEROUS_OVERRIDE_ENV_PREFIXES =
  HOST_ENV_SECURITY_POLICY.blockedOverridePrefixes.map((prefix) => prefix.toUpperCase())
const CARGO_TARGET_EXECUTABLE_OVERRIDE_ENV_KEY = /^CARGO_TARGET_[A-Z0-9_]+_(?:LINKER|RUNNER)$/

function normalizeEnvVarKey(rawKey: string, options?: { portable?: boolean }): string | null {
  const key = rawKey.trim()
  if (!key) return null
  if (options?.portable && !PORTABLE_ENV_VAR_KEY.test(key)) return null
  return key
}

export function isDangerousHostEnvVarName(rawKey: string): boolean {
  const key = normalizeEnvVarKey(rawKey)
  if (!key) return false
  const upper = key.toUpperCase()
  if (HOST_DANGEROUS_ENV_KEYS.has(upper)) return true
  return HOST_DANGEROUS_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
}

export function isDangerousHostEnvOverrideVarName(rawKey: string): boolean {
  const key = normalizeEnvVarKey(rawKey)
  if (!key) return false
  const upper = key.toUpperCase()
  if (HOST_DANGEROUS_OVERRIDE_ENV_KEYS.has(upper)) return true
  if (CARGO_TARGET_EXECUTABLE_OVERRIDE_ENV_KEY.test(upper)) return true
  return HOST_DANGEROUS_OVERRIDE_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
}
