/**
 * WAVE-0 fire finding: X API 402 is tier-not-entitled, not "down".
 * Store copy and TOOLS.md must say that in the same words the mission
 * failure-branch uses, so the claw and the human see one story.
 */

export const TWITTER_API_402_COPY =
  "X API returned 402 Payment Required - add credits/upgrade at developer.x.com; running Tavily-only until then"

export const TWITTER_API_STORE_TIER_NOTE =
  "required Twitter API - free tier limits reads"

export const TWITTER_TOKEN_CANNOT_POST_COPY =
  "This token cannot post. Never say a post ships."

export function storeToolHonestyNote(slug: string): string | null {
  if (slug === "twitter-api") return TWITTER_API_STORE_TIER_NOTE
  return null
}

export function twitterApiToolsMdHonestyLines(toolSlug: string): string {
  if (toolSlug !== "twitter-api") return ""
  return `
- 402: ${TWITTER_API_402_COPY}
- 402 means the saved Bearer is real but the X API tier does not include that endpoint. It is not "down."
- ${TWITTER_TOKEN_CANNOT_POST_COPY}`
}
