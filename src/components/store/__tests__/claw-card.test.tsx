// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ClawCard, type ClawCardData } from "@/components/store/claw-card"

afterEach(() => cleanup())

const ROOT = process.cwd()

const AGENTS: ClawCardData["agents"] = [
  { name: "Commander", role: "ORCHESTRATOR", color: "#5BA1F5" },
  { name: "Scout", role: "WORKER", color: "#8BFCAE" },
  { name: "Writer", role: "WORKER", color: "#5BA1F5" },
  { name: "Strategist", role: "WORKER", color: "#FFB1AB" },
  { name: "Tracker", role: "WORKER", color: "#FFDC6E" },
  { name: "Reviewer", role: "CRITIC", color: "#A78BFA" },
]

function officialFree(): ClawCardData {
  return {
    name: "Twitter/X Growth Machine",
    slug: "twitter-growth-machine",
    price: 0,
    isFree: true,
    tagline: "Grow your Twitter/X audience with AI-crafted content",
    category: "CREATOR",
    flowDescription: "",
    agents: AGENTS,
  }
}

function communityPaid(): ClawCardData {
  return {
    name: "Lead Inbox",
    slug: "lead-inbox",
    price: 49,
    isFree: false,
    tagline: "Triage inbound leads overnight",
    category: "BUSINESS_OPS",
    flowDescription: "",
    agents: AGENTS.slice(0, 3),
  }
}

