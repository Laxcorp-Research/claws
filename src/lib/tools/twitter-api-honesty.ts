/**
 * WAVE-0 fire finding: X API 402 is tier-not-entitled, not "down".
 * Store copy and TOOLS.md must say that in the same words the mission
 * failure-branch uses, so the claw and the human see one story.
 */

export const TWITTER_API_402_COPY =
  "your X API tier doesn't include this endpoint (search needs paid tier) - running Tavily-only until upgraded."

export const TWITTER_API_STORE_TIER_NOTE =
  "required Twitter API - free tier limits reads"

export function storeToolHonestyNote(slug: string): string | null {
  if (slug === "twitter-api") return TWITTER_API_STORE_TIER_NOTE
  return null
}

export function twitterApiToolsMdHonestyLines(toolSlug: string): string {
  if (toolSlug !== "twitter-api") return ""
  return `
- 402: ${TWITTER_API_402_COPY}
- 402 means the saved Bearer is real but the X API tier does not include that endpoint. It is not "down."`
}
