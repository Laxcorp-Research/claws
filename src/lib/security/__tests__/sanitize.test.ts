import { describe, it, expect } from "vitest"
import { sanitizeHtml, sanitizeText, sanitizeMarkdown, sanitizeActivityText, sanitizeActivityDetail, stripHostMachineryPaths } from "../sanitize"

describe("sanitizeHtml", () => {
  it("preserves safe HTML", () => {
    expect(sanitizeHtml("<p>Hello <strong>world</strong></p>")).toBe(
      "<p>Hello <strong>world</strong></p>"
    )
  })

  it("strips script tags", () => {
    const result = sanitizeHtml('<p>Hi</p><script>alert("xss")</script>')
    expect(result).not.toContain("<script>")
    expect(result).toContain("<p>Hi</p>")
  })

  it("strips event handlers", () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain("onerror")
  })

  it("strips style tags", () => {
    const result = sanitizeHtml("<style>body{color:red}</style><p>text</p>")
    expect(result).not.toContain("<style>")
    expect(result).toContain("<p>text</p>")
  })

  it("strips iframe tags", () => {
    const result = sanitizeHtml('<iframe src="https://evil.com"></iframe>')
    expect(result).not.toContain("<iframe")
  })

  it("handles empty input", () => {
    expect(sanitizeHtml("")).toBe("")
  })

  it("strips javascript: URLs in href", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain("javascript:")
    expect(result).toContain("click")
  })

  it("strips data: URLs in img src", () => {
    const result = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">')
    expect(result).not.toContain("data:text/html")
  })

  it("strips nested script obfuscation", () => {
    const result = sanitizeHtml("<scr<script>ipt>alert(1)</script>")
    expect(result).not.toContain("<script")
  })

  it("strips event handlers with different quote styles", () => {
    const result = sanitizeHtml('<img src="x" onerror=alert(1)>')
    expect(result).not.toContain("onerror")
  })
})

describe("sanitizeText", () => {
  it("strips all HTML tags", () => {
    const result = sanitizeText("<b>bold</b> and <script>evil</script>")
    expect(result).not.toContain("<b>")
    expect(result).not.toContain("<script>")
    expect(result).toContain("bold")
  })

  it("handles empty input", () => {
    expect(sanitizeText("")).toBe("")
  })

  it("handles encoded HTML entities", () => {
    const result = sanitizeText("Hello &lt;script&gt;alert(1)&lt;/script&gt;")
    expect(result).not.toContain("<script>")
  })
})

describe("sanitizeMarkdown", () => {
  it("removes script tags from markdown", () => {
    const result = sanitizeMarkdown("# Title\n<script>alert(1)</script>\nContent")
    expect(result).not.toContain("<script>")
    expect(result).toContain("# Title")
    expect(result).toContain("Content")
  })

  it("removes javascript: URLs", () => {
    const input = '<a href="javascript:alert(1)">link</a>'
    expect(sanitizeMarkdown(input)).not.toContain("javascript:")
  })

  it("preserves normal markdown", () => {
    const input = "# Hello\n\n- item 1\n- item 2\n\n```code```"
    expect(sanitizeMarkdown(input)).toBe(input)
  })

  it("removes event handlers without quotes", () => {
    const result = sanitizeMarkdown("<img src=x onerror=alert(1)>")
    expect(result).not.toContain("onerror")
  })

  it("removes iframe tags", () => {
    const result = sanitizeMarkdown('# Title\n<iframe src="https://evil.com"></iframe>\nContent')
    expect(result).not.toContain("iframe")
    expect(result).toContain("# Title")
    expect(result).toContain("Content")
  })

  it("removes style tags from markdown", () => {
    const result = sanitizeMarkdown("# Title\n<style>.x{color:red}</style>\nContent")
    expect(result).not.toContain("<style>")
    expect(result).toContain("# Title")
  })
})

