import { describe, expect, it } from "vitest"
import {
  buildHttpLedgerRow,
  claimsSourceMatchesLedger,
  HTTP_LEDGER_EVENT_KIND,
  httpBodyHash,
  mintHttpToolId,
  parseHttpLedgerFromMetadata,
} from "@/lib/openclaw/http-ledger"

describe("http ledger", () => {
  it("mints tool:<skill>:<id> that claims tables can resolve", () => {
    const id = mintHttpToolId("alpaca-trading")
    expect(id).toMatch(/^tool:alpaca-trading:[a-f0-9]{12}$/)
    const row = buildHttpLedgerRow({
      toolId: id,
      skill: "alpaca-trading",
      method: "GET",
      host: "paper-api.alpaca.markets",
      path: "/v2/account",
      class: "READ",
      status: "ok",
      httpStatus: 200,
      bytes: 128,
      durationMs: 40,
    })
    expect(row.eventKind).toBe(HTTP_LEDGER_EVENT_KIND)
    expect(claimsSourceMatchesLedger(id, row)).toBe(true)
    expect(claimsSourceMatchesLedger("tool:other:1", row)).toBe(false)
    const parsed = parseHttpLedgerFromMetadata(JSON.stringify(row))
    expect(parsed?.toolId).toBe(id)
    const fixtureId = mintHttpToolId("shopify-store", { fixture: true })
    expect(fixtureId).toMatch(/^tool:fixture:shopify-store:[a-f0-9]{12}$/)
    expect(
      parseHttpLedgerFromMetadata(
        JSON.stringify(
          buildHttpLedgerRow({
            toolId: fixtureId,
            skill: "shopify-store",
            method: "GET",
            host: "laxclaws-dev.myshopify.com",
            path: "/admin/api/2024-10/products.json",
            class: "READ",
            status: "ok",
            httpStatus: 200,
            bytes: 12,
            durationMs: 1,
          }),
        ),
      )?.toolId,
    ).toBe(fixtureId)
  })

  it("hashes bodies so permits bind to the exact payload", () => {
    const a = httpBodyHash({ side: "buy", qty: "166", symbol: "MU" })
    const b = httpBodyHash({ side: "buy", qty: "1", symbol: "MU" })
    expect(a).toHaveLength(64)
    expect(a).not.toBe(b)
  })
})
