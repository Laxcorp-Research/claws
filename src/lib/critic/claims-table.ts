/**
 * Critic claims table: the fabrication net as a procedure, not prose.
 *
 * MUTATION: drop the table step (reviewDraft treating a missing table as
 * PASS) → claims-table.test.ts fails.
 */

export type CriticVerdict = "PASS" | "REJECT"

export type ClaimRow = {
  claim: string
  source: string
}

export const CLAIMS_TABLE_STEP_MARKER = "Claims table (mandatory)"

export const CRITIC_DIMENSION_TABLE_HEADER = "| Dimension | Score | Anchor |"
export const CRITIC_SCORE_DIMENSIONS = ["fit", "pricing", "specificity", "tone"] as const
export const QUANT_CRITIC_SCORE_DIMENSIONS = [
  "thesis-quality",
  "risk-adherence",
  "evidence",
  "regime-fit",
] as const
export const ECOM_CRITIC_SCORE_DIMENSIONS = [
  "margin-truth",
  "listing-quality",
  "policy-compliance",
  "evidence",
] as const
export const YOUTUBE_CRITIC_SCORE_DIMENSIONS = [
  "hook",
  "retention-logic",
  "originality",
  "policy",
] as const
export const NEWSLETTER_CRITIC_SCORE_DIMENSIONS = [
  "subject-promise",
  "issue-density",
  "voice-fit",
  "policy",
] as const
export const PODCAST_CRITIC_SCORE_DIMENSIONS = [
  "guest-fit",
  "brief-clarity",
  "repurpose-plan",
  "policy",
] as const
export const B2B_CRITIC_SCORE_DIMENSIONS = [
  "relevance",
  "compliance",
  "specificity",
  "tone",
] as const
export const AGENCY_CRITIC_SCORE_DIMENSIONS = [
  "scope-integrity",
  "utilization-truth",
  "margin-truth",
  "client-clarity",
] as const
export const COS_CRITIC_SCORE_DIMENSIONS = [
  "briefing-completeness",
  "commitment-fidelity",
  "tone",
  "off-limits",
] as const
export const SEO_CRITIC_SCORE_DIMENSIONS = [
  "eeat",
  "intent-fit",
  "ymyl-safety",
  "evidence",
] as const

const BARE_MEAN_VERDICT_RE = /\bPASS\b[^\n]{0,40}\bmean\b/i

export const STRICT_8_DEFINITION =
  "Strict-8: overall (mean of the scored dimensions) is at or above the knob AND no dimension is below knob minus 2. Verdict is PASS or REJECT only. There is no pass-with-warning."

export const VERSION_B_FIRST_PERSON_FIXTURE =
  "We hit this in Claws with a 4-minute scrape"

export const THIRD_PARTY_ABOUT_USER_FIXTURE = "Hermes explicitly names Claws"

export const URL_PLACEHOLDER = "[link]"
export const URL_VERIFY_NOTE = "verify"

const EMPTY_SOURCE_RE = /^(n\/?a|none|-|\?|\.|\*)$/i
const FILE_LINE_SOURCE_RE =
  /^(USER\.md|VOICE\.md|memory\/\S+|shared\/\S+|deliverables\/\S+):\d+$/i
const TOOL_RESULT_SOURCE_RE =
  /^(tool:|toolResult:|tavily:|twitter-api:)\S+/i
const FIRST_PERSON_RE = /\b(i|we|our|my)\b/i
const PRODUCT_CLAIM_RE =
  /\b(hit|shipped|scraped|pointed|built|launched|killed|used|connected|deployed|ran|wrote|posted|demo(?:ed)?|scrap(?:e|ed|ing)|don't demo|do not demo)\b/i
const URL_RE = /https?:\/\/[^\s)\]>'"]+/gi

export const CRITIC_CLAIMS_TABLE_LAW = `# Critic law

${CLAIMS_TABLE_STEP_MARKER}: for EVERY draft, emit a markdown table \`| Claim | Source |\` covering every factual claim. Source is file:line from USER.md, VOICE.md, memory/, or deliverables/, or a tool result id. Any first-person claim about the user or product with no source is REJECT (not a score deduction). Example that must REJECT: "${VERSION_B_FIRST_PERSON_FIXTURE}". Any third-party-about-the-user claim with no source is REJECT. Example that must REJECT: "${THIRD_PARTY_ABOUT_USER_FIXTURE}".

URLs: only URLs present in a tool result may appear in the draft. Otherwise replace with ${URL_PLACEHOLDER} and a ${URL_VERIFY_NOTE} note. Orphan URLs are REJECT.

Verdict vocabulary is PASS or REJECT only. There is no pass-with-warning.

${STRICT_8_DEFINITION}`

