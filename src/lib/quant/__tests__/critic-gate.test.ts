import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AFRM_PACKET_FIXTURE,
  DECORATIVE_EQUITY_FIXTURE,
  REJECT_MISSING_TABLE,
  REJECT_UNSOURCED_FIGURE,
  UNKNOWN_UNTIL_BROKER,
  extractMoneyFigures,
  hasQuantClaimsTable,
  quantSourceLooksValid,
  renderQuantBook,
  renderQuantEodReport,
  reviewQuantPacket,
} from "@/lib/quant/critic-gate"

const SOURCED_THESIS = `NVDA long, alpaca-paper. After-hours print +1.8% (tool:tavily:r3). Size 1.5% of equity $50000.

| Claim | Source |
| After-hours print +1.8% | tool:tavily:r3 |
| Equity $50000 | tool:alpaca:account |
| Size 1.5% | shared/PORTFOLIO.md:8 |
`

const SOURCED_EOD = `## 2026-09-06 EOD
Equity: $50000
Day P&L: $0
Rung: 0
Open: none

| Claim | Source |
| Equity $50000 | tool:alpaca:account |
| Day P&L $0 | tool:alpaca:account |
`

describe("Quant critic gate", () => {
  it("AFRM packet → REJECT-for-missing-table (MUTATION: missing table as PASS → fail)", () => {
    expect(hasQuantClaimsTable(AFRM_PACKET_FIXTURE)).toBe(false)
    expect(AFRM_PACKET_FIXTURE).toContain("AFRM")
    expect(AFRM_PACKET_FIXTURE).toContain("task briefing")
    expect(AFRM_PACKET_FIXTURE).not.toMatch(/\|\s*Claim\s*\|\s*Source\s*\|/)

    const result = reviewQuantPacket({ text: AFRM_PACKET_FIXTURE, brokerConnected: false })
    expect(result.verdict).toBe("REJECT")
    expect(result.reasons).toContain(REJECT_MISSING_TABLE)
  })

  it("$100k fixture → REJECT-for-unsourced-figure (MUTATION: ignore $ figures → fail)", () => {
    expect(extractMoneyFigures(DECORATIVE_EQUITY_FIXTURE)).toEqual(
      expect.arrayContaining(["$3,000", "$100k", "$5,000"]),
    )
    const result = reviewQuantPacket({
      text: DECORATIVE_EQUITY_FIXTURE,
      brokerConnected: false,
    })
    expect(result.verdict).toBe("REJECT")
    expect(result.reasons.some((r) => r.includes(REJECT_UNSOURCED_FIGURE))).toBe(true)
    expect(result.reasons.some((r) => r.includes("$100k"))).toBe(true)
  })

  it("EOD with a claims table still REJECTS decorative $100k", () => {
    const withTable = `${DECORATIVE_EQUITY_FIXTURE}

| Claim | Source |
| Day P&L unknown | shared/PORTFOLIO.md:4 |
`
    const result = reviewQuantPacket({ text: withTable, brokerConnected: false })
    expect(result.verdict).toBe("REJECT")
    expect(result.reasons.some((r) => r.includes(REJECT_UNSOURCED_FIGURE))).toBe(true)
  })

  it("sourced thesis and EOD PASS; report goes through the same net", () => {
    const thesis = reviewQuantPacket({ text: SOURCED_THESIS, brokerConnected: true })
    expect(thesis.verdict).toBe("PASS")
    const eod = reviewQuantPacket({ text: SOURCED_EOD, brokerConnected: true })
    expect(eod.verdict).toBe("PASS")
  })

  it("rejects a claims-table source that is not a tool id or PORTFOLIO/WATCHLIST/THESES line", () => {
    const packet = `AFRM long.

| Claim | Source |
| Earnings beat | https://example.com/afrm |
`
    const result = reviewQuantPacket({ text: packet })
    expect(result.verdict).toBe("REJECT")
    expect(result.reasons.some((r) => r.includes("invalid Quant source"))).toBe(true)
  })

  it("accepts tool ids and PORTFOLIO/WATCHLIST/THESES lines only", () => {
    expect(quantSourceLooksValid("tool:tavily:r3")).toBe(true)
    expect(quantSourceLooksValid("tool:alpaca:account")).toBe(true)
    expect(quantSourceLooksValid("shared/PORTFOLIO.md:8")).toBe(true)
    expect(quantSourceLooksValid("WATCHLIST.md:2")).toBe(true)
    expect(quantSourceLooksValid("THESES.md:1")).toBe(true)
    expect(quantSourceLooksValid("USER.md:4")).toBe(false)
    expect(quantSourceLooksValid("QUANT_MAX_POSITION_PCT")).toBe(false)
  })

  it("PORTFOLIO + EOD render unknown until a broker is connected", () => {
    const book = renderQuantBook({
      date: "2026-09-06",
      brokerConnected: false,
      equityUsd: 100_000,
      dayPnlUsd: 0,
    })
    expect(book).toContain(`Equity: ${UNKNOWN_UNTIL_BROKER}`)
    expect(book).toContain(`Day P&L: ${UNKNOWN_UNTIL_BROKER}`)
    expect(book).not.toContain("$100000")
    expect(book).not.toContain("$100,000")

    const eod = renderQuantEodReport({
      date: "2026-09-06",
      brokerConnected: false,
      equityUsd: 100_000,
    })
    expect(eod).toContain(`Equity: ${UNKNOWN_UNTIL_BROKER}`)
    expect(eod).not.toMatch(/Equity: \$/)

    const live = renderQuantBook({
      date: "2026-09-06",
      brokerConnected: true,
      equityUsd: 50_000,
      dayPnlUsd: 12,
    })
    expect(live).toContain("Equity: $50000")
    expect(live).toContain("Day P&L: $12")
  })
})

describe("Quant critic-gate mutations", () => {
  it("MUTATION: overlay critic still cites AFRM + $100k fixtures (drop → fail)", () => {
    const overlay = readFileSync(
      resolve(__dirname, "../../../../prisma/seed-data/wave-1-quant.ts"),
      "utf8",
    )
    expect(overlay).toContain("AFRM_PACKET_FIXTURE")
    expect(overlay).toContain("DECORATIVE_EQUITY_FIXTURE")
    expect(overlay).toContain("REJECT_MISSING_TABLE")
    expect(overlay).toContain("REJECT_UNSOURCED_FIGURE")
    expect(overlay).toContain("reviewQuantPacket")
  })
})
