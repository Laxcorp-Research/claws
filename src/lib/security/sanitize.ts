import sanitize from "sanitize-html"

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return ""
  return sanitize(dirty, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "strong", "em", "b", "i", "u", "s", "del",
      "code", "pre", "blockquote",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "span", "div",
      "sup", "sub",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    allowedStyles: {},
  })
}

export function sanitizeText(dirty: string): string {
  if (!dirty) return ""
  return sanitize(dirty, {
    allowedTags: [],
    allowedAttributes: {},
  })
}

const ACTIVITY_TEXT_MAX_LEN = 500

const OPENCLAW_HOST_ROOT = "/home/node/.openclaw/"

/**
 * Chat/PIPELINE paste must never show container host paths.
 * Missions keep absolute paths internally; the human sees logical names.
 */
export function stripHostMachineryPaths(text: string): string {
  if (!text.includes(OPENCLAW_HOST_ROOT)) return text
  return text.replace(/\/home\/node\/\.openclaw\/([^\s)`"'<>]+)/g, (_m, rest: string) => {
    const workspaceShared = rest.match(/^workspace-[^/]+\/(shared\/.+)$/)
    if (workspaceShared?.[1]) return workspaceShared[1]
    return rest
  })
}

/**
 * Normalize free-form activity-log text before it reaches the client.
 *
 * ActivityLog.action is rendered verbatim in the dashboard's activity feed
 * and pending-approvals list. If a writer ever stores a non-plain-text
 * payload (e.g., a tool response body containing HTML), React escapes the
 * tags and the user sees a wall of tag-looking characters inline.
 *
 * This helper strips any HTML tags and caps length so a single pathological
 * row can't dominate the feed. Non-HTML text under the cap is unchanged.
 */
export function sanitizeActivityText(raw: string | null | undefined): string {
  if (!raw) return ""
  const cleaned = sanitizeText(stripHostMachineryPaths(raw)).trim()
  if (cleaned.length <= ACTIVITY_TEXT_MAX_LEN) return cleaned
  return cleaned.slice(0, ACTIVITY_TEXT_MAX_LEN) + "\u2026"
}

// PR-4: the expand-on-click `detail` body behind a short `action` summary.
// Same HTML-strip as the feed text, but a higher cap (the whole point of
// detail is to hold the full context the action elides). Returns null for
// empty/absent input so the client can omit the expand affordance.
const ACTIVITY_DETAIL_MAX_LEN = 4096

export function sanitizeActivityDetail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = sanitizeText(stripHostMachineryPaths(raw)).trim()
  if (cleaned.length === 0) return null
  if (cleaned.length <= ACTIVITY_DETAIL_MAX_LEN) return cleaned
  return cleaned.slice(0, ACTIVITY_DETAIL_MAX_LEN) + "\u2026"
}

export function sanitizeMarkdown(dirty: string): string {
  if (!dirty) return ""
  let clean = dirty
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  clean = clean.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
  clean = clean.replace(/\bon\w+\s*=\s*[^\s>]*/gi, "")
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
  clean = clean.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""')
  clean = clean.replace(/src\s*=\s*["']data:text\/html[^"']*["']/gi, 'src=""')
  clean = clean.replace(/<\s*\/?\s*(iframe|object|embed|form|input|textarea|select|button)\b[^>]*>/gi, "")
  return clean
}
