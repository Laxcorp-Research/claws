import type { HttpClass } from "@/lib/openclaw/http-contract"

/**
 * INFRA-5b: classify Composio ops by name. Default ACTION (fail-closed).
 * Do not hand-label the toolkit catalog. Explicit skill endpoints still win
 * at match time; this fills every other `{prefix}*` op.
 *
 * READ iff an underscore-delimited token matches the allowlist AND the op
 * is not a read-looking mutator (GET_OR_CREATE, FIND_AND_REPLACE, ...).
 *
 * QUERY and LOOKUP are treated as READ: Notion query + Composio whoami
 * cheap-ops (TWITTER_USER_LOOKUP_ME) are reads. Template allowlists override.
 */
const READ_TOKENS = new Set([
  "LIST",
  "GET",
  "FETCH",
  "SEARCH",
  "READ",
  "RETRIEVE",
  "FIND",
  "QUERY",
  "LOOKUP",
])

/** Read-looking names that still mutate. Substring match on the full op id. */
export const COMPOSIO_READ_LOOKING_MUTATORS: readonly string[] = [
  "GET_OR_CREATE",
  "FIND_OR_CREATE",
  "FIND_AND_REPLACE",
  "SEARCH_AND_REPLACE",
  "FETCH_AND_UPDATE",
  "GET_AND_UPDATE",
  "READ_AND_WRITE",
  "SEARCH_AND_UPDATE",
  "LOOKUP_AND_CREATE",
  "LOOKUP_AND_UPDATE",
  "QUERY_AND_UPDATE",
]

/**
 * Per-template overrides for recommended tools. Empty until a template
 * needs a class the heuristic would get wrong. Skill explicit endpoints
 * still take precedence in matchHttpEndpoint.
 */
export const COMPOSIO_TEMPLATE_OP_CLASS: Readonly<
  Record<string, Readonly<Record<string, HttpClass>>>
> = {}

export function classifyComposioOp(
  operation: string,
  overrides?: Readonly<Record<string, HttpClass>>,
): HttpClass {
  const op = operation.trim().toUpperCase()
  if (!op) return "ACTION"
  const fromOverride = overrides?.[op] ?? overrides?.[operation.trim()]
  if (fromOverride === "READ" || fromOverride === "ACTION") return fromOverride
  for (const mutator of COMPOSIO_READ_LOOKING_MUTATORS) {
    if (op.includes(mutator)) return "ACTION"
  }
  const tokens = op.split("_")
  for (const token of tokens) {
    if (READ_TOKENS.has(token)) return "READ"
  }
  return "ACTION"
}

export function composioOverridesForTemplate(
  templateSlug: string | null | undefined,
  extra?: Readonly<Record<string, HttpClass>>,
): Record<string, HttpClass> | undefined {
  const fromTemplate = templateSlug ? COMPOSIO_TEMPLATE_OP_CLASS[templateSlug] : undefined
  if (!fromTemplate && !extra) return undefined
  return { ...(fromTemplate ?? {}), ...(extra ?? {}) }
}
