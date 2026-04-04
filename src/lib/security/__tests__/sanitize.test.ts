import { describe, it, expect } from "vitest"
import { sanitizeHtml, sanitizeText, sanitizeMarkdown } from "../sanitize"

describe("sanitizeHtml", () => {
  it("preserves safe HTML", () => {
    expect(sanitizeHtml("<p>Hello <strong>world</strong></p>")).toBe(
      "<p>Hello <strong>world</strong></p>"
    )
  })

  it("strips script tags", () => {
    expect(sanitizeHtml('<p>Hi</p><script>alert("xss")</script>')).toBe("<p>Hi</p>")
  })

  it("strips event handlers", () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x">')
  })

  it("strips iframe tags", () => {
    expect(sanitizeHtml('<iframe src="https://evil.com"></iframe>')).toBe("")
  })

  it("strips style attributes", () => {
    expect(sanitizeHtml('<p style="color:red">text</p>')).toBe("<p>text</p>")
  })

  it("handles empty input", () => {
    expect(sanitizeHtml("")).toBe("")
  })
})

describe("sanitizeText", () => {
  it("strips all HTML tags", () => {
    const result = sanitizeText("<b>bold</b> and <script>evil</script>")
    expect(result).not.toContain("<b>")
    expect(result).not.toContain("<script>")
    expect(result).toContain("bold")
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
})
