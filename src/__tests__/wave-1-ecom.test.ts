import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  ECOM_FIRST_MISSION_PROSE,
  INVENTED_CONVERSION_FIXTURE,
  INVENTED_ROAS_FIXTURE,
  ROAS_PAUSE_RULE,
} from "../../prisma/seed-data/wave-1-ecom"
import {
  CLAIMS_TABLE_STEP_MARKER,
  ECOM_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "@/lib/critic/claims-table"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"
import { AUTONOMOUS_CAPABLE_TOOLS } from "@/lib/openclaw/delivery-rail"

function ecom() {
  const t = ALL_TEMPLATES.find((x) => x.slug === "ecommerce-profit-maximizer")
  if (!t) throw new Error("ecommerce-profit-maximizer missing")
  return t
}

function agent(slug: string) {
  const a = ecom().agents.find((x) => x.agentSlug === slug)
  if (!a) throw new Error(slug)
  return a
}

describe("WAVE-1 E-Commerce Profit Maximizer prose contracts", () => {
  it("Store Operator personality, no factory philosophy, approval wording", () => {
    const soul = agent("store-commander").soulMd
    expect(soul).toContain("You are Store Operator")
    expect(soul).toContain("mini first-mission")
    expect(soul).toContain("drafted, awaiting your approval to change the price")
    expect(soul).toContain("Critic approval is not human approval")
    expect(soul).not.toContain("Profit margin is the only metric that matters")
    expect(soul).not.toContain("Every listing is a sales page")
    expect(agent("store-commander").heartbeatMd).toContain("Never a /home/node/.openclaw/ path")
  })

  it("interview covers store, margins, brands, channels", () => {
    const pack = getInterviewPack("ecommerce-profit-maximizer")!
    expect(pack.map((q) => q.id)).toEqual(
      expect.arrayContaining(["store", "margins", "brands", "channels"]),
    )
  })

  it("Listing Optimizer has SEO worked GOOD vs BAD examples", () => {
    const soul = agent("listing-optimizer").soulMd
    expect(soul).toContain("Listing SEO worked examples")
    expect(soul).toContain("GOOD title")
    expect(soul).toContain("BAD title")
    expect(soul).toContain("Benefit → Feature → Proof")
    expect(soul).toContain("Merino Crew Tee")
    expect(soul).toContain(INVENTED_CONVERSION_FIXTURE)
  })

  it("Pricing Intel has Buy-Box rules and never writes the price", () => {
    const soul = agent("pricing-intel").soulMd
    expect(soul).toContain("Buy-Box rules")
    expect(soul).toContain("Do not start a price war")
    expect(soul).toContain("Never PATCH Shopify")
    expect(soul).toContain("Price change is an ACTION")
  })

  it("Ad Optimizer encodes ROAS<1.0 48h as an ACTION", () => {
    const soul = agent("ad-optimizer").soulMd
    expect(soul).toContain(ROAS_PAUSE_RULE)
    expect(soul).toContain("ROAS below 1.0")
    expect(soul).toContain("ACTION")
    expect(soul).toContain(INVENTED_ROAS_FIXTURE)
    expect(soul).not.toContain("pause underperformers fast")
  })

  it("critic is margin-truth / listing-quality / policy-compliance / evidence", () => {
    const soul = agent("ecommerce-quality-gate").soulMd
    for (const dim of ECOM_CRITIC_SCORE_DIMENSIONS) {
      expect(soul).toContain(dim)
    }
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain("| Claim | Source |")
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).toContain(INVENTED_ROAS_FIXTURE)
    expect(soul).toContain(INVENTED_CONVERSION_FIXTURE)
    expect(soul).toMatch(/\bPASS\b/)
    expect(soul).toMatch(/\bREJECT\b/)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    const files = ecom().files ?? []
    for (const name of [
      "shared/SKUS.md",
      "shared/PRICING.md",
      "shared/ADS.md",
      "shared/deliverables/inventory-check.md",
      "shared/deliverables/pricing-recommendation.md",
      "shared/deliverables/listing-audit.md",
      "shared/deliverables/ad-review.md",
      "shared/deliverables/product-pnl.md",
    ]) {
      const file = files.find((f) => f.path === name)
      expect(file, name).toBeDefined()
      expect(file!.content.length).toBeLessThan(8000)
      expect(file!.content).toContain("## Schema")
      expect(file!.content).toContain("## Format")
      expect(file!.content).toContain("## Example")
      expect(file!.content).toContain("## Entries")
    }
  })

  it("five windows stay parseable with failure branches (MUTATION: drop DEGRADED → fail)", () => {
    const scripts = parseHeartbeatWindowScripts(agent("store-commander").heartbeatMd)
    expect(scripts).toHaveLength(5)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 12 * * 1-5",
      "0 14 * * 1-5",
      "0 16 * * 1-5",
      "0 18 * * 1-5",
      "0 20 * * 1-5",
    ])
    for (const script of scripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(3)
      expect(script.deliverable.length).toBeGreaterThan(0)
    }
    const md = agent("store-commander").heartbeatMd
    expect(md).toContain("DEGRADED")
    expect(md).toContain("Inventory check")
    expect(md).toContain("pricing")
    expect(md).toContain("listing")
    expect(md).toContain("ROAS")
    expect(md).toContain("P&L")
  })

  it("per-product P&L format is landed-cost complete", () => {
    const pnl = (ecom().files ?? []).find((f) => f.path === "shared/deliverables/product-pnl.md")
    expect(pnl?.content).toContain("COGS")
    expect(pnl?.content).toContain("fees")
    expect(pnl?.content).toContain("ads")
    expect(pnl?.content).toContain("contribution")
    expect(pnl?.content).toContain("tool:shopify")
  })

  it("shopify-store SKILL.md carries e-com craft and ACTION gating", () => {
    const shopify = ALL_SKILLS.find((s) => s.slug === "shopify-store")
    expect(shopify?.skillMd).toContain("E-com store-operator path")
    expect(shopify?.skillMd).toContain("http")
    expect(shopify?.skillMd).toContain("ACTION (approval-gated)")
    expect(shopify?.skillMd).toContain("X-Shopify-Access-Token")
    expect(shopify?.skillMd).toContain("ROAS 6.2 over 90 days (no campaign id)")
  })

  it("post-interview mini-mission is P&L + pricing + critic in the same session", () => {
    const pack = getInterviewPack("ecommerce-profit-maximizer")!
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: "ecommerce-profit-maximizer",
    })
    expect(pending).toContain(ECOM_FIRST_MISSION_PROSE)
    expect(pending).toContain("per-product P&L")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8; exec stays non-autonomous; pause is not a silent write", () => {
    expect(agent("ecommerce-quality-gate").qualityThreshold).toBe(8)
    expect(AUTONOMOUS_CAPABLE_TOOLS).not.toContain("shopify-store")
    expect(agent("ad-optimizer").soulMd).toContain("Never pause or raise budget without a human-approved ACTION card")
    expect(agent("store-commander").soulMd).toContain(ROAS_PAUSE_RULE)
  })

  it("MUTATION: invented ROAS / conversion fixtures stay in critic + writer", () => {
    expect(INVENTED_ROAS_FIXTURE).toContain("ROAS 6.2")
    expect(INVENTED_CONVERSION_FIXTURE).toContain("8.4%")
    expect(agent("ad-optimizer").soulMd).toContain(INVENTED_ROAS_FIXTURE)
    expect(agent("listing-optimizer").soulMd).toContain(INVENTED_CONVERSION_FIXTURE)
    expect(agent("ecommerce-quality-gate").soulMd).toContain(INVENTED_ROAS_FIXTURE)
    expect(agent("ecommerce-quality-gate").soulMd).toContain(INVENTED_CONVERSION_FIXTURE)
  })
})
