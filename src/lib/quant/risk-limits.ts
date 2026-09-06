/**
 * Quant container risk rail. Limits live in process/.env (machine-owned).
 * Soul text is not an input. There is no override argument.
 *
 * MUTATION: accept an LLM-shaped override, or treat live Alpaca as paper → fail.
 */

export const QUANT_TEMPLATE_SLUG = "quant-trader"

export const ALPACA_LIVE_HOST = "api.alpaca.markets"
export const ALPACA_PAPER_HOST = "paper-api.alpaca.markets"
export const ALPACA_PAPER_BASE_URL = `https://${ALPACA_PAPER_HOST}`

export const QUANT_MAX_POSITION_PCT_DEFAULT = 2
export const QUANT_MAX_DAILY_LOSS_PCT_DEFAULT = 3

export const QUANT_LLM_CANNOT_OVERRIDE_COPY =
  "QUANT_* container env (max position, daily loss, paper-only host, kill switch) is machine-owned. Soul text cannot raise limits, enable live Alpaca, or clear the kill switch."

export type QuantDeliveryMode = "ALERT_ONLY" | "AUTO_PROCEED"

export type QuantRiskLimits = {
  maxPositionPct: number
  maxDailyLossPct: number
  allowLive: false
  killSwitch: boolean
  alpacaBaseUrl: typeof ALPACA_PAPER_BASE_URL
  deliveryMode: QuantDeliveryMode
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

/**
 * Parse machine-owned env. Missing/invalid caps → null (fail closed).
 * QUANT_ALLOW_LIVE is ignored for host selection: live is never allowed.
 */
export function parseQuantRiskLimits(
  env: Record<string, string | undefined>,
): QuantRiskLimits | null {
  const maxPositionPct = parsePct(env.QUANT_MAX_POSITION_PCT, QUANT_MAX_POSITION_PCT_DEFAULT)
  const maxDailyLossPct = parsePct(env.QUANT_MAX_DAILY_LOSS_PCT, QUANT_MAX_DAILY_LOSS_PCT_DEFAULT)
  if (maxPositionPct === null || maxDailyLossPct === null) return null
  const deliveryMode: QuantDeliveryMode =
    env.QUANT_DELIVERY_MODE === "AUTO_PROCEED" ? "AUTO_PROCEED" : "ALERT_ONLY"
  return {
    maxPositionPct,
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
    QUANT_MAX_POSITION_PCT: String(QUANT_MAX_POSITION_PCT_DEFAULT),
    QUANT_MAX_DAILY_LOSS_PCT: String(QUANT_MAX_DAILY_LOSS_PCT_DEFAULT),
    QUANT_KILL_SWITCH: "0",
    QUANT_DELIVERY_MODE: deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "ALERT_ONLY",
  }
}

export function quantContainerEnvLines(deliveryMode?: string | null): string[] {
  return Object.entries(quantContainerEnv(deliveryMode)).map(([k, v]) => `${k}=${v}`)
}

export function evaluateQuantPaperOrder(args: {
  deliveryMode: string | null | undefined
  url: string
  notionalUsd: number
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
  if (!(args.equityUsd > 0) || !(args.notionalUsd > 0)) {
    return { allow: false, reason: "invalid-size" }
  }
  const positionPct = (args.notionalUsd / args.equityUsd) * 100
  if (positionPct > limits.maxPositionPct) {
    return { allow: false, reason: "position-cap" }
  }
  const lossPct = args.dayPnlUsd < 0 ? (Math.abs(args.dayPnlUsd) / args.equityUsd) * 100 : 0
  if (lossPct >= limits.maxDailyLossPct) {
    return { allow: false, reason: "daily-loss" }
  }
  return { allow: true, reason: "within-caps" }
}
