import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  DRAWDOWN_LADDER,
  INVENTED_BACKTEST_FIXTURE,
  QUANT_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-1-quant"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  QUANT_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "@/lib/critic/claims-table"
import { QUANT_LLM_CANNOT_OVERRIDE_COPY } from "@/lib/quant/risk-limits"
import {
  AFRM_PACKET_FIXTURE,
  DECORATIVE_EQUITY_FIXTURE,
  REJECT_MISSING_TABLE,
  REJECT_UNSOURCED_FIGURE,
  UNKNOWN_UNTIL_BROKER,
} from "@/lib/quant/critic-gate"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"
import { AUTONOMOUS_CAPABLE_TOOLS } from "@/lib/openclaw/delivery-rail"

function quant() {
  const t = ALL_TEMPLATES.find((x) => x.slug === "quant-trader")
  if (!t) throw new Error("quant-trader missing")
  return t
}

function agent(slug: string) {
  const a = quant().agents.find((x) => x.agentSlug === slug)
  if (!a) throw new Error(slug)
  return a
}

describe("WAVE-1 Quant Trader prose contracts", () => {
  it("Signal Analyst has thesis anatomy, GOOD vs BAD, sizing, and no-invented-backtests", () => {
    const soul = agent("signal-analyst").soulMd
    expect(soul).toContain("Thesis anatomy")
    expect(soul).toContain("GOOD vs BAD")
    expect(soul).toContain("WHY:")
    expect(soul).toContain("Sizing rules")
    expect(soul).toContain("No-invented-backtests law")
    expect(soul).toContain("no backtest: no series")
    expect(soul).toContain(INVENTED_BACKTEST_FIXTURE)
    expect(soul).toContain("[YOUR NUMBER]")
  })

  it("Risk Manager embeds the drawdown ladder and container caps", () => {
    const soul = agent("risk-manager").soulMd
    expect(soul).toContain(DRAWDOWN_LADDER)
    expect(DRAWDOWN_LADDER).toContain("1% daily")
    expect(DRAWDOWN_LADDER).toContain("3% daily")
    expect(DRAWDOWN_LADDER).toContain("5% daily")
    expect(soul).toContain(QUANT_LLM_CANNOT_OVERRIDE_COPY)
    expect(soul).toContain("QUANT_MAX_POSITION_PCT")
    expect(soul).toContain("QUANT_MAX_NOTIONAL_PCT")
    expect(soul).toContain("QUANT_MAX_RISK_PCT")
    expect(soul).toContain("evaluateQuantRiskManager")
    expect(soul).toContain("166 MU")
    expect(soul).toContain("Labor Day")
    expect(soul).toContain("PASS or REJECT only")
    expect(agent("risk-manager").agentsMd).not.toContain("PASS_WITH_ADJUSTMENT")
  })

  it("critic is a risk gate: thesis-quality / risk-adherence / evidence / regime-fit", () => {
    const soul = agent("trade-thesis-reviewer").soulMd
    for (const dim of QUANT_CRITIC_SCORE_DIMENSIONS) {
      expect(soul).toContain(dim)
    }
    expect(soul).toContain(CRITIC_DIMENSION_TABLE_HEADER)
    expect(soul).toContain("Never a bare mean")
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain("| Claim | Source |")
    expect(soul).toContain(INVENTED_BACKTEST_FIXTURE)
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).toContain(REJECT_MISSING_TABLE)
    expect(soul).toContain(REJECT_UNSOURCED_FIGURE)
    expect(soul).toContain(AFRM_PACKET_FIXTURE.split("\n")[0])
    expect(soul).toContain(DECORATIVE_EQUITY_FIXTURE.split("\n")[0])
    expect(soul).toContain("reviewQuantPacket")
    expect(soul).toMatch(/\bPASS\b/)
    expect(soul).toMatch(/\bREJECT\b/)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("Commander is ALERT-ONLY by default and runs the same-session mini-mission", () => {
    const soul = agent("trade-commander").soulMd
    expect(soul).toContain("ALERT-ONLY")
    expect(soul).toContain("risk-obsessed operator")
    expect(soul).toContain("mini first-mission")
    expect(soul).toContain(QUANT_LLM_CANNOT_OVERRIDE_COPY)
    expect(soul).toContain("drafted, awaiting your approval to paper-execute")
    expect(soul).toContain(CRITIC_DIMENSION_TABLE_HEADER)
    expect(soul).toContain("Never a bare mean")
    expect(soul).toContain(INVENTED_BACKTEST_FIXTURE)
    expect(agent("trade-commander").heartbeatMd).toContain("Never a /home/node/.openclaw/ path")
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    const files = quant().files ?? []
    for (const name of [
      "shared/PORTFOLIO.md",
      "shared/WATCHLIST.md",
      "shared/THESES.md",
      "shared/deliverables/pre-market-scan.md",
      "shared/deliverables/trade-thesis.md",
      "shared/deliverables/paper-ticket.md",
      "shared/deliverables/eod-risk-report.md",
    ]) {
      const file = files.find((f) => f.path === name)
      expect(file, name).toBeDefined()
      expect(file!.content.length).toBeLessThan(8000)
      expect(file!.content).toContain("## Schema")
      expect(file!.content).toContain("## Format")
      expect(file!.content).toContain("## Example")
      expect(file!.content).toContain("## Entries")
    }
  })

  it("four windows stay parseable with failure branches (MUTATION: drop DEGRADED → fail)", () => {
    const scripts = parseHeartbeatWindowScripts(agent("trade-commander").heartbeatMd)
    expect(scripts).toHaveLength(4)
    expect(scripts.map((s) => s.cron)).toEqual([
      "30 12 * * 1-5",
      "30 13 * * 1-5",
      "0 14 * * 1-5",
      "0 20 * * 1-5",
    ])
    for (const script of scripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(3)
      expect(script.deliverable).toContain("/home/node/.openclaw/")
    }
    const md = agent("trade-commander").heartbeatMd
    expect(md).toContain("DEGRADED")
    expect(md).toContain("evaluateQuantPaperOrder")
    expect(md).toContain("no thesis: no source")
    expect(md).toContain("ALERT-ONLY")
  })

  it("alpaca-trading SKILL.md is paper-first and forbids invented backtests", () => {
    const alpaca = ALL_SKILLS.find((s) => s.slug === "alpaca-trading")
    expect(alpaca?.skillMd).toContain("Quant paper-keys path")
    expect(alpaca?.skillMd).toContain("Live host api.alpaca.markets is undeclared and denied")
    expect(alpaca?.skillMd).toContain("http tool")
    expect(alpaca?.skillMd).not.toMatch(/\bcurl\b/)
    expect(alpaca?.skillMd).toContain("no backtest: no series")
    expect(alpaca?.skillMd).toContain("ALERT_ONLY")
  })

  it("post-interview mini-mission is one scan + one thesis in the same session", () => {
    const pack = getInterviewPack("quant-trader")!
    expect(pack.map((q) => q.id)).toEqual(
      expect.arrayContaining(["universe", "risk_floors", "delivery_mode", "accounts"]),
    )
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: "quant-trader",
    })
    expect(pending).toContain(QUANT_FIRST_MISSION_PROSE)
    expect(pending).toContain("one trade thesis")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8; factory philosophy stays gone; exec stays non-autonomous", () => {
    expect(agent("trade-thesis-reviewer").qualityThreshold).toBe(8)
    const commander = agent("trade-commander").soulMd
    expect(commander).not.toContain("The market is a complex adaptive system")
    expect(commander).not.toContain("Speed matters less than accuracy")
    expect(AUTONOMOUS_CAPABLE_TOOLS).toEqual([])
  })

  it("PORTFOLIO and EOD stay unknown until a broker is connected", () => {
    const files = quant().files ?? []
    const portfolio = files.find((f) => f.path === "shared/PORTFOLIO.md")
    const eod = files.find((f) => f.path === "shared/deliverables/eod-risk-report.md")
    expect(portfolio?.content).toContain(`Equity: ${UNKNOWN_UNTIL_BROKER}`)
    expect(portfolio?.content).toContain("unknown until a broker is connected")
    expect(portfolio?.content).not.toMatch(/\$100k/)
    expect(eod?.content).toContain(`Equity: ${UNKNOWN_UNTIL_BROKER}`)
    expect(eod?.content).toContain("unknown until a broker is connected")
    expect(agent("portfolio-tracker").soulMd).toContain(UNKNOWN_UNTIL_BROKER)
    expect(agent("portfolio-tracker").soulMd).toContain("reviewQuantPacket")
  })
})
