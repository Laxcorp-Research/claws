import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { evaluateHttpCall } from "@/lib/openclaw/http-rail"
import { httpContractForSkill } from "@/lib/openclaw/skill-http-contracts"
import { httpBodyHash } from "@/lib/openclaw/http-ledger"
import { AUTONOMOUS_CAPABLE_TOOLS } from "@/lib/openclaw/delivery-rail"

const alpaca = httpContractForSkill("alpaca-trading")
const twitter = httpContractForSkill("twitter-api")
const tavily = httpContractForSkill("tavily-search")
const hubspot = httpContractForSkill("hubspot-crm")

const order = {
  side: "buy",
  qty: "166",
  symbol: "MU",
  limit_price: "1017",
  stop_price: "1005",
}

describe("evaluateHttpCall", () => {
  it("READ is allowed and returns a tool id", () => {
    const decision = evaluateHttpCall({
      contract: tavily,
      method: "POST",
      host: "api.tavily.com",
      path: "/search",
      body: { query: "mu earnings" },
      deliveryMode: "APPROVAL_REQUIRED",
      toolId: "tool:tavily-search:read1",
    })
    expect(decision).toEqual({
      status: "allow",
      class: "READ",
      toolId: "tool:tavily-search:read1",
    })
  })

  it("ACTION under ALERT-ONLY / APPROVAL_REQUIRED is denied+pending with a readable card", () => {
    const decision = evaluateHttpCall({
      contract: alpaca,
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: order,
      deliveryMode: "APPROVAL_REQUIRED",
      toolId: "tool:alpaca-trading:act1",
    })
    expect(decision.status).toBe("pending")
    if (decision.status !== "pending") throw new Error("expected pending")
    expect(decision.card.bodyPlain).toBe("BUY 166 MU @ $1,017 stop $1,005")
    expect(decision.card.skill).toBe("alpaca-trading")
    expect(decision.card.method).toBe("POST")
    expect(decision.card.host).toBe("paper-api.alpaca.markets")
    expect(decision.card.path).toBe("/v2/orders")
  })

  it("approve permit allows one matching ACTION then consumed/replay/different body deny", () => {
    const permit = {
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      bodyHash: httpBodyHash(order),
      consumedAt: null,
    }
    const allowed = evaluateHttpCall({
      contract: alpaca,
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: order,
      deliveryMode: "APPROVAL_REQUIRED",
      permit,
      toolId: "tool:alpaca-trading:ok",
    })
    expect(allowed).toEqual({ status: "allow", class: "ACTION", toolId: "tool:alpaca-trading:ok" })

    const replay = evaluateHttpCall({
      contract: alpaca,
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: order,
      deliveryMode: "APPROVAL_REQUIRED",
      permit: { ...permit, consumedAt: "2026-09-07T00:00:00.000Z" },
      toolId: "tool:alpaca-trading:replay",
    })
    expect(replay).toEqual({
      status: "deny",
      reason: "permit_consumed",
      toolId: "tool:alpaca-trading:replay",
    })

    const swapped = evaluateHttpCall({
      contract: alpaca,
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: { ...order, qty: "1" },
      deliveryMode: "APPROVAL_REQUIRED",
      permit,
      toolId: "tool:alpaca-trading:swap",
    })
    expect(swapped).toEqual({
      status: "deny",
      reason: "permit_mismatch",
      toolId: "tool:alpaca-trading:swap",
    })
  })

  it("rejects LLM-supplied Authorization and other injected auth headers", () => {
    const decision = evaluateHttpCall({
      contract: twitter,
      method: "GET",
      host: "api.twitter.com",
      path: "/2/tweets/search/recent",
      headers: { Authorization: "Bearer llm-forged" },
      deliveryMode: "APPROVAL_REQUIRED",
      toolId: "tool:twitter-api:auth",
    })
    expect(decision).toEqual({
      status: "deny",
      reason: "caller_auth",
      toolId: "tool:twitter-api:auth",
    })
  })

  it("undeclared host/path/skill is denied", () => {
    expect(
      evaluateHttpCall({
        contract: null,
        skill: "gmail-ops",
        method: "POST",
        host: "gmail.googleapis.com",
        path: "/gmail/v1/users/me/messages/send",
        body: { to: "a@b.com", subject: "hi", body: "x" },
        toolId: "tool:gmail-ops:no",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
    expect(
      evaluateHttpCall({
        contract: twitter,
        method: "DELETE",
        host: "api.twitter.com",
        path: "/2/tweets/1",
        toolId: "tool:twitter-api:no",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
    expect(
      evaluateHttpCall({
        contract: alpaca,
        method: "POST",
        host: "api.alpaca.markets",
        path: "/v2/orders",
        body: order,
        toolId: "tool:alpaca-trading:live",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
  })

  it("Composio READ is allowed; ACTION is pending; execute catch-all is undeclared", () => {
    expect(hubspot).not.toBeNull()
    expect(
      evaluateHttpCall({
        contract: hubspot,
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/HUBSPOT_HUBSPOT_LIST_CONTACTS",
        body: { arguments: {} },
        toolId: "tool:hubspot-crm:list",
      }),
    ).toEqual({
      status: "allow",
      class: "READ",
      toolId: "tool:hubspot-crm:list",
    })
    const pending = evaluateHttpCall({
      contract: hubspot,
      method: "POST",
      host: "backend.composio.dev",
      path: "/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT",
      body: { arguments: { email: "a@b.com", firstname: "Ada" } },
      deliveryMode: "ALERT_ONLY",
      toolId: "tool:hubspot-crm:create",
    })
    expect(pending.status).toBe("pending")
    expect(
      evaluateHttpCall({
        contract: hubspot,
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute",
        body: { arguments: { email: "a@b.com" } },
        toolId: "tool:hubspot-crm:bare",
      }),
    ).toMatchObject({ status: "deny", reason: "undeclared" })
  })

  it("payload-less ACTION fails closed (A1)", () => {
    const decision = evaluateHttpCall({
      contract: alpaca,
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: {},
      deliveryMode: "APPROVAL_REQUIRED",
      toolId: "tool:alpaca-trading:empty",
    })
    expect(decision).toEqual({
      status: "deny",
      reason: "missing_body",
      toolId: "tool:alpaca-trading:empty",
    })
  })

  it("MUTATION: generator must emit httpContractForSkill into frontmatter", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("httpContractForSkill")
    expect(src).toContain("openclawMeta.http")
  })

  it("AUTO_PROCEED allows opted-in paper POST /v2/orders, tweets, and GMAIL_SEND_EMAIL", () => {
    expect(AUTONOMOUS_CAPABLE_TOOLS).toEqual(["alpaca-trading", "twitter-api", "gmail-ops"])
    expect(
      evaluateHttpCall({
        contract: alpaca,
        method: "POST",
        host: "paper-api.alpaca.markets",
        path: "/v2/orders",
        body: order,
        deliveryMode: "AUTO_PROCEED",
        toolId: "tool:alpaca-trading:auto",
      }),
    ).toEqual({
      status: "allow",
      class: "ACTION",
      toolId: "tool:alpaca-trading:auto",
    })
    expect(
      evaluateHttpCall({
        contract: twitter,
        method: "POST",
        host: "api.twitter.com",
        path: "/2/tweets",
        body: { text: "hello from claws" },
        deliveryMode: "AUTO_PROCEED",
        toolId: "tool:twitter-api:auto",
      }),
    ).toEqual({
      status: "allow",
      class: "ACTION",
      toolId: "tool:twitter-api:auto",
    })
    const gmail = httpContractForSkill("gmail-ops")
    expect(
      evaluateHttpCall({
        contract: gmail,
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/GMAIL_SEND_EMAIL",
        body: { arguments: { recipient_email: "a@b.com", subject: "hi", body: "x" } },
        deliveryMode: "AUTO_PROCEED",
        toolId: "tool:gmail-ops:send",
      }),
    ).toEqual({
      status: "allow",
      class: "ACTION",
      toolId: "tool:gmail-ops:send",
    })
  })

  it("AUTO_PROCEED still cards non-opted endpoints on an opted skill; denies non-opted skills", () => {
    const gmail = httpContractForSkill("gmail-ops")
    const label = evaluateHttpCall({
      contract: gmail,
      method: "POST",
      host: "backend.composio.dev",
      path: "/api/v3/tools/execute/GMAIL_ADD_LABEL_TO_EMAIL",
      body: {
        arguments: {
          message_id: "m1",
          label: "x",
          recipient_email: "a@b.com",
          subject: "keep card readable",
          body: "x",
        },
      },
      deliveryMode: "AUTO_PROCEED",
      toolId: "tool:gmail-ops:label",
    })
    expect(label.status).toBe("pending")
    expect(
      evaluateHttpCall({
        contract: hubspot,
        method: "POST",
        host: "backend.composio.dev",
        path: "/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT",
        body: { arguments: { email: "a@b.com", firstname: "Ada" } },
        deliveryMode: "AUTO_PROCEED",
        toolId: "tool:hubspot-crm:create",
      }),
    ).toEqual({
      status: "deny",
      reason: "not_autonomous",
      toolId: "tool:hubspot-crm:create",
    })
  })

  it("AUTO_PROCEED leftover unused permit for a different body still allows the opted-in call", () => {
    const leftover = {
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      bodyHash: httpBodyHash(order),
      consumedAt: null,
    }
    expect(
      evaluateHttpCall({
        contract: alpaca,
        method: "POST",
        host: "paper-api.alpaca.markets",
        path: "/v2/orders",
        body: { ...order, qty: "1" },
        deliveryMode: "AUTO_PROCEED",
        permit: leftover,
        toolId: "tool:alpaca-trading:auto-swap",
      }),
    ).toEqual({
      status: "allow",
      class: "ACTION",
      toolId: "tool:alpaca-trading:auto-swap",
    })
  })
})
