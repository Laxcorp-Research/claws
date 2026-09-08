/**
 * Quant critic net. Thesis and EOD both go through this function.
 *
 * MUTATION: treat a missing `| Claim | Source |` as PASS, or accept the
 * $100k decorative-equity fixture → critic-gate.test.ts fails.
 */

import {
  formatClaimsTable,
  parseClaimsTable,
  type ClaimRow,
  type CriticVerdict,
} from "@/lib/critic/claims-table"

export const REJECT_MISSING_TABLE = "REJECT-for-missing-table"
export const REJECT_UNSOURCED_FIGURE = "REJECT-for-unsourced-figure"
export const UNKNOWN_UNTIL_BROKER = "unknown"

export const QUANT_ALLOWED_SOURCE_RE =
  /^(tool:|toolResult:|tavily:|alpaca:|tool:alpaca:)\S+|^(shared\/)?(PORTFOLIO|WATCHLIST|THESES)\.md:\d+$/i

const MONEY_FIGURE_RE = /\$\s*[\d,]+(?:\.\d+)?(?:k|m)?/gi

/**
 * Live-fire #3 T-001 AFRM packet (hyphenated; no claims table). Critic
 * must REJECT-for-missing-table.
 */
export const AFRM_PACKET_FIXTURE = `# T-001 - AFRM Opening-Range Breakout Long

Date: 2026-09-06
Symbol: AFRM (Affirm Holdings)
Direction: LONG
Horizon: Intraday (one session)
Verdict: awaiting-human

## Catalyst

AFRM reported earnings with a beat on both revenue and EPS plus a forward guidance raise. The stock gapped +13.4% pre-market. A beat-and-raise is the strongest fundamental catalyst for continuation on gap-up names.

## Setup: Opening-Range Breakout (ORB) Long

Entry: Break above 15-min ORH at [YOUR NUMBER]
Stop: Below 15-min ORL at [YOUR NUMBER]
Data caveat: Web search and Tavily were both unavailable (missing API keys). Catalyst data sourced from task briefing only. Levels must be filled from live market data before execution.
Delivery mode: ALERT-ONLY. Drafted, awaiting human approval to paper-execute.
`

/**
 * Live-fire #3 EOD that sized the 3%/5% ladder against a synthetic $100k
 * book while Alpaca was disconnected. Critic must REJECT.
 */
export const DECORATIVE_EQUITY_FIXTURE = `# EOD Risk Report - Cursor Live-Fire #3

Date: Sep 6, 2026 (UTC)

## Portfolio Status

Equity: Unknown (Alpaca disconnected)
Day P&L: Unknown
Drawdown Rung: 0

## Risk Ladders

### Daily Loss (3% cap = $3,000 @ $100k ref)
- Current Day P&L: Unknown (equity unknown)
- Available budget: $3,000 (full, unused)

### Kill Switch (5% cap = $5,000)
- Current drawdown: Unknown

Flags: Alpaca disconnected. All calculations reference $100k synthetic. Do not execute trades until Alpaca connection confirmed.
`

export type ReviewQuantPacketInput = {
  text: string
  brokerConnected?: boolean
}

export type ReviewQuantPacketResult = {
  verdict: CriticVerdict
  reasons: string[]
  rows: ClaimRow[]
}

export function quantSourceLooksValid(source: string): boolean {
  const s = source.trim()
  if (!s) return false
  return QUANT_ALLOWED_SOURCE_RE.test(s)
}

export function extractMoneyFigures(text: string): string[] {
  const hits = text.match(MONEY_FIGURE_RE) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of hits) {
    const n = raw.replace(/\s+/g, "").toLowerCase()
    if (seen.has(n)) continue
    seen.add(n)
    out.push(raw.replace(/\s+/g, ""))
  }
  return out
}

export function hasQuantClaimsTable(text: string): boolean {
  return parseClaimsTable(text) !== null
}

export function renderQuantBook(args: {
  date: string
  brokerConnected: boolean
  equityUsd?: number
  dayPnlUsd?: number
  rung?: string
  rows?: string
}): string {
  const equity = args.brokerConnected && args.equityUsd != null
    ? `$${args.equityUsd}`
    : UNKNOWN_UNTIL_BROKER
  const dayPnl = args.brokerConnected && args.dayPnlUsd != null
    ? `$${args.dayPnlUsd}`
    : UNKNOWN_UNTIL_BROKER
  return `## ${args.date} book
Equity: ${equity}
Day P&L: ${dayPnl}
Rung: ${args.rung ?? "0"}
Rows:
${args.rows ?? "- none"}`
}

export function renderQuantEodReport(args: {
  date: string
  brokerConnected: boolean
  equityUsd?: number
  dayPnlUsd?: number
  rung?: string
  open?: string
  change?: string
}): string {
  const book = renderQuantBook({
    date: args.date,
    brokerConnected: args.brokerConnected,
    equityUsd: args.equityUsd,
    dayPnlUsd: args.dayPnlUsd,
    rung: args.rung,
    rows: args.open ?? "- none",
  })
  return `## ${args.date} EOD
${book.replace(`## ${args.date} book\n`, "")}
Open: ${args.open ?? "none"}
Change: ${args.change ?? "no change. No invented marks."}`
}

function figureCovered(figure: string, rows: ClaimRow[]): boolean {
  const needle = figure.toLowerCase()
  return rows.some((row) => {
    const claim = row.claim.toLowerCase()
    const source = row.source.toLowerCase()
    if (!quantSourceLooksValid(row.source)) return false
    return claim.includes(needle) || source.includes(needle)
  })
}

function decorativeEquityPresent(text: string): boolean {
  return /\$100k\b/i.test(text) || /\$100,000\b/.test(text) || /\b100k synthetic\b/i.test(text)
}

export function reviewQuantPacket(input: ReviewQuantPacketInput): ReviewQuantPacketResult {
  const reasons: string[] = []
  const parsed = parseClaimsTable(input.text)
  const rows = parsed ?? []

  if (parsed === null) {
    reasons.push(REJECT_MISSING_TABLE)
  }

  for (const row of rows) {
    if (!quantSourceLooksValid(row.source)) {
      reasons.push(`invalid Quant source (tool id or PORTFOLIO/WATCHLIST/THESES line): ${row.source}`)
    }
  }

  const figures = extractMoneyFigures(input.text)
  for (const figure of figures) {
    if (parsed === null || !figureCovered(figure, rows)) {
      reasons.push(`${REJECT_UNSOURCED_FIGURE}: ${figure}`)
    }
  }

  if (decorativeEquityPresent(input.text)) {
    reasons.push(`${REJECT_UNSOURCED_FIGURE}: $100k`)
  }

  if (input.brokerConnected === false) {
    const equityLine = input.text.match(/equity\s*:\s*([^\n]+)/i)?.[1] ?? ""
    const pnlLine = input.text.match(/day p&l\s*:\s*([^\n]+)/i)?.[1] ?? ""
    if (/\$\s*[\d,]/.test(equityLine) && !/unknown/i.test(equityLine)) {
      reasons.push(`${REJECT_UNSOURCED_FIGURE}: equity without broker`)
    }
    if (/\$\s*[\d,]/.test(pnlLine) && !/unknown/i.test(pnlLine)) {
      reasons.push(`${REJECT_UNSOURCED_FIGURE}: day P&L without broker`)
    }
  }

  return {
    verdict: reasons.length === 0 ? "PASS" : "REJECT",
    reasons,
    rows,
  }
}

export function formatQuantClaimsTable(rows: ClaimRow[]): string {
  return formatClaimsTable(rows)
}
