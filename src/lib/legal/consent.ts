/**
 * Legal wiring: canonical buildclaws.ai legal URLs + consent versioning.
 *
 * NO NEW PAGES: the app links to the marketing site's live legal pages
 * (Framer, sitemap-verified 2026-09-17). The obscured path segment is the
 * marketing site's own choice - treat the full URLs here as the canonical
 * references and update in ONE place if marketing re-slugs them.
 *
 * Consent storage: ConsentRecord rows (append-only, no FKs - legal evidence
 * must survive workspace/user rows; same audit-row rule as
 * RailwayCreateLedger). Three kinds:
 *   TOS_PRIVACY           - signup checkbox "I agree to the Terms and
 *                           Privacy Policy" (blocked without; stored with
 *                           version + timestamp at user creation)
 *   FINANCIAL_AUTONOMY_S8 - first deploy of a financial template requires
 *                           "I've read the AI & autonomy terms (§8)"
 *   AUTONOMOUS_MODE_S8    - Ask-before-acting -> Autonomous knob flip
 *                           (risk line links §8; stored on every flip)
 */

const LEGAL_BASE = "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck"

export const LEGAL_URLS = {
  privacy: `${LEGAL_BASE}/privacy-policy`,
  terms: `${LEGAL_BASE}/terms-of-service`,
  cookie: `${LEGAL_BASE}/cookie-policy`,
  aup: `${LEGAL_BASE}/acceptable-use`,
  dataProcessing: `${LEGAL_BASE}/data-processing`,
} as const

/** ToS §8 "Autonomous agents: authority and responsibility". The Framer page
 * has no heading anchors (verified: only framework ids in the DOM), so §8
 * links land on the page top; the label carries the section number. */
export const TERMS_SECTION_8_URL = LEGAL_URLS.terms

/**
 * Version stamped on consent rows. MUST track the ToS "Effective date"
 * (live page reads "Effective date: August 2026"). Bump when legal ships a
 * new effective date; signup then records the new version and previously
 * consented users get a lazy row on their next sign-in.
 */
export const TOS_VERSION = "2026-08"

/** Cookie the signin page sets before starting any auth flow; the NextAuth
 * signIn callback / createUser event read it server-side. One hour is ample
 * for the OAuth round-trip. Not httpOnly on purpose: it is a client-side
 * assertion of a checkbox state, not a secret. */
export const TOS_CONSENT_COOKIE = "claws_tos_consent"
export const TOS_CONSENT_COOKIE_MAX_AGE_S = 60 * 60

const VERSION_SHAPE = /^\d{4}-\d{2}$/

/** Cookie payload guard - only a plausible version string may reach the DB. */
export function parseConsentCookieVersion(raw: string | undefined | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  return VERSION_SHAPE.test(value) ? value : null
}

// ---------------------------------------------------------------------------
// Financial templates (§8 ack gate)
// ---------------------------------------------------------------------------

/**
 * Templates whose deploys move (or can move) money / place orders. First
 * deploy of a workspace created from one of these requires the §8
 * acknowledgement. Mirrors REGULATED_TEMPLATE_SLUGS' shape (explicit slug
 * list beats inference from skills - a marketplace template with an
 * innocuous skill set can still be financial in intent, and the founder
 * curates this list).
 */
export const FINANCIAL_TEMPLATE_SLUGS = ["quant-trader"] as const

export function isFinancialTemplateSlug(slug: string | null | undefined): boolean {
  if (!slug) return false
  return (FINANCIAL_TEMPLATE_SLUGS as readonly string[]).includes(slug)
}

// ---------------------------------------------------------------------------
// Copy (locked by tests so legal wording cannot silently drift)
// ---------------------------------------------------------------------------

export const SIGNUP_CONSENT_LABEL = "I agree to the Terms and Privacy Policy"

export const FINANCIAL_ACK_LABEL = "I've read the AI & autonomy terms (§8)"

export const FINANCIAL_ACK_BODY =
  "This Claw can generate trading signals and (in autonomous mode, paper hosts only) place orders. You are responsible for what your agents do - see the AI & autonomy terms (§8) of the Terms of Service."

export const AUTONOMOUS_S8_RISK_LINE =
  "Autonomous actions run without per-action approval and are your responsibility under the AI & autonomy terms (§8)."

/** Error code the deploy route returns when the §8 ack is missing. */
export const FINANCIAL_ACK_REQUIRED_CODE = "FINANCIAL_TERMS_ACK_REQUIRED"
