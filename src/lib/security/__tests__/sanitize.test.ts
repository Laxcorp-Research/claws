import { describe, it, expect } from "vitest"
import { sanitizeHtml, sanitizeText, sanitizeMarkdown } from "../sanitize"

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
