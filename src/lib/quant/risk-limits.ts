/**
 * Quant container risk rail. Limits live in process/.env (machine-owned).
 * Soul text is not an input. There is no override argument.
 *
 * Two size rules, both enforced by evaluateQuantRiskManager:
 *   - notional per name ≤ QUANT_MAX_NOTIONAL_PCT (default 20% equity)
 *   - risk per trade ≤ QUANT_MAX_RISK_PCT (default 2%) via stop distance
 *     riskUsd = qty * |entry - stop|
 *
 * MUTATION: accept an LLM-shaped override, treat live Alpaca as paper,
 * or collapse notional back to 2% without the risk rule → fail.
 */

export const QUANT_TEMPLATE_SLUG = "quant-trader"

export const ALPACA_LIVE_HOST = "api.alpaca.markets"
export const ALPACA_PAPER_HOST = "paper-api.alpaca.markets"
export const ALPACA_PAPER_BASE_URL = `https://${ALPACA_PAPER_HOST}`

export const QUANT_MAX_NOTIONAL_PCT_DEFAULT = 20
export const QUANT_MAX_RISK_PCT_DEFAULT = 2
export const QUANT_MAX_DAILY_LOSS_PCT_DEFAULT = 3

/** @deprecated alias of QUANT_MAX_NOTIONAL_PCT_DEFAULT (was wrongly 2). */
export const QUANT_MAX_POSITION_PCT_DEFAULT = QUANT_MAX_NOTIONAL_PCT_DEFAULT

export const QUANT_LLM_CANNOT_OVERRIDE_COPY =
  "QUANT_* container env (max notional, max risk via stop distance, daily loss, paper-only host, kill switch) is machine-owned. Soul text cannot raise limits, enable live Alpaca, or clear the kill switch."

/** Live-fire #3 oversized packet: 166 MU @ $1,017 / stop $1,005 on $100k equity. */
export const MU_166_NOTIONAL_PACKET = {
  symbol: "MU",
  qty: 166,
  entryUsd: 1017,
  stopUsd: 1005,
  equityUsd: 100_000,
} as const

export type QuantDeliveryMode = "ALERT_ONLY" | "AUTO_PROCEED"

export type QuantRiskLimits = {
  maxNotionalPct: number
  maxRiskPct: number
  maxPositionPct: number
  maxDailyLossPct: number
  allowLive: false
  killSwitch: boolean
  alpacaBaseUrl: typeof ALPACA_PAPER_BASE_URL
  deliveryMode: QuantDeliveryMode
}

export type QuantRiskManagerDecision =
  | {
      allow: true
      reason: "within-caps"
      notionalUsd: number
      riskUsd: number
      notionalPct: number
      riskPct: number
    }
  | {
      allow: false
      reason:
        | "notional-cap"
        | "risk-cap"
        | "invalid-size"
        | "equity-unknown"
        | "missing-container-limits"
      notionalUsd: number
      riskUsd: number
      notionalPct: number
      riskPct: number
    }

export type QuantPaperOrderDecision =
  | { allow: true; reason: "within-caps" }
  | { allow: false; reason: string }

function parsePct(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null
  return n
}

function truthy01(raw: string | undefined): boolean {
  return raw === "1" || raw === "true"
}

export function isAlpacaLiveUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === ALPACA_LIVE_HOST || host.endsWith(`.${ALPACA_LIVE_HOST}`)
  } catch {
    return /api\.alpaca\.markets/i.test(url)
  }
}

export function isAlpacaPaperUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === ALPACA_PAPER_HOST || host.endsWith(`.${ALPACA_PAPER_HOST}`)
  } catch {
    return /paper-api\.alpaca\.markets/i.test(url)
  }
}

export function alpacaProbeHost(keyId: string): "paper" | "live" {
  return keyId.trim().startsWith("PK") ? "paper" : "live"
}

