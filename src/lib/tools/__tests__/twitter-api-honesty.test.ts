import { describe, expect, it } from "vitest"
import {
  TWITTER_API_402_COPY,
  TWITTER_API_401_RECONNECT_COPY,
  TWITTER_API_STORE_TIER_NOTE,
  TWITTER_API_USERS_ME_FORBIDDEN_COPY,
  TWITTER_API_VALIDATE_URL,
  TWITTER_API_WEBFETCH_401_COPY,
  TWITTER_TOKEN_CANNOT_POST_COPY,
  classifyTwitterApiFailure,
  storeToolHonestyNote,
  twitterApiToolsMdHonestyLines,
  twitterNudgeFromActivity,
} from "@/lib/tools/twitter-api-honesty"

describe("twitter-api honesty copy", () => {
  it("402 copy is one phrasing; reconnect is not a remedy", () => {
    expect(TWITTER_API_402_COPY).toBe(
      "X API returned 402 Payment Required - add credits/upgrade at developer.x.com; running Tavily-only until then",
    )
    expect(TWITTER_API_402_COPY).toContain("developer.x.com")
    expect(TWITTER_API_402_COPY).toContain("Tavily-only")
    expect(TWITTER_API_402_COPY.toLowerCase()).not.toContain("down")
    expect(TWITTER_API_402_COPY.toLowerCase()).not.toContain("reconnect")
    expect(TWITTER_API_402_COPY).not.toContain("\u2014")
  })

  it("store note is only on twitter-api", () => {
    expect(storeToolHonestyNote("twitter-api")).toBe(TWITTER_API_STORE_TIER_NOTE)
    expect(storeToolHonestyNote("tavily")).toBeNull()
    expect(TWITTER_API_STORE_TIER_NOTE).toContain("free tier limits reads")
  })

  it("TOOLS.md lines attach only to twitter-api and lock 401 vs 402", () => {
    expect(twitterApiToolsMdHonestyLines("tavily")).toBe("")
    const lines = twitterApiToolsMdHonestyLines("twitter-api")
    expect(lines).toContain(TWITTER_API_402_COPY)
    expect(lines).toContain('not "down."')
    expect(lines).toContain(TWITTER_TOKEN_CANNOT_POST_COPY)
    expect(lines).toContain(TWITTER_API_WEBFETCH_401_COPY)
    expect(lines).toContain(TWITTER_API_USERS_ME_FORBIDDEN_COPY)
    expect(lines).toContain(TWITTER_API_401_RECONNECT_COPY)
    expect(lines).toContain("PENDING or unverified last-probe is not READY")
    expect(lines).not.toContain("\u2014")
  })
})

describe("classifyTwitterApiFailure", () => {
  it("web_fetch 401 of search/recent is unauthenticated, not dead-token", () => {
    expect(
      classifyTwitterApiFailure({
        status: 401,
        url: "https://api.twitter.com/2/tweets/search/recent?query=AI%20agents",
        body: '{"title":"Unauthorized","status":401,"detail":"Unauthorized"}',
        toolName: "web_fetch",
        sentAuthorization: false,
      }),
    ).toBe("unauthenticated")
  })

  it("Bearer curl 401 is dead-token", () => {
    expect(
      classifyTwitterApiFailure({
        status: 401,
        url: "https://api.twitter.com/2/tweets/search/recent?query=AI",
        body: '{"title":"Unauthorized","detail":"Unauthorized"}',
        toolName: "exec",
        sentAuthorization: true,
      }),
    ).toBe("dead-token")
  })

  it("GET /2/users/me with app-only Bearer is app-only-forbidden, not dead-token", () => {
    expect(
      classifyTwitterApiFailure({
        status: 403,
        url: "https://api.twitter.com/2/users/me",
        body: "Authenticating with OAuth 2.0 Application-Only is forbidden for this endpoint.",
        sentAuthorization: true,
      }),
    ).toBe("app-only-forbidden")
  })

  it("402 is tier, not reconnect", () => {
    expect(
      classifyTwitterApiFailure({
        status: 402,
        url: TWITTER_API_VALIDATE_URL,
        body: "Payment Required",
        sentAuthorization: true,
      }),
    ).toBe("tier")
  })

  it("403 entitlement text is tier", () => {
    expect(
      classifyTwitterApiFailure({
        status: 403,
        url: "https://api.twitter.com/2/tweets/search/recent",
        body: "Your client is not permitted to access this endpoint. client-not-enrolled",
        sentAuthorization: true,
      }),
    ).toBe("tier")
  })
})

describe("twitterNudgeFromActivity", () => {
  it("does not nudge reconnect on the Sep-1 web_fetch 401", () => {
    expect(
      twitterNudgeFromActivity({
        type: "ERROR",
        action: "Tool web_fetch failed: Web fetch failed (401): SECURITY NOTICE",
        detail:
          "Web fetch failed (401): GET https://api.twitter.com/2/tweets/search/recent?query=AI%20agents",
        metadata: JSON.stringify({
          toolName: "web_fetch",
          error: "Web fetch failed (401): Unauthorized",
        }),
      }),
    ).toBeNull()
  })

  it("nudges twitter-402-tier on an X 402 ERROR", () => {
    expect(
      twitterNudgeFromActivity({
        type: "ERROR",
        action: "Tool exec failed: X API 402 Payment Required",
        detail: "twitter-api 402",
        metadata: JSON.stringify({ toolName: "exec" }),
      }),
    ).toBe("twitter-402-tier")
  })

  it("does not treat users/me 403 as a 402 or reconnect nudge", () => {
    expect(
      twitterNudgeFromActivity({
        type: "ERROR",
        action: "Tool exec failed: 403 Unsupported Authentication",
        detail: "GET https://api.twitter.com/2/users/me Application-Only is forbidden",
        metadata: JSON.stringify({ toolName: "exec" }),
      }),
    ).toBeNull()
  })

  it("classifies action-text web_fetch 401 even without metadata toolName", () => {
    expect(
      twitterNudgeFromActivity({
        type: "ERROR",
        action: "Tool web_fetch failed: Web fetch failed (401)",
        detail: "GET https://api.twitter.com/2/tweets/search/recent",
        metadata: "{}",
      }),
    ).toBeNull()
  })

  it("does not fire the 402 nudge on a Bearer-curl 401", () => {
    expect(
      twitterNudgeFromActivity({
        type: "ERROR",
        action: "Tool exec failed: twitter-api 401 Unauthorized",
        detail: "curl Authorization Bearer https://api.twitter.com/2/tweets/search/recent",
        metadata: JSON.stringify({ toolName: "exec" }),
      }),
    ).toBeNull()
  })
})
