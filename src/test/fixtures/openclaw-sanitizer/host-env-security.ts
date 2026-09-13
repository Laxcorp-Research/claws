// Vendored reconstruction from the OpenClaw runtime's compiled bundle
// `host-env-security-CJMD0__Z.js` + the embedded
// `host-env-security-policy.json` data block. Logic preserved verbatim
// relative to the bundle; we only need `isDangerousHostEnvVarName` for
// the sanitizer contract test, so other exports are elided.
//
// See README.md in this directory for source provenance and re-sync.
// Do not modify except to re-sync from upstream.

// Embedded host-env-security-policy.json (copied from the runtime bundle).
const HOST_ENV_SECURITY_POLICY = {
  blockedKeys: [
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERL5LIB",
    "PERL5OPT",
    "RUBYLIB",
    "RUBYOPT",
    "BASH_ENV",
    "ENV",
    "GIT_EXTERNAL_DIFF",
    "SHELL",
    "SHELLOPTS",
    "PS4",
    "GCONV_PATH",
    "IFS",
    "SSLKEYLOGFILE",
  ],
  blockedPrefixes: ["DYLD_", "LD_", "BASH_FUNC_"],
} as const

const PORTABLE_ENV_VAR_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

const HOST_DANGEROUS_ENV_KEY_VALUES = Object.freeze(
  HOST_ENV_SECURITY_POLICY.blockedKeys.map((key) => key.toUpperCase()),
)
const HOST_DANGEROUS_ENV_PREFIXES = Object.freeze(
  HOST_ENV_SECURITY_POLICY.blockedPrefixes.map((prefix) => prefix.toUpperCase()),
)

const HOST_DANGEROUS_ENV_KEYS = new Set(HOST_DANGEROUS_ENV_KEY_VALUES)

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