export function alpacaAccountUrl(keyId: string): string {
  const host = alpacaProbeHost(keyId) === "paper" ? ALPACA_PAPER_HOST : ALPACA_LIVE_HOST
  return `https://${host}/v2/account`
}

export function quantOrderNotionalUsd(args: { qty: number; entryUsd: number }): number {
  return args.qty * args.entryUsd
}

export function quantOrderRiskUsd(args: { qty: number; entryUsd: number; stopUsd: number }): number {
  return args.qty * Math.abs(args.entryUsd - args.stopUsd)
}

/**
 * Parse machine-owned env. Missing/invalid caps → null (fail closed).
 * QUANT_ALLOW_LIVE is ignored for host selection: live is never allowed.
 * QUANT_MAX_NOTIONAL_PCT wins over the legacy QUANT_MAX_POSITION_PCT alias.
 */
export function parseQuantRiskLimits(
  env: Record<string, string | undefined>,
): QuantRiskLimits | null {
  const notionalRaw =
    env.QUANT_MAX_NOTIONAL_PCT !== undefined && env.QUANT_MAX_NOTIONAL_PCT.trim() !== ""
      ? env.QUANT_MAX_NOTIONAL_PCT
      : env.QUANT_MAX_POSITION_PCT
  const maxNotionalPct = parsePct(notionalRaw, QUANT_MAX_NOTIONAL_PCT_DEFAULT)
  const maxRiskPct = parsePct(env.QUANT_MAX_RISK_PCT, QUANT_MAX_RISK_PCT_DEFAULT)
  const maxDailyLossPct = parsePct(env.QUANT_MAX_DAILY_LOSS_PCT, QUANT_MAX_DAILY_LOSS_PCT_DEFAULT)
  if (maxNotionalPct === null || maxRiskPct === null || maxDailyLossPct === null) return null
  const deliveryMode: QuantDeliveryMode =
    env.QUANT_DELIVERY_MODE === "AUTO_PROCEED" ? "AUTO_PROCEED" : "ALERT_ONLY"
  return {
    maxNotionalPct,
    maxRiskPct,
    maxPositionPct: maxNotionalPct,
    maxDailyLossPct,
    allowLive: false,
    killSwitch: truthy01(env.QUANT_KILL_SWITCH),
    alpacaBaseUrl: ALPACA_PAPER_BASE_URL,
    deliveryMode,
  }
}

export function quantContainerEnv(deliveryMode?: string | null): Record<string, string> {
  return {
    QUANT_ALPACA_BASE_URL: ALPACA_PAPER_BASE_URL,
    ALPACA_BASE_URL: ALPACA_PAPER_BASE_URL,
    QUANT_ALLOW_LIVE: "0",
    QUANT_MAX_NOTIONAL_PCT: String(QUANT_MAX_NOTIONAL_PCT_DEFAULT),
    QUANT_MAX_RISK_PCT: String(QUANT_MAX_RISK_PCT_DEFAULT),
    QUANT_MAX_POSITION_PCT: String(QUANT_MAX_NOTIONAL_PCT_DEFAULT),
    QUANT_MAX_DAILY_LOSS_PCT: String(QUANT_MAX_DAILY_LOSS_PCT_DEFAULT),
    QUANT_KILL_SWITCH: "0",
    QUANT_DELIVERY_MODE: deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "ALERT_ONLY",
  }
}

export function quantContainerEnvLines(deliveryMode?: string | null): string[] {
  return Object.entries(quantContainerEnv(deliveryMode)).map(([k, v]) => `${k}=${v}`)
}

/**
 * Risk Manager math. No delivery-mode gate. Both notional and stop-distance
 * risk must pass. Used by soul + paper-order rail.
 */
