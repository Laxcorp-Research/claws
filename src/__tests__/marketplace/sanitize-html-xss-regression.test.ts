// Regression lock for GHSA-rpr9-rxv7-x643 (sanitize-html <=2.17.3): a default
// XSS where content inside raw-text elements — most notably `<xmp>`, plus
// `<noscript>`/`<noembed>`/`<style>`/`<title>` — was passed through WITHOUT
// HTML-escaping. When the "sanitized" output was later inserted into the DOM,
// the smuggled markup re-entered as live HTML (script execution / event
// handlers). Patched in sanitize-html 2.17.4.
//
// This exercises the REAL production sanitizer config (src/lib/security/sanitize)
// — the one applied to user-submitted marketplace content (skill/template
// markdown) per GH #72's audit-scope note — and asserts the xmp raw-text vector
// is neutralised. It would fail if sanitize-html were rolled back to a version
// where the raw-text passthrough re-leaks active content.
import { describe, it, expect } from "vitest"
import { sanitizeHtml } from "@/lib/security/sanitize"

// Assert the sanitised output contains no *live* (unescaped) dangerous markup.
// The distinction is the whole point of the GHSA: the patched library may emit
// the smuggled payload as HTML-ESCAPED text (e.g. "&lt;img onerror=...&gt;"),
// which is inert — the browser renders it as literal characters. The bug was
// that raw-text elements leaked the payload UNESCAPED (a real <tag onerror=...>
// that re-executes). So we match live constructs only — these regexes require
// an actual "<" starting a tag, which an escaped "&lt;" payload never produces.
// (On the vulnerable 2.17.3 the raw-text passthrough emits a live element here,
// which WOULD match → this test fails if the bump is ever rolled back.)
function assertNoActiveContent(output: string) {
  // live <script ...> opening tag
  expect(output).not.toMatch(/<script\b/i)
  // a live raw-text carrier tag surviving as an element
  expect(output).not.toMatch(/<(?:xmp|noscript|noembed|title|style)\b/i)
  // a live element carrying an on* event handler attribute (e.g. <img onerror=)
  expect(output).not.toMatch(/<[^>]+\bon\w+\s*=/i)
  // a live element with a javascript: URL in href/src
  expect(output).not.toMatch(/<[^>]+\b(?:href|src)\s*=\s*["']?\s*javascript:/i)
}

describe("sanitize-html GHSA-rpr9-rxv7-x643 — xmp raw-text XSS regression", () => {
  // The canonical vector: an <xmp> raw-text element wrapping an event-handler
  // payload. On vulnerable versions the inner markup leaked unescaped.
  it("neutralises an <xmp>-wrapped img/onerror payload", () => {
    const out = sanitizeHtml('<xmp><img src=x onerror=alert(1)></xmp>')
    assertNoActiveContent(out)
  })

  it("neutralises an <xmp>-wrapped <script> payload", () => {
    const out = sanitizeHtml('<xmp></xmp><script>alert(document.cookie)</script>')
    assertNoActiveContent(out)
  })

  it("neutralises the broader raw-text element class (noscript / noembed / title / style)", () => {
    const vectors = [
      '<noscript><img src=x onerror=alert(1)></noscript>',
      '<noembed><img src=x onerror=alert(1)></noembed>',
      '<title><img src=x onerror=alert(1)></title>',
      '<style><img src=x onerror=alert(1)></style>',
      // nested/odd casing variants that fuzzing of this class commonly uses
      '<XMP><SCRIPT>alert(1)</SCRIPT></XMP>',
      '<xmp><a href="javascript:alert(1)">x</a></xmp>',
    ]
    for (const v of vectors) {
      assertNoActiveContent(sanitizeHtml(v))
    }
  })

  // Sanity: the upgrade must not have broken legitimate sanitisation — safe
  // markdown-ish HTML still passes through (guards against a paranoid over-strip
  // masking the security assertion above as vacuously true).
  it("still preserves safe user content after the upgrade", () => {
    const out = sanitizeHtml('<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>')
    expect(out).toContain("<strong>world</strong>")
    expect(out).toContain('href="https://example.com"')
  })
})
