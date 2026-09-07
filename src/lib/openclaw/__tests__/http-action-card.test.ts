import { describe, expect, it } from "vitest"
import {
  buildHttpActionCard,
  httpActionCardViolations,
  isHttpActionCardRenderable,
  renderHttpActionBodyPlain,
} from "@/lib/openclaw/http-action-card"

describe("http action card (A1 never blind-approve)", () => {
  it("renders an Alpaca paper order in plain form", () => {
    expect(
      renderHttpActionBodyPlain({
        skill: "alpaca-trading",
        body: {
          side: "buy",
          qty: "166",
          symbol: "MU",
          limit_price: "1017",
          stop_price: "1005",
        },
      }),
    ).toBe("BUY 166 MU @ $1,017 stop $1,005")
  })

  it("renders tweet text and gmail to/subject/body", () => {
    expect(
      renderHttpActionBodyPlain({
        skill: "twitter-api",
        body: { text: "Ship the digest at 4pm UTC." },
      }),
    ).toBe("Ship the digest at 4pm UTC.")
    expect(
      renderHttpActionBodyPlain({
        skill: "gmail-ops",
        body: { to: "ops@example.com", subject: "Daily", body: "Numbers look fine." },
      }),
    ).toBe("to ops@example.com\nsubject Daily\nNumbers look fine.")
  })

  it("MUTATION: payload-less action card fails", () => {
    const empty = buildHttpActionCard({
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: {},
    })
    expect(httpActionCardViolations(empty)).toContain("missing body")
    expect(isHttpActionCardRenderable(empty)).toBe(false)
    expect(httpActionCardViolations(null)).toEqual(["missing card"])
    expect(
      httpActionCardViolations({
        skill: "alpaca-trading",
        method: "POST",
        host: "paper-api.alpaca.markets",
        path: "/v2/orders",
        bodyPlain: "",
      }),
    ).toEqual(["missing body"])
  })
})
