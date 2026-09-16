// Vendored from OpenClaw runtime's src/skills/runtime/env-overrides.ts @ v2026.9.4.
// Only `sanitizeSkillEnvOverrides` + `isAlwaysBlockedSkillEnvKey` are needed
// for the contract test; the outer apply/revert + logger/config machinery
// is out of scope - we only test the allow/block decision given an overrides
// record + an allowlist.
//
// See README.md in this directory for source provenance and re-sync.
// Do not modify except to re-sync from upstream.

import { sanitizeEnvVars, validateEnvVarValue } from "./sanitize-env-vars"
import {
  isDangerousHostEnvOverrideVarName,
  isDangerousHostEnvVarName,
} from "./host-env-security"

export type SanitizedSkillEnvOverrides = {
  allowed: Record<string, string>
  blocked: string[]
  warnings: string[]
}

// Always block skill env overrides that can alter runtime loading or host
// execution behavior.
const SKILL_ALWAYS_BLOCKED_ENV_PATTERNS: ReadonlyArray<RegExp> = [/^OPENSSL_CONF$/i]

function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

export function isAlwaysBlockedSkillEnvKey(key: string): boolean {
  return (
    isDangerousHostEnvVarName(key) ||
    isDangerousHostEnvOverrideVarName(key) ||
    matchesAnyPattern(key, SKILL_ALWAYS_BLOCKED_ENV_PATTERNS)
  )
}

/**
 * Verbatim port of env-overrides.ts's `sanitizeSkillEnvOverrides` function.
 * Decision logic (matches runtime @ v2026.9.4):
 *   1. Run tier-1 sanitizer on the overrides map. The tier-1 sanitizer
 *      blocks env var names matching credential-looking patterns
 *      (/_?(API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|SECRET)$/i, /_ADMIN_KEY$/i).
 *   2. For keys the tier-1 sanitizer ALLOWED: if the key is in the
 *      always-blocked list (host dangerous names + override names,
 *      OPENSSL_CONF), block it. Otherwise keep it allowed.
 *   3. For keys the tier-1 sanitizer BLOCKED: if the key is NOT in the
 *      skill's allowedSensitiveKeys set (= primaryEnv + requires.env),
 *      stay blocked. If it IS in the allowlist, re-admit the key unless
 *      the VALUE has null bytes (then re-block it) OR the key is
 *      always-blocked.
 *
 * This is the half of the runtime sanitizer we want to test our generator
 * output against: given our emitted skills.entries[slug].env map AND the
 * emitted SKILL.md frontmatter's primaryEnv+requires.env, does every
 * intended credential pass through? Does no unintended one pass through?
 *
 * Vendor omits live plugin secret inventory (`listKnownSecretEnvVarNames`);
 * the pattern list is the 9.4 source of truth for generator emit.
 */
export function sanitizeSkillEnvOverrides(params: {
  overrides: Record<string, string>
  allowedSensitiveKeys: Set<string>
}): SanitizedSkillEnvOverrides {
  if (Object.keys(params.overrides).length === 0) {
    return { allowed: {}, blocked: [], warnings: [] }
  }

  const result = sanitizeEnvVars(params.overrides)
  const allowed: Record<string, string> = {}
  const blocked = new Set<string>()
  const warnings = [...result.warnings]

  for (const [key, value] of Object.entries(result.allowed)) {
    if (isAlwaysBlockedSkillEnvKey(key)) {
      blocked.add(key)
      continue
    }
    allowed[key] = value
  }

  for (const key of result.blocked) {
    if (isAlwaysBlockedSkillEnvKey(key) || !params.allowedSensitiveKeys.has(key)) {
      blocked.add(key)
      continue
    }
    const value = params.overrides[key]
    if (!value) {
      continue
    }
    const warning = validateEnvVarValue(value)
    if (warning) {
      if (warning === "Contains null bytes") {
        blocked.add(key)
        continue
      }
      warnings.push(`${key}: ${warning}`)
    }
    allowed[key] = value
  }

  return { allowed, blocked: [...blocked], warnings }
}
