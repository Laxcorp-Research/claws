// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { DocumentViewer } from "@/components/dashboard/document-viewer"
import { MarkdownBody } from "@/components/dashboard/chat-message"
import {
  CONTAINED_MODAL_CHROME_PX,
  containedModalMaxHeightPx,
} from "@/components/ui/modal"

afterEach(() => cleanup())

const VIEWPORT_PX = 800

function longDocumentFixture(viewportPx: number): string {
  const targetPx = viewportPx * 3
  const paragraphs = Math.ceil(targetPx / 24)
  const body = Array.from({ length: paragraphs }, (_, i) => {
    return `Paragraph ${i + 1}. The draft continues so the viewer must scroll instead of growing the page.`
  }).join("\n\n")
  const longLine = `https://example.com/${"segment/".repeat(40)}token`
  return `# Long deliverable\n\n\`\`\`\n${longLine}\n\`\`\`\n\n${body}`
}

describe("DocumentViewer - viewport contained", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: VIEWPORT_PX,
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    })
  })

  it("caps viewer height at viewport minus chrome for a 3x-viewport document", async () => {
    const content = longDocumentFixture(VIEWPORT_PX)
    expect(content.length).toBeGreaterThan(VIEWPORT_PX)

    render(
      <DocumentViewer
        open
        onClose={() => undefined}
        title="x-content-cycle"
        description="shared/deliverables/x-content-cycle.md"
        actions={<button type="button">Approve</button>}
      >
        <MarkdownBody content={content} />
      </DocumentViewer>,
    )

    const dialog = await screen.findByRole("dialog")
    const maxHeightPx = containedModalMaxHeightPx(VIEWPORT_PX)
    expect(maxHeightPx).toBe(VIEWPORT_PX - CONTAINED_MODAL_CHROME_PX)
    expect(maxHeightPx).toBeLessThanOrEqual(VIEWPORT_PX)
    await waitFor(() => {
      expect(dialog.style.maxHeight).toBe(`${maxHeightPx}px`)
    })
    expect(parseInt(dialog.style.maxHeight, 10)).toBeLessThanOrEqual(window.innerHeight)
    expect(dialog.className).toContain("max-h-[calc(100dvh-32px)]")
    expect(dialog.className).toContain("overflow-hidden")
    expect(dialog.className).toContain("w-full")
  })

  it("scrolls the body internally and keeps the action bar out of the scroll pane", async () => {
    render(
      <DocumentViewer
        open
        onClose={() => undefined}
        title="x-content-cycle"
        actions={
          <>
            <button type="button">Edit</button>
            <button type="button">Reject</button>
            <button type="button">Approve</button>
          </>
        }
      >
        <MarkdownBody content={longDocumentFixture(VIEWPORT_PX)} />
      </DocumentViewer>,
    )

    const body = await screen.findByTestId("document-viewer-body")
    const actions = screen.getByTestId("document-viewer-actions")
    expect(body.className).toContain("overflow-y-auto")
    expect(body.contains(actions)).toBe(false)

    body.scrollTop = 1200
    expect(body.scrollTop).toBe(1200)

    body.scrollTop = 99999
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy()
    expect(actions.contains(screen.getByRole("button", { name: "Approve" }))).toBe(true)
    expect(body.contains(actions)).toBe(false)
  })

  it("caps prose width and keeps code blocks from widening the page", async () => {
    render(
      <DocumentViewer open onClose={() => undefined} title="draft">
        <MarkdownBody content={longDocumentFixture(VIEWPORT_PX)} />
      </DocumentViewer>,
    )

    const prose = await screen.findByTestId("document-viewer-prose")
    expect(prose.className).toContain("max-w-[65ch]")
    expect(prose.className).toContain("overflow-wrap:anywhere")
    expect(prose.className).toContain("[&_pre]:overflow-x-auto")
    expect(prose.className).toContain("[&_pre]:max-w-full")
  })

  it("MUTATION: unbounded height restored fails", () => {
    const modal = readFileSync(join(process.cwd(), "src/components/ui/modal.tsx"), "utf8")
    const viewer = readFileSync(
      join(process.cwd(), "src/components/dashboard/document-viewer.tsx"),
      "utf8",
    )
    expect(modal).toContain("max-h-[calc(100dvh-32px)]")
    expect(modal).toContain("overflow-y-auto")
    expect(modal).toContain("containedModalMaxHeightPx")
    expect(modal).toContain("CONTAINED_MODAL_CHROME_PX")
    expect(viewer).toContain("contained")
    expect(viewer).toContain("document-viewer-body")
    expect(viewer).toContain("document-viewer-actions")
    expect(viewer).not.toMatch(/footer=/)
  })

  it("MUTATION: chat and Needs you Open the same DocumentViewer via DocumentCard", () => {
    const card = readFileSync(
      join(process.cwd(), "src/components/dashboard/document-card.tsx"),
      "utf8",
    )
    const chat = readFileSync(
      join(process.cwd(), "src/components/dashboard/chat-panel.tsx"),
      "utf8",
    )
    const needs = readFileSync(
      join(process.cwd(), "src/components/dashboard/needs-you-section.tsx"),
      "utf8",
    )
    expect(card).toContain("DocumentViewer")
    expect(card).not.toContain('from "@/components/ui/modal"')
    expect(card).not.toContain("<Modal")
    expect(chat).toContain("DocumentCard")
    expect(chat).not.toContain("DocumentViewer")
    expect(needs).toContain("DocumentCard")
    expect(needs).not.toContain("DocumentViewer")
  })
})