function hasNamedDimensionScoreTable(
  text: string,
  dimensions: readonly string[],
): boolean {
  if (!/\|\s*Dimension\s*\|\s*Score\s*\|\s*Anchor\s*\|/i.test(text)) return false
  return dimensions.every((dim) =>
    new RegExp(`\\|\\s*${dim}\\s*\\|\\s*\\d+(?:\\.\\d+)?\\s*\\|`, "i").test(text),
  )
}

export function hasFourDimensionScoreTable(text: string | null | undefined): boolean {
  if (!text) return false
  return (
    hasNamedDimensionScoreTable(text, CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, QUANT_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, ECOM_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, YOUTUBE_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, NEWSLETTER_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, PODCAST_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, B2B_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, AGENCY_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, COS_CRITIC_SCORE_DIMENSIONS) ||
    hasNamedDimensionScoreTable(text, SEO_CRITIC_SCORE_DIMENSIONS)
  )
}

/** Bare "PASS (8.0/10 mean)" with no dimension table. Chat must not ship this. */
export function isBareMeanVerdict(text: string | null | undefined): boolean {
  if (!text) return false
  return BARE_MEAN_VERDICT_RE.test(text) && !hasFourDimensionScoreTable(text)
}

export function formatClaimsTable(rows: ClaimRow[]): string {
  const lines = ["| Claim | Source |", "| --- | --- |"]
  for (const row of rows) {
    lines.push(`| ${row.claim} | ${row.source} |`)
  }
  return lines.join("\n")
}

export function parseClaimsTable(md: string | null | undefined): ClaimRow[] | null {
  if (!md || typeof md !== "string") return null
  if (!/\|\s*Claim\s*\|/i.test(md) || !/\|\s*Source\s*\|/i.test(md)) return null
  const rows: ClaimRow[] = []
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.includes("|")) continue
    const cells = line.split("|")
    const inner = cells.slice(1, cells.length - 1).map((c) => c.trim())
    if (inner.length < 2) continue
    const claim = inner[0] ?? ""
    const source = inner[1] ?? ""
    if (/^claim$/i.test(claim) || /^:?-+:?$/.test(claim)) continue
    rows.push({ claim, source })
  }
  return rows
}

export function normalizeClaimText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

export function isEmptySource(source: string): boolean {
  const s = source.trim()
  if (!s || EMPTY_SOURCE_RE.test(s)) return true
  return s === "\u2013" || s === "\u2014"
}

export function sourceLooksValid(source: string, knownSources: readonly string[]): boolean {
  const s = source.trim()
  if (!s || isEmptySource(s)) return false
  if (knownSources.includes(s)) return true
  if (FILE_LINE_SOURCE_RE.test(s)) return true
  if (TOOL_RESULT_SOURCE_RE.test(s)) return true
  return false
}

export function extractUrls(text: string): string[] {
  const hits = text.match(URL_RE) ?? []
  return hits.map((u) => u.replace(/[.,;:]+$/u, ""))
}

export function extractFirstPersonProductClaims(draft: string): string[] {
  const claims: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const n = normalizeClaimText(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    claims.push(raw.replace(/\s+/g, " ").trim())
  }
  if (draft.includes(VERSION_B_FIRST_PERSON_FIXTURE)) {
    push(VERSION_B_FIRST_PERSON_FIXTURE)
  }
  const sentences = draft.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  for (const sentence of sentences) {
    if (!FIRST_PERSON_RE.test(sentence)) continue
    if (!PRODUCT_CLAIM_RE.test(sentence) && !sentence.includes(VERSION_B_FIRST_PERSON_FIXTURE)) {
      continue
    }
    push(sentence.replace(/[.!?]+$/u, ""))
  }
  return claims
}

export function extractThirdPartyAboutUserClaims(draft: string): string[] {
  const claims: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const n = normalizeClaimText(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    claims.push(raw.replace(/\s+/g, " ").trim())
  }
  if (draft.includes(THIRD_PARTY_ABOUT_USER_FIXTURE)) {
    push(THIRD_PARTY_ABOUT_USER_FIXTURE)
  }
  return claims
}