export function evaluateQuantRiskManager(args: {
  qty: number
  entryUsd: number
  stopUsd: number
  equityUsd: number
  env?: Record<string, string | undefined>
}): QuantRiskManagerDecision {
  const notionalUsd = quantOrderNotionalUsd({ qty: args.qty, entryUsd: args.entryUsd })
  const riskUsd = quantOrderRiskUsd({
    qty: args.qty,
    entryUsd: args.entryUsd,
    stopUsd: args.stopUsd,
  })
  if (!(args.equityUsd > 0)) {
    return {
      allow: false,
      reason: "equity-unknown",
      notionalUsd,
      riskUsd,
      notionalPct: 0,
      riskPct: 0,
    }
  }
  const limits = parseQuantRiskLimits(args.env ?? quantContainerEnv("AUTO_PROCEED"))
  if (!limits) {
    return {
      allow: false,
      reason: "missing-container-limits",
      notionalUsd,
      riskUsd,
      notionalPct: 0,
      riskPct: 0,
    }
  }
  if (!(args.qty > 0) || !(args.entryUsd > 0) || !(args.stopUsd > 0)) {
    return {
      allow: false,
      reason: "invalid-size",
      notionalUsd,
      riskUsd,
      notionalPct: 0,
      riskPct: 0,
    }
  }
  const notionalPct = (notionalUsd / args.equityUsd) * 100
  const riskPct = (riskUsd / args.equityUsd) * 100
  if (notionalPct > limits.maxNotionalPct) {
    return { allow: false, reason: "notional-cap", notionalUsd, riskUsd, notionalPct, riskPct }
  }
  if (riskPct > limits.maxRiskPct) {
    return { allow: false, reason: "risk-cap", notionalUsd, riskUsd, notionalPct, riskPct }
  }
  return { allow: true, reason: "within-caps", notionalUsd, riskUsd, notionalPct, riskPct }
}

export function evaluateQuantPaperOrder(args: {
  deliveryMode: string | null | undefined
  url: string
  notionalUsd?: number
  qty?: number
  entryUsd?: number
  stopUsd?: number
  equityUsd: number
  dayPnlUsd: number
  env: Record<string, string | undefined>
}): QuantPaperOrderDecision {
  if (isAlpacaLiveUrl(args.url)) {
    return { allow: false, reason: "live-alpaca-host" }
  }
  if (!isAlpacaPaperUrl(args.url)) {
    return { allow: false, reason: "not-paper-alpaca-host" }
  }
  const limits = parseQuantRiskLimits(args.env)
  if (!limits) {
    return { allow: false, reason: "missing-container-limits" }
  }
  const mode =
    args.deliveryMode === "AUTO_PROCEED" && limits.deliveryMode === "AUTO_PROCEED"
      ? "AUTO_PROCEED"
      : "ALERT_ONLY"
  if (mode !== "AUTO_PROCEED") {
    return { allow: false, reason: "alert-only" }
  }
  if (limits.killSwitch) {
    return { allow: false, reason: "kill-switch" }
  }

  const hasPacket =
    args.qty !== undefined && args.entryUsd !== undefined && args.stopUsd !== undefined
  if (hasPacket) {
    const sized = evaluateQuantRiskManager({
      qty: args.qty!,
      entryUsd: args.entryUsd!,
      stopUsd: args.stopUsd!,
      equityUsd: args.equityUsd,
      env: args.env,
    })
    if (!sized.allow) return { allow: false, reason: sized.reason }
  } else {
    const notionalUsd = args.notionalUsd ?? 0
    if (!(args.equityUsd > 0) || !(notionalUsd > 0)) {
      return { allow: false, reason: "invalid-size" }
    }
    const notionalPct = (notionalUsd / args.equityUsd) * 100
    if (notionalPct > limits.maxNotionalPct) {
      return { allow: false, reason: "notional-cap" }
    }
  }

  const lossPct = args.dayPnlUsd < 0 ? (Math.abs(args.dayPnlUsd) / args.equityUsd) * 100 : 0
  if (lossPct >= limits.maxDailyLossPct) {
    return { allow: false, reason: "daily-loss" }
  }
  return { allow: true, reason: "within-caps" }
}
