import { describe, expect, it } from "vitest"
import { MU_166_NOTIONAL_PACKET, quantContainerEnv } from "@/lib/quant/risk-limits"
import {
  evaluateTradingActionRisk,
  isTradingOrderAction,
  parseTradingOrderPacket,
} from "@/lib/quant/trading-action-gate"

const env = { ...quantContainerEnv("AUTO_PROCEED"), QUANT_EQUITY_USD: "100000" }

describe("trading action Quant rail", () => {
  it("treats alpaca/binance/coinbase/polymarket POST order paths as trading ACTIONs", () => {
    expect(
      isTradingOrderAction({ skill: "alpaca-trading", method: "POST", path: "/v2/orders" }),
    ).toBe(true)
    expect(
      isTradingOrderAction({ skill: "binance-trading", method: "POST", path: "/api/v3/order" }),
    ).toBe(true)
    expect(
      isTradingOrderAction({
        skill: "coinbase-trading",
        method: "POST",
        path: "/v3/brokerage/orders",
      }),
    ).toBe(true)
    expect(
      isTradingOrderAction({ skill: "polymarket-trading", method: "POST", path: "/order" }),
    ).toBe(true)
    expect(
      isTradingOrderAction({ skill: "alpaca-trading", method: "GET", path: "/v2/account" }),
    ).toBe(false)
    expect(
      isTradingOrderAction({ skill: "tavily-search", method: "POST", path: "/search" }),
    ).toBe(false)
  })

  it("parses Alpaca OTO stop_loss and the 166 fixture", () => {
    expect(
      parseTradingOrderPacket({
        qty: "1",
        limit_price: "1010",
        stop_loss: { stop_price: "990" },
      }),
    ).toEqual({ qty: 1, entryUsd: 1010, stopUsd: 990 })
    expect(
      parseTradingOrderPacket({
        qty: MU_166_NOTIONAL_PACKET.qty,
        limit_price: MU_166_NOTIONAL_PACKET.entryUsd,
        stop_price: MU_166_NOTIONAL_PACKET.stopUsd,
      }),
    ).toEqual({
      qty: MU_166_NOTIONAL_PACKET.qty,
      entryUsd: MU_166_NOTIONAL_PACKET.entryUsd,
      stopUsd: MU_166_NOTIONAL_PACKET.stopUsd,
    })
  })

  it("166 packet is notional-cap; 1 MU is within-caps; live host is denied", () => {
    const oversized = evaluateTradingActionRisk({
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: {
        qty: "166",
        limit_price: "1017",
        stop_price: "1005",
      },
      env,
    })
    expect(oversized).toMatchObject({
      apply: true,
      decision: { allow: false, reason: "notional-cap" },
    })

    const sized = evaluateTradingActionRisk({
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: { qty: "1", limit_price: "1010", stop_loss: { stop_price: "990" } },
      env,
    })
    expect(sized).toMatchObject({
      apply: true,
      decision: { allow: true, reason: "within-caps" },
    })

    const live = evaluateTradingActionRisk({
      skill: "alpaca-trading",
      method: "POST",
      host: "api.alpaca.markets",
      path: "/v2/orders",
      url: "https://api.alpaca.markets/v2/orders",
      body: { qty: "1", limit_price: "1010", stop_price: "990" },
      env,
    })
    expect(live).toEqual({
      apply: true,
      decision: { allow: false, reason: "live-alpaca-host" },
    })
  })

  it("sizes binance / coinbase / polymarket order bodies with the same caps", () => {
    const binance = evaluateTradingActionRisk({
      skill: "binance-trading",
      method: "POST",
      host: "api.binance.com",
      path: "/api/v3/order",
      body: { quantity: "166", price: "1017", stopPrice: "1005" },
      env,
    })
    expect(binance).toMatchObject({
      apply: true,
      decision: { allow: false, reason: "notional-cap" },
    })

    const coinbase = evaluateTradingActionRisk({
      skill: "coinbase-trading",
      method: "POST",
      host: "api.coinbase.com",
      path: "/v3/brokerage/orders",
      body: {
        order_configuration: {
          stop_limit_stop_limit_gtc: {
            base_size: "1",
            limit_price: "1010",
            stop_price: "990",
          },
        },
      },
      env,
    })
    expect(coinbase).toMatchObject({
      apply: true,
      decision: { allow: true, reason: "within-caps" },
    })

    const polymarket = evaluateTradingActionRisk({
      skill: "polymarket-trading",
      method: "POST",
      host: "clob.polymarket.com",
      path: "/order",
      body: { size: "1", price: "0.55" },
      env,
    })
    expect(polymarket).toEqual({
      apply: true,
      decision: { allow: false, reason: "invalid-size" },
    })
  })
})
