import { describe, expect, it } from "vitest"
import {
  TWITTER_API_402_COPY,
  TWITTER_API_STORE_TIER_NOTE,
  storeToolHonestyNote,
  twitterApiToolsMdHonestyLines,
} from "@/lib/tools/twitter-api-honesty"

describe("twitter-api honesty copy", () => {
  it("402 copy is tier-not-entitled, not down", () => {
    expect(TWITTER_API_402_COPY).toContain("tier doesn't include this endpoint")
    expect(TWITTER_API_402_COPY).toContain("Tavily-only")
    expect(TWITTER_API_402_COPY.toLowerCase()).not.toContain("down")
    expect(TWITTER_API_402_COPY).not.toContain("\u2014")
  })

  it("store note is only on twitter-api", () => {
    expect(storeToolHonestyNote("twitter-api")).toBe(TWITTER_API_STORE_TIER_NOTE)
    expect(storeToolHonestyNote("tavily")).toBeNull()
    expect(TWITTER_API_STORE_TIER_NOTE).toContain("free tier limits reads")
  })

  it("TOOLS.md lines attach only to twitter-api", () => {
    expect(twitterApiToolsMdHonestyLines("tavily")).toBe("")
    const lines = twitterApiToolsMdHonestyLines("twitter-api")
    expect(lines).toContain(TWITTER_API_402_COPY)
    expect(lines).toContain("not \"down.\"")
  })
})