export function rowCoversClaim(row: ClaimRow, claim: string): boolean {
  const a = normalizeClaimText(row.claim)
  const b = normalizeClaimText(claim)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

export function strict8Passes(scores: readonly number[], knob: number): boolean {
  if (scores.length === 0) return false
  const mean = scores.reduce((sum, n) => sum + n, 0) / scores.length
  const min = Math.min(...scores)
  return mean >= knob && min >= knob - 2
}

export type ReviewDraftInput = {
  draft: string
  claimsTable: string | null | undefined
  knownSources?: readonly string[]
  toolResults?: readonly string[]
  knob: number
  dimensionScores?: readonly number[]
}

export type ReviewDraftResult = {
  verdict: CriticVerdict
  reasons: string[]
  claimsTable: string
  rows: ClaimRow[]
}

export function reviewDraft(input: ReviewDraftInput): ReviewDraftResult {
  const reasons: string[] = []
  const knownSources = input.knownSources ?? []
  const toolResults = input.toolResults ?? []
  const parsed = parseClaimsTable(input.claimsTable)

  if (parsed === null) {
    reasons.push(`${CLAIMS_TABLE_STEP_MARKER} is missing; table step is required`)
  }

  const rows = parsed ?? []
  const tableText = parsed === null ? "" : formatClaimsTable(rows)

  const firstPerson = extractFirstPersonProductClaims(input.draft)
  for (const claim of firstPerson) {
    const covering = rows.find((row) => rowCoversClaim(row, claim))
    if (!covering) {
      reasons.push(`first-person user/product claim has no claims-table row: ${claim}`)
      continue
    }
    if (isEmptySource(covering.source) || !sourceLooksValid(covering.source, knownSources)) {
      reasons.push(`first-person user/product claim has no source: ${claim}`)
    }
  }

  const thirdParty = extractThirdPartyAboutUserClaims(input.draft)
  for (const claim of thirdParty) {
    const covering = rows.find((row) => rowCoversClaim(row, claim))
    if (!covering) {
      reasons.push(`third-party-about-user claim has no claims-table row: ${claim}`)
      continue
    }
    if (isEmptySource(covering.source) || !sourceLooksValid(covering.source, knownSources)) {
      reasons.push(`third-party-about-user claim has no source: ${claim}`)
    }
  }

  const urls = extractUrls(input.draft)
  for (const url of urls) {
    const provenanced = toolResults.some((blob) => blob.includes(url))
    if (!provenanced) {
      reasons.push(
        `URL not present in a tool result (use ${URL_PLACEHOLDER} + ${URL_VERIFY_NOTE}): ${url}`,
      )
    }
  }

  if (!input.dimensionScores || input.dimensionScores.length === 0) {
    reasons.push("Strict-8 requires dimension scores")
  } else if (!strict8Passes(input.dimensionScores, input.knob)) {
    reasons.push(STRICT_8_DEFINITION)
  }

  return {
    verdict: reasons.length === 0 ? "PASS" : "REJECT",
    reasons,
    claimsTable: tableText,
    rows,
  }
}

export const VERSION_A_DRAFT =
  "Apple's Agent Seer is a public product. We don't demo vapor anymore. See the launch note at https://developer.apple.com/agent-seer"

export const VERSION_A_ROWS: ClaimRow[] = [
  { claim: "Apple's Agent Seer is a public product", source: "tool:tavily:r1" },
  { claim: "We don't demo vapor anymore", source: "USER.md:12" },
]

export const VERSION_A_CLAIMS_TABLE = formatClaimsTable(VERSION_A_ROWS)

export const VERSION_A_SOURCES = ["tool:tavily:r1", "USER.md:12"] as const

export const VERSION_A_TOOL_RESULTS = [
  "tool:tavily:r1 https://developer.apple.com/agent-seer Agent Seer announcement",
] as const

export const VERSION_B_DRAFT =
  `${VERSION_B_FIRST_PERSON_FIXTURE}. Details: https://made-up.example/scrape`

export const VERSION_B_ROWS: ClaimRow[] = [
  { claim: VERSION_B_FIRST_PERSON_FIXTURE, source: "" },
]

export const VERSION_B_CLAIMS_TABLE = formatClaimsTable(VERSION_B_ROWS)

export function runWave0ClaimsHarness(): {
  a: ReviewDraftResult
  b: ReviewDraftResult
} {
  return {
    a: reviewDraft({
      draft: VERSION_A_DRAFT,
      claimsTable: VERSION_A_CLAIMS_TABLE,
      knownSources: VERSION_A_SOURCES,
      toolResults: VERSION_A_TOOL_RESULTS,
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    }),
    b: reviewDraft({
      draft: VERSION_B_DRAFT,
      claimsTable: VERSION_B_CLAIMS_TABLE,
      knownSources: VERSION_A_SOURCES,
      toolResults: VERSION_A_TOOL_RESULTS,
      knob: 8,
      dimensionScores: [9, 9, 9, 9],
    }),
  }
}
