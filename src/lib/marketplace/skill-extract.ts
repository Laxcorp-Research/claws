/**
 * PR-3: auto-extract requiredBins / requiredEnvVars from SKILL.md body.
 * Union with creator-declared lists at publish time.
 */

const ENV_VAR_RE = /\b([A-Z][A-Z0-9_]{2,})\b/g
const BIN_HINT_RE =
  /\b(?:requires?|needs?|install|depends?\s+on|bin(?:ary)?|cli)\s*[:=]?\s*`?([a-z][a-z0-9._-]{1,40})`?/gi
const CODE_BIN_RE = /(?:^|\s)(?:sudo\s+)?([a-z][a-z0-9._-]{1,40})\s+(?:--|-[a-z])/gim
const FRONTMATTER_BINS_RE = /(?:^|\n)(?:bins|requiredBins|requires)\s*:\s*\[([^\]]+)\]/i
const FRONTMATTER_ENV_RE = /(?:^|\n)(?:env|requiredEnvVars|environment)\s*:\s*\[([^\]]+)\]/i

/** Common English / markdown words that look like SCREAMING_SNAKE but aren't env vars. */
const ENV_DENYLIST = new Set([
  "HTTP",
  "HTTPS",
  "JSON",
  "YAML",
  "TODO",
  "NOTE",
  "WARNING",
  "ERROR",
  "TRUE",
  "FALSE",
  "NULL",
  "SKU",
  "UUID",
  "URL",
  "URI",
  "API",
  "CLI",
  "SDK",
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "SKILL",
  "MD",
  "README",
])

/** Binaries too generic to auto-require. */
const BIN_DENYLIST = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "use",
  "run",
  "call",
  "echo",
  "set",
  "get",
  "put",
  "npm",
  "npx",
  "node",
  "python",
  "bash",
  "sh",
  "curl",
  "wget",
])

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort()
}

function parseBracketList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

export type SkillMdExtraction = {
  requiredBins: string[]
  requiredEnvVars: string[]
}

export function extractSkillRequirements(skillMd: string): SkillMdExtraction {
  const bins: string[] = []
  const envs: string[] = []

  const fmBins = skillMd.match(FRONTMATTER_BINS_RE)
  if (fmBins?.[1]) bins.push(...parseBracketList(fmBins[1]))

  const fmEnv = skillMd.match(FRONTMATTER_ENV_RE)
  if (fmEnv?.[1]) envs.push(...parseBracketList(fmEnv[1]))

  let m: RegExpExecArray | null
  const binHint = new RegExp(BIN_HINT_RE.source, BIN_HINT_RE.flags)
  while ((m = binHint.exec(skillMd)) !== null) {
    const bin = m[1].toLowerCase()
    if (!BIN_DENYLIST.has(bin)) bins.push(bin)
  }

  const codeBin = new RegExp(CODE_BIN_RE.source, CODE_BIN_RE.flags)
  while ((m = codeBin.exec(skillMd)) !== null) {
    const bin = m[1].toLowerCase()
    if (!BIN_DENYLIST.has(bin)) bins.push(bin)
  }

  // $ENV_VAR and ${ENV_VAR}
  const dollarEnv = /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g
  while ((m = dollarEnv.exec(skillMd)) !== null) {
    if (!ENV_DENYLIST.has(m[1])) envs.push(m[1])
  }

  // Bare SCREAMING_SNAKE that looks like credentials
  const bare = new RegExp(ENV_VAR_RE.source, "g")
  while ((m = bare.exec(skillMd)) !== null) {
    const name = m[1]
    if (ENV_DENYLIST.has(name)) continue
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/.test(name)) {
      envs.push(name)
    }
  }

  return {
    requiredBins: uniqSorted(bins),
    requiredEnvVars: uniqSorted(envs),
  }
}

export type RequirementMerge = {
  requiredBins: string[]
  requiredEnvVars: string[]
  /** Non-empty when creator-declared set differs from extracted. */
  mismatchNote: string | null
}

export function mergeSkillRequirements(
  declaredBins: string[] | undefined,
  declaredEnvVars: string[] | undefined,
  extracted: SkillMdExtraction,
): RequirementMerge {
  const declaredB = uniqSorted(declaredBins ?? [])
  const declaredE = uniqSorted(declaredEnvVars ?? [])
  const requiredBins = uniqSorted([...declaredB, ...extracted.requiredBins])
  const requiredEnvVars = uniqSorted([...declaredE, ...extracted.requiredEnvVars])

  const missingFromDeclaredBins = extracted.requiredBins.filter((b) => !declaredB.includes(b))
  const missingFromDeclaredEnv = extracted.requiredEnvVars.filter((e) => !declaredE.includes(e))
  const unusedDeclaredBins = declaredB.filter((b) => !extracted.requiredBins.includes(b))
  const unusedDeclaredEnv = declaredE.filter((e) => !extracted.requiredEnvVars.includes(e))

  const parts: string[] = []
  if (missingFromDeclaredBins.length || missingFromDeclaredEnv.length) {
    parts.push(
      `Extracted-not-declared: bins=[${missingFromDeclaredBins.join(", ")}] env=[${missingFromDeclaredEnv.join(", ")}]`,
    )
  }
  if (unusedDeclaredBins.length || unusedDeclaredEnv.length) {
    parts.push(
      `Declared-not-extracted: bins=[${unusedDeclaredBins.join(", ")}] env=[${unusedDeclaredEnv.join(", ")}]`,
    )
  }

  return {
    requiredBins,
    requiredEnvVars,
    mismatchNote: parts.length > 0 ? parts.join("; ") : null,
  }
}
