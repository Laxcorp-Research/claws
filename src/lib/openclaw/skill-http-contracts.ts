import type { HttpSkillContract } from "@/lib/openclaw/http-contract"

/**
 * Declared READ/ACTION endpoints. Skills without a row are not callable
 * via the http rail (A5). PR-4 fills the remaining 27.
 */
export const SKILL_HTTP_CONTRACTS: Readonly<Record<string, HttpSkillContract>> = {
  "tavily-search": {
    skill: "tavily-search",
    auth: "tavily-body-key",
    endpoints: [
      { method: "POST", host: "api.tavily.com", path: "/search", class: "READ" },
      { method: "POST", host: "api.tavily.com", path: "/extract", class: "READ" },
    ],
  },
  "twitter-api": {
    skill: "twitter-api",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.twitter.com", path: "/2/tweets/search/recent", class: "READ" },
      { method: "GET", host: "api.x.com", path: "/2/tweets/search/recent", class: "READ" },
      { method: "GET", host: "api.twitter.com", path: "/2/users", class: "READ" },
      { method: "GET", host: "api.x.com", path: "/2/users", class: "READ" },
      { method: "POST", host: "api.twitter.com", path: "/2/tweets", class: "ACTION" },
      { method: "POST", host: "api.x.com", path: "/2/tweets", class: "ACTION" },
    ],
  },
  "alpaca-trading": {
    skill: "alpaca-trading",
    auth: "alpaca-dual-header",
    endpoints: [
      { method: "GET", host: "paper-api.alpaca.markets", path: "/v2/account", class: "READ" },
      { method: "GET", host: "paper-api.alpaca.markets", path: "/v2/positions", class: "READ" },
      { method: "POST", host: "paper-api.alpaca.markets", path: "/v2/orders", class: "ACTION" },
    ],
  },
}

export function httpContractForSkill(slug: string): HttpSkillContract | null {
  return SKILL_HTTP_CONTRACTS[slug] ?? null
}
