import DOMPurify from "dompurify"
import { JSDOM } from "jsdom"

const window = new JSDOM("").window
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const purify = DOMPurify(window as any)

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
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
  ALLOWED_ATTR: [
    "href", "src", "alt", "title", "class",
    "target", "rel",
    "colspan", "rowspan",
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select", "button"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"],
}

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return ""
  return purify.sanitize(dirty, SANITIZE_CONFIG) as string
}

export function sanitizeText(dirty: string): string {
  if (!dirty) return ""
  return purify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as string
}

export function sanitizeMarkdown(dirty: string): string {
  if (!dirty) return ""
  let clean = dirty.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  clean = clean.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
  return clean
}
