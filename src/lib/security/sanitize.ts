/**
 * Strip ALL HTML tags from a string. Returns plain text only.
 * Lightweight — no dependencies, safe for serverless.
 */
export function sanitizeText(dirty: string): string {
  if (!dirty) return ""
  return dirty
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}

/**
 * Sanitize HTML preserving safe tags. Uses regex-based approach
 * that's safe for serverless (no jsdom dependency).
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return ""
  const SAFE_TAGS = new Set([
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "ul", "ol", "li",
    "strong", "em", "b", "i", "u", "s", "del",
    "code", "pre", "blockquote", "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div", "sup", "sub",
  ])
  let clean = dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  clean = clean.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
  clean = clean.replace(/<(\/?)(\w+)([^>]*)>/g, (match, slash, tag, attrs) => {
    if (!SAFE_TAGS.has(tag.toLowerCase())) return ""
    const safeAttrs = (attrs as string).replace(/\s*(style|onerror|onload|onclick|onmouseover|onfocus|onblur)\s*=\s*["'][^"']*["']/gi, "")
    return `<${slash}${tag}${safeAttrs}>`
  })
  return clean
}

/**
 * Sanitize raw markdown source. Removes script tags and event handlers
 * but preserves markdown syntax.
 */
export function sanitizeMarkdown(dirty: string): string {
  if (!dirty) return ""
  let clean = dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  clean = clean.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
  return clean
}
