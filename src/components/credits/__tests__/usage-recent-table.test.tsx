// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CreditUsageRecord } from "@/hooks/use-credit-usage"
import { UsageRecentTable } from "@/components/credits/usage-recent-table"

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: import("react").ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

const WS_ID = "cmtxusage0001nightwatchxx"

function record(overrides: Partial<CreditUsageRecord> = {}): CreditUsageRecord {
  return {
    id: "rec-1",
    creditAccountId: "acct-1",
    workspaceId: WS_ID,
    workspaceName: "Night Watch",
    agentId: null,
    provider: "ANTHROPIC",
    model: "anthropic/claude-haiku-4-5-20251001",
    inputTokens: 12,
    outputTokens: 8,
    costCents: 3,
    balanceAfterCents: 90,
    createdAt: "2026-08-14T13:05:00.000Z",
    ...overrides,
  }
}

describe("UsageRecentTable workspace column", () => {
  it("name-not-cuid snapshot: name links to dashboard; cuid is not the cell label", () => {
    render(<UsageRecentTable records={[record()]} />)
    const link = screen.getByRole("link", { name: "Night Watch" })
    expect(link.getAttribute("href")).toBe(`/dashboard/${WS_ID}`)
    expect(link.textContent).toBe("Night Watch")
    expect(link.textContent).not.toBe(WS_ID)
    expect(screen.queryByText(WS_ID)).toBeNull()
    expect({
      label: link.textContent,
      href: link.getAttribute("href"),
      cuidVisible: screen.queryByText(WS_ID) !== null,
    }).toMatchInlineSnapshot(`
      {
        "cuidVisible": false,
        "href": "/dashboard/cmtxusage0001nightwatchxx",
        "label": "Night Watch",
      }
    `)
  })

  it("MUTATION: raw workspaceId as cell text restored → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/credits/usage-recent-table.tsx"),
      "utf8",
    )
    expect(src).not.toContain("<TruncatedText>{r.workspaceId}</TruncatedText>")
    expect(src).not.toContain("font-mono")
    expect(src).toContain("workspaceName")
    expect(src).toContain("content={r.workspaceId}")
    expect(src).toContain("`/dashboard/${r.workspaceId}`")
  })
})
