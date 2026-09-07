import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALPACA_PAPER_BASE_URL,
  MU_166_NOTIONAL_PACKET,
  QUANT_MAX_NOTIONAL_PCT_DEFAULT,
  QUANT_MAX_RISK_PCT_DEFAULT,
  alpacaAccountUrl,
  evaluateQuantPaperOrder,
  evaluateQuantRiskManager,
  isAlpacaLiveUrl,
  parseQuantRiskLimits,
  quantContainerEnv,
  quantOrderNotionalUsd,
  quantOrderRiskUsd,
} from "@/lib/quant/risk-limits"
import { evaluateQuantPaperOrder as railEvaluate } from "@/lib/openclaw/delivery-rail"

const paperOrder = `${ALPACA_PAPER_BASE_URL}/v2/orders`
const liveOrder = "https://api.alpaca.markets/v2/orders"

const env = quantContainerEnv("AUTO_PROCEED")

describe("quant risk rail", () => {
  it("parses container caps and never sets allowLive", () => {
    const limits = parseQuantRiskLimits({ ...env, QUANT_ALLOW_LIVE: "1" })
    expect(limits?.allowLive).toBe(false)
    expect(limits?.maxNotionalPct).toBe(QUANT_MAX_NOTIONAL_PCT_DEFAULT)
    expect(limits?.maxRiskPct).toBe(QUANT_MAX_RISK_PCT_DEFAULT)
    expect(limits?.maxNotionalPct).toBe(20)
    expect(limits?.maxRiskPct).toBe(2)
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

  it("166-share MU packet REJECTS for notional (risk is under 2%)", () => {
    const notional = quantOrderNotionalUsd(MU_166_NOTIONAL_PACKET)
    const risk = quantOrderRiskUsd(MU_166_NOTIONAL_PACKET)
    expect(notional).toBe(166 * 1017)
    expect(risk).toBe(166 * 12)
    expect(notional / MU_166_NOTIONAL_PACKET.equityUsd).toBeGreaterThan(1)
    expect(risk / MU_166_NOTIONAL_PACKET.equityUsd).toBeLessThanOrEqual(0.02)

    const sized = evaluateQuantRiskManager({ ...MU_166_NOTIONAL_PACKET, env })
    expect(sized.allow).toBe(false)
    expect(sized.reason).toBe("notional-cap")

    const decision = evaluateQuantPaperOrder({
      deliveryMode: "AUTO_PROCEED",
      url: paperOrder,
      ...MU_166_NOTIONAL_PACKET,
      dayPnlUsd: 0,
      env,
    })
    expect(decision).toEqual({ allow: false, reason: "notional-cap" })
  })

  it("MUTATION: 10% notional with a tight stop is within-caps (old 2% position cap would deny)", () => {
    const sized = evaluateQuantRiskManager({
      qty: 10,
      entryUsd: 100,
      stopUsd: 99,
      equityUsd: 10_000,
      env,
    })
    expect(sized).toMatchObject({
      allow: true,
      reason: "within-caps",
      notionalUsd: 1_000,
      riskUsd: 10,
    })
    expect(sized.notionalPct).toBe(10)
    expect(sized.riskPct).toBe(0.1)
    expect(
      evaluateQuantPaperOrder({
        deliveryMode: "AUTO_PROCEED",
        url: paperOrder,
        notionalUsd: 300,
        equityUsd: 10_000,
        dayPnlUsd: 0,
        env,
      }),
    ).toEqual({ allow: true, reason: "within-caps" })
  })

  it("denies when stop-distance risk is above 2% even if notional is under 20%", () => {
    const sized = evaluateQuantRiskManager({
      qty: 10,
      entryUsd: 100,
      stopUsd: 70,
      equityUsd: 10_000,
      env,
    })
    expect(sized.allow).toBe(false)
    expect(sized.reason).toBe("risk-cap")
    expect(sized.notionalPct).toBe(10)
    expect(sized.riskPct).toBe(3)
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
        env: { ...env, QUANT_MAX_NOTIONAL_PCT: "not-a-number" },
      }).reason,
    ).toBe("missing-container-limits")
  })

  it("allows a 1-share MU ticket inside both caps", () => {
    const sized = evaluateQuantRiskManager({
      qty: 1,
      entryUsd: 1010,
      stopUsd: 990,
      equityUsd: 100_000,
      env,
    })
    expect(sized.allow).toBe(true)
    expect(sized.notionalUsd).toBe(1010)
    expect(sized.riskUsd).toBe(20)
  })

  it("delivery rail re-export is the same function (LLM prose is not an input)", () => {
    expect(railEvaluate).toBe(evaluateQuantPaperOrder)
    const src = readFileSync(join(process.cwd(), "src/lib/quant/risk-limits.ts"), "utf8")
    expect(src).not.toMatch(/override\?:/)
    expect(src).not.toMatch(/soulText/)
    expect(src).not.toMatch(/args\.override/)
    expect(src).toContain("evaluateQuantRiskManager")
    expect(src).toContain("QUANT_MAX_NOTIONAL_PCT_DEFAULT = 20")
    expect(src).toContain("QUANT_MAX_RISK_PCT_DEFAULT = 2")
    expect(src).not.toMatch(/QUANT_MAX_NOTIONAL_PCT_DEFAULT = 2\b/)
  })

  it("PK keys probe paper; others probe live", () => {
    expect(alpacaAccountUrl("PKTEST")).toContain("paper-api.alpaca.markets")
    expect(alpacaAccountUrl("AKLIVE")).toContain("://api.alpaca.markets")
  })

  it("MUTATION: generateEnvFile bakes QUANT_* for quant-trader", () => {
    const generator = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(generator).toContain("quantContainerEnvLines")
    expect(generator).toMatch(/clawTemplate\?\.slug === QUANT_TEMPLATE_SLUG/)
    expect(env.QUANT_MAX_NOTIONAL_PCT).toBe("20")
    expect(env.QUANT_MAX_RISK_PCT).toBe("2")
  })
})
