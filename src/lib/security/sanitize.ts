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
  const cleaned = sanitizeText(raw).trim()
  if (cleaned.length <= ACTIVITY_TEXT_MAX_LEN) return cleaned
  return cleaned.slice(0, ACTIVITY_TEXT_MAX_LEN) + "\u2026"
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