describe("sanitizeActivityText", () => {
  it("returns empty string for null", () => {
    expect(sanitizeActivityText(null)).toBe("")
  })

  it("returns empty string for undefined", () => {
    expect(sanitizeActivityText(undefined)).toBe("")
  })

  it("returns empty string for empty input", () => {
    expect(sanitizeActivityText("")).toBe("")
  })

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeActivityText("   \n\t  ")).toBe("")
  })

  it("passes plain short text through unchanged", () => {
    const input = "Agent orchestrator paused by user"
    expect(sanitizeActivityText(input)).toBe(input)
  })

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeActivityText("  hello  ")).toBe("hello")
  })

  it("strips HTML tags while preserving inner text", () => {
    const input = '<div class="foo">hello <b>world</b></div>'
    const result = sanitizeActivityText(input)
    expect(result).not.toContain("<")
    expect(result).not.toContain(">")
    expect(result).toContain("hello")
    expect(result).toContain("world")
  })

  it("handles Cloudflare-style HTML error payload without leaking tags", () => {
    const cloudflare504 = [
      "<!DOCTYPE html>",
      '<html lang="en-US">',
      "<head>",
      '<meta charset="UTF-8">',
      "<title>my-app.up.railway.app | 504: Gateway time-out</title>",
      "</head>",
      "<body>",
      '<div class="cf-error-details">',
      "<h1>Gateway time-out</h1>",
      "</div>",
      "</body>",
      "</html>",
    ].join("\n")
    const result = sanitizeActivityText(cloudflare504)
    expect(result).not.toContain("<")
    expect(result).not.toContain(">")
    expect(result).not.toContain("<!DOCTYPE")
    expect(result).toContain("Gateway time-out")
  })

  it("truncates text longer than 500 chars and appends an ellipsis", () => {
    const input = "a".repeat(600)
    const result = sanitizeActivityText(input)
    expect(result).toHaveLength(501)
    expect(result.endsWith("\u2026")).toBe(true)
    expect(result.slice(0, 500)).toBe("a".repeat(500))
  })

  it("does not truncate text at exactly 500 chars", () => {
    const input = "a".repeat(500)
    const result = sanitizeActivityText(input)
    expect(result).toHaveLength(500)
    expect(result.endsWith("\u2026")).toBe(false)
  })

  it("preserves the '>' character inside normal sentences", () => {
    const input = "Rule fired: price > threshold"
    const result = sanitizeActivityText(input)
    expect(result).toContain("price")
    expect(result).toContain("threshold")
  })
})

describe("stripHostMachineryPaths", () => {
  it("rewrites container host paths to logical shared paths", () => {
    const leaked =
      "Proposal: `/home/node/.openclaw/shared/deliverables/proposal-draft.md`"
    expect(stripHostMachineryPaths(leaked)).toBe(
      "Proposal: `shared/deliverables/proposal-draft.md`",
    )
    expect(
      stripHostMachineryPaths(
        "| **Proposal** | `/home/node/.openclaw/shared/PIPELINE.md` |",
      ),
    ).not.toContain("/home/node/.openclaw/")
    expect(
      stripHostMachineryPaths(
        "/home/node/.openclaw/workspace-revenue-commander/shared/PIPELINE.md",
      ),
    ).toBe("shared/PIPELINE.md")
  })

  it("sanitizeActivityDetail strips host paths from PIPELINE paste", () => {
    const detail = sanitizeActivityDetail(
      "# PIPELINE.md\n| **Proposal** | `/home/node/.openclaw/shared/deliverables/proposal-draft.md` |",
    )
    expect(detail).not.toContain("/home/node/.openclaw/")
    expect(detail).toContain("shared/deliverables/proposal-draft.md")
  })
})

describe("sanitizeActivityDetail (PR-4)", () => {
  it("returns null for empty/absent input (no expand affordance)", () => {
    expect(sanitizeActivityDetail(null)).toBeNull()
    expect(sanitizeActivityDetail(undefined)).toBeNull()
    expect(sanitizeActivityDetail("")).toBeNull()
    expect(sanitizeActivityDetail("   ")).toBeNull()
  })

  it("strips HTML tags from the detail body", () => {
    const result = sanitizeActivityDetail("[cron:heartbeat-x] Read <b>HEARTBEAT.md</b> and follow it strictly.")
    expect(result).toBe("[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly.")
    expect(result).not.toContain("<b>")
  })

  it("allows a much longer body than the feed text (caps at 4096, not 500)", () => {
    const input = "a".repeat(2000)
    const result = sanitizeActivityDetail(input)
    expect(result).toHaveLength(2000)
    expect(result!.endsWith("\u2026")).toBe(false)
  })

  it("truncates over 4096 chars with an ellipsis", () => {
    const input = "a".repeat(5000)
    const result = sanitizeActivityDetail(input)
    expect(result).toHaveLength(4097)
    expect(result!.endsWith("\u2026")).toBe(true)
  })
})
