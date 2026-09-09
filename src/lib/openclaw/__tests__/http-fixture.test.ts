import { describe, expect, it } from "vitest"
import {
  HTTP_FIXTURE_RECORDINGS,
  httpQueryShape,
  isHttpFixtureEnabled,
  isHttpFixtureRuntimeAllowed,
  lookupHttpFixture,
} from "@/lib/openclaw/http-fixture"
import { mintHttpToolId } from "@/lib/openclaw/http-ledger"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("http fixture mode", () => {
  it("never enables on production even if the workspace flag is true", () => {
    expect(isHttpFixtureEnabled(true, { CLAWS_ENV: "production", NODE_ENV: "test" })).toBe(false)
    expect(isHttpFixtureRuntimeAllowed({ CLAWS_ENV: "production" })).toBe(false)
    expect(isHttpFixtureEnabled(true, { CLAWS_ENV: "staging" })).toBe(true)
    expect(isHttpFixtureEnabled(false, { CLAWS_ENV: "staging" })).toBe(false)
    expect(isHttpFixtureEnabled(true, { VERCEL_ENV: "production" })).toBe(false)
    expect(isHttpFixtureEnabled(true, { CLAWS_ENV: "staging", VERCEL_ENV: "production" })).toBe(true)
    expect(isHttpFixtureEnabled(true, { NODE_ENV: "test" })).toBe(true)
  })

  it("MUTATION: gate honors isHttpFixtureEnabled so prod cannot serve recordings", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/http-action.ts"), "utf8")
    expect(src).toContain("isHttpFixtureEnabled")
    expect(src).toContain("fixture-miss")
    expect(src).toContain("mintHttpToolId(args.skill, { fixture: fixtureOn })")
  })

  it("mints tool:fixture:<skill>:<hex>", () => {
    expect(mintHttpToolId("shopify-store", { fixture: true })).toMatch(
      /^tool:fixture:shopify-store:[a-f0-9]{12}$/,
    )
    expect(mintHttpToolId("shopify-store")).toMatch(/^tool:shopify-store:[a-f0-9]{12}$/)
  })

  it("looks up shopify / tavily / gmail recordings by path", () => {
    expect(
      lookupHttpFixture({
        skill: "shopify-store",
        method: "GET",
        path: "/admin/api/2024-10/products.json",
      })?.httpStatus,
    ).toBe(200)
    expect(
      lookupHttpFixture({
        skill: "shopify-store",
        method: "GET",
        path: "/admin/api/2025-01/inventory_levels.json",
      })?.body,
    ).toMatchObject({ inventory_levels: expect.any(Array) })
    expect(
      lookupHttpFixture({
        skill: "tavily-search",
        method: "POST",
        path: "/search",
        body: { query: "x" },
      }),
    ).not.toBeNull()
    expect(
      lookupHttpFixture({
        skill: "gmail-ops",
        method: "POST",
        path: "/api/v3/tools/execute/GMAIL_FETCH_EMAILS",
        body: { arguments: {} },
      }),
    ).not.toBeNull()
    expect(
      lookupHttpFixture({
        skill: "shopify-store",
        method: "GET",
        path: "/admin/api/2024-10/shop.json",
      }),
    ).toBeNull()
    expect(HTTP_FIXTURE_RECORDINGS.length).toBeGreaterThan(8)
    expect(
      lookupHttpFixture({
        skill: "youtube-data-api",
        method: "POST",
        path: "/api/v3/tools/execute/YOUTUBE_GET_CHANNEL_STATISTICS",
        body: { arguments: {} },
      })?.httpStatus,
    ).toBe(200)
    expect(
      lookupHttpFixture({
        skill: "youtube-data-api",
        method: "POST",
        path: "/api/v3/tools/execute/YOUTUBE_SEARCH_YOU_TUBE",
        body: { arguments: {} },
      })?.body,
    ).toMatchObject({ successful: true })
    expect(
      lookupHttpFixture({
        skill: "beehiiv-api",
        method: "GET",
        path: "/v2/publications/pub_fixture/posts",
      })?.httpStatus,
    ).toBe(200)
    expect(
      lookupHttpFixture({
        skill: "beehiiv-api",
        method: "POST",
        path: "/v2/publications/pub_fixture/posts",
      })?.httpStatus,
    ).toBe(200)
    expect(
      lookupHttpFixture({
        skill: "gmail-ops",
        method: "POST",
        path: "/api/v3/tools/execute/GMAIL_SEND_EMAIL",
        body: { arguments: {} },
      }),
    ).not.toBeNull()
  })

  it("query-shape prefers an exact key set", () => {
    expect(httpQueryShape({ url: "https://api.x.com/2/tweets/search/recent?query=MU" })).toBe("query")
    expect(
      lookupHttpFixture({
        skill: "twitter-api",
        method: "GET",
        path: "/2/tweets/search/recent",
        url: "https://api.twitter.com/2/tweets/search/recent?query=MU",
      }),
    ).not.toBeNull()
  })
})