function snapshotCard() {
  const link = screen.getByRole("link")
  const pillRow = link.querySelector(".flex-nowrap")
  const pillLabels = pillRow
    ? [...pillRow.querySelectorAll(":scope > span")].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    : []
  return {
    href: link.getAttribute("href"),
    name: (link.querySelector('[class*="text-[15px]"]')?.textContent ?? "").trim(),
    badge: (link.querySelector('[class*="max-h-[16px]"]')?.textContent ?? "").trim(),
    tagline: (link.querySelector('[class*="text-[12px]"]')?.textContent ?? "").trim(),
    meta: (link.querySelector('[data-store-card="meta"]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
    pills: pillLabels,
    price: (link.querySelector('[data-store-card="rail"] [class*="text-[13px]"]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
    cta: screen.getByText("View").textContent,
  }
}

describe("ClawCard - shared official + community layout", () => {
  it("snapshot: official free", () => {
    render(
      <ClawCard
        claw={officialFree()}
        trustTier="OFFICIAL"
        installCount={3}
        creatorName="Claws Team"
      />,
    )
    expect(snapshotCard()).toMatchInlineSnapshot(`
      {
        "badge": "Official",
        "cta": "View",
        "href": "/store/twitter-growth-machine",
        "meta": "by Claws Team · Creator · 3 installs",
        "name": "Twitter/X Growth Machine",
        "pills": [
          "Scout",
          "Writer",
          "Strategist",
          "Tracker",
          "+1",
        ],
        "price": "Free",
        "tagline": "Grow your Twitter/X audience with AI-crafted content",
      }
    `)
  })

  it("snapshot: community scanned free", () => {
    render(
      <ClawCard
        claw={{ ...officialFree(), name: "Night Watch", slug: "night-watch", isFree: true, price: 0 }}
        trustTier="SCANNED"
        installCount={0}
        creatorName="Ada"
      />,
    )
    expect(snapshotCard()).toMatchInlineSnapshot(`
      {
        "badge": "Auto-scanned",
        "cta": "View",
        "href": "/store/night-watch",
        "meta": "by Ada · Creator · 0 installs",
        "name": "Night Watch",
        "pills": [
          "Scout",
          "Writer",
          "Strategist",
          "Tracker",
          "+1",
        ],
        "price": "Free",
        "tagline": "Grow your Twitter/X audience with AI-crafted content",
      }
    `)
  })

  it("snapshot: community paid", () => {
    render(
      <ClawCard
        claw={communityPaid()}
        trustTier="SCANNED"
        installCount={12}
        creatorName="Ada"
      />,
    )
    expect(snapshotCard()).toMatchInlineSnapshot(`
      {
        "badge": "Auto-scanned",
        "cta": "View",
        "href": "/store/lead-inbox",
        "meta": "by Ada · Business Ops · 12 installs",
        "name": "Lead Inbox",
        "pills": [
          "Scout",
          "Writer",
        ],
        "price": "$49 one-time",
        "tagline": "Triage inbound leads overnight",
      }
    `)
  })

  it("snapshot: community paid with rating", () => {
    render(
      <ClawCard
        claw={communityPaid()}
        trustTier="VERIFIED"
        installCount={12}
        avgRating={4.6}
        creatorName="Ada"
      />,
    )
    expect(snapshotCard()).toMatchInlineSnapshot(`
      {
        "badge": "Verified",
        "cta": "View",
        "href": "/store/lead-inbox",
        "meta": "by Ada · Business Ops · 12 installs ★ 4.6",
        "name": "Lead Inbox",
        "pills": [
          "Scout",
          "Writer",
        ],
        "price": "$49 one-time",
        "tagline": "Triage inbound leads overnight",
      }
    `)
  })

  it("SCANNED badge is a single-line Auto-scanned label (full copy lives in tooltip)", () => {
    render(
      <ClawCard
        claw={communityPaid()}
        trustTier="SCANNED"
        installCount={1}
        creatorName="Ada"
      />,
    )
    const badge = screen.getByText("Auto-scanned")
    expect(badge.className).toMatch(/whitespace-nowrap/)
    expect(badge.className).toMatch(/max-h-\[16px\]/)
    expect(badge.className).toMatch(/h-\[16px\]/)
    expect(badge.textContent).not.toContain("automated")
    expect(screen.getByText("View")).toBeDefined()
  })

  it("agent pills stay on one row with a +N chip", () => {
    const { container } = render(
      <ClawCard claw={officialFree()} trustTier="OFFICIAL" installCount={1} creatorName="Claws Team" />,
    )
    const row = container.querySelector(".flex-nowrap")
    expect(row).toBeTruthy()
    expect(row?.className).toMatch(/overflow-hidden/)
    expect(row?.className).not.toMatch(/flex-wrap/)
    expect(screen.getByText("+1")).toBeDefined()
  })

  it("MUTATION: divergent community card / wrapping badge / marketplace CTA restored → fail", () => {
    const card = readFileSync(join(ROOT, "src/components/store/claw-card.tsx"), "utf8")
    const page = readFileSync(join(ROOT, "src/app/store/page.tsx"), "utf8")
    const badge = readFileSync(join(ROOT, "src/components/marketplace/trust-badge.tsx"), "utf8")

    expect(card).not.toContain("hideTrustBadge")
    expect(card).toContain("flex-nowrap")
    expect(card).not.toContain("flex-wrap")
    expect(card).toContain("View")
    expect(card).toContain("CATEGORY_LABEL")

    expect(page).toContain("function TemplateList")
    expect(page).toContain('title="Official"')
    expect(page).toContain('title="Trending"')
    expect(page).toContain('title="New"')
    const listFn = page.slice(page.indexOf("function TemplateList"), page.indexOf("function TemplateSection"))
    const sectionFn = page.slice(page.indexOf("function TemplateSection"), page.indexOf("function TemplateSkeleton"))
    expect(listFn).not.toContain("hideTrustBadge")
    expect(sectionFn).not.toContain("hideTrustBadge")
    expect(page).not.toMatch(/<ClawCard[\s\S]{0,400}hideTrustBadge/)
    expect(page).not.toMatch(/CommunityCard|NewTemplateCard|CommunityClawCard/)
    expect(page).toContain("category: t.category")

    expect(badge).toContain('label: "Auto-scanned"')
    expect(badge).toContain("whitespace-nowrap")
    expect(badge).toContain("max-h-[16px]")
    expect(badge).not.toContain('label: "Auto-scanned - automated checks passed"')
  })
})
