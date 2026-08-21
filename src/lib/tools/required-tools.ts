/**
 * Shared required-tool satisfaction for Setup Step 2 UI + deploy gate.
 *
 * Finding F: B3 writes honest PENDING for validator-less API keys; Step 2
 * already treated those as connected-with-warning. The deploy gate wrongly
 * demanded status===CONNECTED and also gated on isAIProvider tools (Step 1
 * domain). One predicate + one AI-provider filter keep both surfaces honest.
 */
import { getToolBySlug } from "@/data/tool-catalog"

/** Connection types that store a user-supplied key/secret (not OAuth). */
export const KEY_CONNECTION_TYPES = ["API_KEY", "BEARER_TOKEN", "BASIC"] as const
export type KeyConnectionType = (typeof KEY_CONNECTION_TYPES)[number]

export interface RequiredToolEntry {
  slug: string
  name?: string
  alternatives?: string[]
}

/**
 * Minimal connection shape for satisfaction checks. `hasCredentials` is the
 * preferred signal (GET /api/tools sets it from encryptedCredentials).
 * `keyHint` / non-empty `lastError` are accepted fallbacks so Step-2 UI
 * summaries and older payloads stay compatible.
 */
export interface RequiredToolConnection {
  toolSlug: string
  status: string
  connectionType?: string | null
  lastError?: string | null
  keyHint?: string | null
  hasCredentials?: boolean
}

export interface RequiredToolsSatisfaction {
  /** True when every non-AI required entry is satisfied (deploy allowed). */
  satisfied: boolean
  /** Primary slugs still missing a satisfying connection. */
  missingSlugs: string[]
  /** Display names (or slug fallback) for missing required tools. */
  missingLabels: string[]
  /** Count of required entries satisfied only via credentialed-PENDING. */
  unverifiedCount: number
}

export function isKeyConnectionType(
  connectionType: string | null | undefined,
): connectionType is KeyConnectionType {
  return (
    typeof connectionType === "string" &&
    (KEY_CONNECTION_TYPES as readonly string[]).includes(connectionType)
  )
}

export function isAiProviderSlug(slug: string): boolean {
  return Boolean(getToolBySlug(slug)?.isAIProvider)
}

/**
 * Drop AI-provider entries from a template required set. Model keys / credits
 * are Step 1's domain - they must never block the deploy gate.
 */
export function filterNonAiProviderRequiredEntries<T extends RequiredToolEntry>(
  entries: T[],
): T[] {
  return entries.filter((entry) => !isAiProviderSlug(entry.slug))
}

export function hasStoredCredentials(conn: RequiredToolConnection): boolean {
  if (typeof conn.hasCredentials === "boolean") return conn.hasCredentials
  if (typeof conn.keyHint === "string" && conn.keyHint.length > 0) return true
  // B3 always sets lastError when a key is saved PENDING (unverified/warning).
  return Boolean(conn.lastError?.trim()) && isKeyConnectionType(conn.connectionType)
}

/**
 * Credentialed key PENDING with B3 unverified/warning lastError semantics.
 * Bare PENDING OAuth (handshake in flight) is NOT included.
 */
export function isCredentialedKeyPending(conn: RequiredToolConnection): boolean {
  if (conn.status !== "PENDING") return false
  if (!isKeyConnectionType(conn.connectionType)) return false
  if (!hasStoredCredentials(conn)) return false
  // Unverified / transient-warning semantics: B3 always persists a lastError.
  return Boolean(conn.lastError?.trim())
}

/**
 * Single connection satisfaction predicate (Step 2 connected UI + deploy gate).
 * CONNECTED ✓; credentialed-key PENDING-unverified ✓; bare OAuth PENDING ✗; ERROR ✗.
 */
export function connectionSatisfiesRequired(conn: RequiredToolConnection): boolean {
  if (conn.status === "CONNECTED") return true
  if (conn.status === "ERROR") return false
  return isCredentialedKeyPending(conn)
}

function entryCandidates(entry: RequiredToolEntry): string[] {
  return [entry.slug, ...(entry.alternatives ?? [])]
}

/**
 * Evaluate whether all required template tools are satisfied.
 * Caller must already exclude AI providers via filterNonAiProviderRequiredEntries
 * (or pass a pre-filtered list). This function does not re-filter.
 */
export function requiredToolsSatisfied(
  requiredEntries: RequiredToolEntry[],
  connections: RequiredToolConnection[],
): RequiredToolsSatisfaction {
  if (requiredEntries.length === 0) {
    return { satisfied: true, missingSlugs: [], missingLabels: [], unverifiedCount: 0 }
  }

  const missingSlugs: string[] = []
  const missingLabels: string[] = []
  let unverifiedCount = 0

  for (const entry of requiredEntries) {
    const candidates = entryCandidates(entry)
    const match = connections.find(
      (connection) =>
        candidates.includes(connection.toolSlug) && connectionSatisfiesRequired(connection),
    )
    if (!match) {
      missingSlugs.push(entry.slug)
      missingLabels.push(entry.name?.trim() || entry.slug)
      continue
    }
    if (isCredentialedKeyPending(match)) unverifiedCount++
  }

  return {
    satisfied: missingSlugs.length === 0,
    missingSlugs,
    missingLabels,
    unverifiedCount,
  }
}

/** Banner title when one or more required tools are still missing. */
export function missingRequiredToolsBannerTitle(missingLabels: string[]): string {
  if (missingLabels.length === 0) {
    return "Required tools must be connected before deployment"
  }
  if (missingLabels.length === 1) {
    return `Connect ${missingLabels[0]} before deployment`
  }
  return `Connect required tools before deployment: ${missingLabels.join(", ")}`
}

/** Optional info line when deploy is allowed but some keys are unverified. */
export function unverifiedToolsInfoLine(unverifiedCount: number): string | null {
  if (unverifiedCount <= 0) return null
  if (unverifiedCount === 1) {
    return "1 tool will be verified on first use."
  }
  return `${unverifiedCount} tools will be verified on first use.`
}

export const REQUIRED_TOOLS_SECTION_SUBTITLE =
  "Required for this template - you can add anything else via Browse or Custom API"

export const MISSING_REQUIRED_TOOLS_BANNER_BODY =
  "Go back to Tools and connect the required services for this Claw."
