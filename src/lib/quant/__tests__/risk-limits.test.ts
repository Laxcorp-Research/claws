import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALPACA_PAPER_BASE_URL,
  alpacaAccountUrl,
  evaluateQuantPaperOrder,
  isAlpacaLiveUrl,
  parseQuantRiskLimits,
  quantContainerEnv,
} from "@/lib/quant/risk-limits"
import { evaluateQuantPaperOrder as railEvaluate } from "@/lib/openclaw/delivery-rail"

const paperOrder = `${ALPACA_PAPER_BASE_URL}/v2/orders`
const liveOrder = "https://api.alpaca.markets/v2/orders"

const env = quantContainerEnv("AUTO_PROCEED")

describe("quant risk rail", () => {
  it("parses container caps and never sets allowLive", () => {
    const limits = parseQuantRiskLimits({ ...env, QUANT_ALLOW_LIVE: "1" })
    expect(limits?.allowLive).toBe(false)
    expect(limits?.maxPositionPct).toBe(2)
    expect(limits?.alpacaBaseUrl).toBe(ALPACA_PAPER_BASE_URL)
  })

  it("denies live Alpaca even when AUTO_PROCEED and QUANT_ALLOW_LIVE=1", () => {
    const decision = evaluateQuantPaperOrder({
      deliveryMode: "AUTO_PROCEED",
      url: liveOrder,
      notionalUsd: 100,
      equityUsd: 10_000,
      dayPnlUsd: 0,
      env: { ...env, QUANT_ALLOW_LIVE: "1" },
    })
    expect(decision).toEqual({ allow: false, reason: "live-alpaca-host" })
    expect(isAlpacaLiveUrl(liveOrder)).toBe(true)
  })

  it("denies paper execute in ALERT-ONLY (workspace or env)", () => {
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "APPROVAL_REQUIRED",
        url: paperOrder,
        notionalUsd: 100,
        equityUsd: 10_000,
        dayPnlUsd: 0,
        env,
      }).reason,
    ).toBe("alert-only")
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "AUTO_PROCEED",
        url: paperOrder,
        notionalUsd: 100,
        equityUsd: 10_000,
        dayPnlUsd: 0,
        env: quantContainerEnv("APPROVAL_REQUIRED"),
      }).reason,
    ).toBe("alert-only")
  })

  it("denies size above the 2% container cap", () => {
    const decision = evaluateQuantPaperOrder({
      deliveryMode: "AUTO_PROCEED",
      url: paperOrder,
      notionalUsd: 300,
      equityUsd: 10_000,
      dayPnlUsd: 0,
      env,
    })
    expect(decision).toEqual({ allow: false, reason: "position-cap" })
  })

  it("denies when daily loss already at the 3% rung", () => {
    const decision = evaluateQuantPaperOrder({
      deliveryMode: "AUTO_PROCEED",
      url: paperOrder,
      notionalUsd: 100,
      equityUsd: 10_000,
      dayPnlUsd: -300,
      env,
    })
    expect(decision).toEqual({ allow: false, reason: "daily-loss" })
  })

  it("denies kill switch and missing caps", () => {
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "AUTO_PROCEED",
        url: paperOrder,
        notionalUsd: 100,
        equityUsd: 10_000,
        dayPnlUsd: 0,
        env: { ...env, QUANT_KILL_SWITCH: "1" },
      }).reason,
    ).toBe("kill-switch")
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "AUTO_PROCEED",
        url: paperOrder,
        notionalUsd: 100,
        equityUsd: 10_000,
        dayPnlUsd: 0,
        env: { ...env, QUANT_MAX_POSITION_PCT: "not-a-number" },
      }).reason,
    ).toBe("missing-container-limits")
  })

  it("allows a paper order inside caps when both knobs are AUTO_PROCEED", () => {
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "AUTO_PROCEED",
        url: paperOrder,
        notionalUsd: 150,
        equityUsd: 10_000,
        dayPnlUsd: -50,
        env,
      }),
    ).toEqual({ allow: true, reason: "within-caps" })
  })

  it("delivery rail re-export is the same function (LLM prose is not an input)", () => {
    expect(railEvaluate).toBe(evaluateQuantPaperOrder)
    const src = readFileSync(join(process.cwd(), "src/lib/quant/risk-limits.ts"), "utf8")
    expect(src).not.toMatch(/override\?:/)
    expect(src).not.toMatch(/soulText/)
    expect(src).not.toMatch(/args\.override/)
  })

  it("PK keys probe paper; others probe live", () => {
    expect(alpacaAccountUrl("PKTEST")).toContain("paper-api.alpaca.markets")
    expect(alpacaAccountUrl("AKLIVE")).toContain("://api.alpaca.markets")
  })

  it("MUTATION: generateEnvFile bakes QUANT_* for quant-trader", () => {
    const generator = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(generator).toContain("quantContainerEnvLines")
    expect(generator).toMatch(/clawTemplate\?\.slug === QUANT_TEMPLATE_SLUG/)
  })
})
