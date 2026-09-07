/**
 * HTTP-gate Quant rail. Trading ACTIONs are sized by evaluateQuantRiskManager
 * before a HUMAN_REQUEST card exists.
 *
 * MUTATION: drop the call from gateHttpCall → http-action route test fails.
 */
import {
  ALPACA_LIVE_HOST,
  evaluateQuantRiskManager,
  isAlpacaLiveUrl,
  quantContainerEnv,
  type QuantRiskManagerDecision,
} from "@/lib/quant/risk-limits"

export const TRADING_ORDER_SKILLS = [
  "alpaca-trading",
  "binance-trading",
  "coinbase-trading",
  "polymarket-trading",
] as const

export type TradingOrderSkill = (typeof TRADING_ORDER_SKILLS)[number]

export type TradingOrderPacket = {
  qty: number
  entryUsd: number
  stopUsd: number
}

const ORDER_PATHS: Readonly<Record<TradingOrderSkill, string>> = {
  "alpaca-trading": "/v2/orders",
  "binance-trading": "/api/v3/order",
  "coinbase-trading": "/v3/brokerage/orders",
  "polymarket-trading": "/order",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

export function isTradingOrderSkill(skill: string): skill is TradingOrderSkill {
  return (TRADING_ORDER_SKILLS as readonly string[]).includes(skill)
}

export function isTradingOrderAction(args: {
  skill: string
  method: string
  path: string
}): boolean {
  if (!isTradingOrderSkill(args.skill)) return false
  if (args.method.trim().toUpperCase() !== "POST") return false
  const declared = ORDER_PATHS[args.skill]
  const path = args.path.startsWith("/") ? args.path : `/${args.path}`
  return path === declared || path.startsWith(`${declared}/`)
}

export function isLiveAlpacaTradingHost(hostOrUrl: string): boolean {
  const raw = hostOrUrl.trim()
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return isAlpacaLiveUrl(raw)
  }
  const host = raw.toLowerCase().replace(/:\d+$/, "")
  return host === ALPACA_LIVE_HOST || host.endsWith(`.${ALPACA_LIVE_HOST}`)
}

function nestedStop(body: Record<string, unknown>): unknown {
  const stopLoss = body.stop_loss
  if (isRecord(stopLoss)) return stopLoss.stop_price ?? stopLoss.stopPrice
  const orderConfig = body.order_configuration
  if (isRecord(orderConfig)) {
    for (const value of Object.values(orderConfig)) {
      if (isRecord(value) && (value.stop_price != null || value.stopPrice != null)) {
        return value.stop_price ?? value.stopPrice
      }
    }
  }
  return undefined
}

function nestedLimit(body: Record<string, unknown>): unknown {
  const orderConfig = body.order_configuration
  if (isRecord(orderConfig)) {
    for (const value of Object.values(orderConfig)) {
      if (isRecord(value) && (value.limit_price != null || value.limitPrice != null)) {
        return value.limit_price ?? value.limitPrice
      }
    }
  }
  return undefined
}

function nestedQty(body: Record<string, unknown>): unknown {
  const orderConfig = body.order_configuration
  if (isRecord(orderConfig)) {
    for (const value of Object.values(orderConfig)) {
      if (isRecord(value) && (value.base_size != null || value.size != null)) {
        return value.base_size ?? value.size
      }
    }
  }
  return undefined
}

export function parseTradingOrderPacket(body: unknown): TradingOrderPacket | null {
  if (!isRecord(body)) return null
  const qty = asPositiveNumber(body.qty ?? body.quantity ?? body.size ?? nestedQty(body))
  const entryUsd = asPositiveNumber(
    body.limit_price ?? body.limitPrice ?? body.price ?? nestedLimit(body),
  )
  const stopUsd = asPositiveNumber(body.stop_price ?? body.stopPrice ?? nestedStop(body))
  if (qty == null || entryUsd == null || stopUsd == null) return null
  return { qty, entryUsd, stopUsd }
}

export const QUANT_EQUITY_USD_DEFAULT = 100_000

export function resolveGateEquityUsd(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.QUANT_EQUITY_USD
  if (raw === undefined || raw.trim() === "") return QUANT_EQUITY_USD_DEFAULT
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function evaluateTradingActionRisk(args: {
  skill: string
  method: string
  host: string
  path: string
  url?: string
  body?: unknown
  env?: Record<string, string | undefined>
}):
  | { apply: false }
  | { apply: true; decision: QuantRiskManagerDecision }
  | { apply: true; decision: { allow: false; reason: "invalid-size" | "equity-unknown" | "live-alpaca-host" } } {
  if (isLiveAlpacaTradingHost(args.url ?? args.host)) {
    return { apply: true, decision: { allow: false, reason: "live-alpaca-host" } }
  }
  if (!isTradingOrderAction({ skill: args.skill, method: args.method, path: args.path })) {
    return { apply: false }
  }
  const packet = parseTradingOrderPacket(args.body)
  if (!packet) {
    return { apply: true, decision: { allow: false, reason: "invalid-size" } }
  }
  const equityUsd = resolveGateEquityUsd(args.env)
  if (equityUsd == null) {
    return { apply: true, decision: { allow: false, reason: "equity-unknown" } }
  }
  return {
    apply: true,
    decision: evaluateQuantRiskManager({
      ...packet,
      equityUsd,
      env: args.env ?? quantContainerEnv("AUTO_PROCEED"),
    }),
  }
}
