/**
 * PR-B runtime CI net (~30s, blocking).
 * /store + /e2e-truncation: hover [data-tooltip-trigger] → every tip is Radix-
 * wrapped with a VISIBLE svg arrow; zero rogue floating hover nodes.
 *
 * MUTATION: strip Arrow from DS → fails; inject rogue hover-div into fixture → fails.
 * Item-0 upgrade: force-bottom fixture asserts side=bottom + visible arrow.
 */
import { expect, test, type Page } from "@playwright/test"
import {
  countRogueFloatingHoverNodes,
  countRogueTooltipNodes,
  expectTooltipAnchored,
  expectTooltipArrowVisible,
} from "./helpers/tooltip-geometry"

function mockTemplate(i: number) {
  return {
    id: `e2e-tpl-${i}`,
    name: `Runtime Net Template ${i} With A Long Name`,
    slug: `runtime-net-template-${i}`,
    tagline: `Tagline ${i} that truncates and must tip via DS Tooltip`,
    description: "desc",
    category: "creator",
    price: 0,
    isFree: true,
    trustTier: "OFFICIAL",
    installCount: 10,
    avgRating: 4.5,
    estimatedMonthlyCost: null,
    creator: { id: "c1", displayName: "Claws", avatarUrl: null },
    agents: [{ name: "Worker", role: "WORKER", color: "#8BFCAE" }],
    flowDescription: "flow",
    legalDisclaimer: null,
  }
}

async function stubStoreCatalog(page: Page) {
  // Deterministic catalog so the net always has ≥5 triggers (name+tagline per card).
  await page.route("**/api/marketplace/templates**", async (route) => {
    const items = [1, 2, 3, 4].map(mockTemplate)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { items, nextCursor: null, totalCount: items.length },
      }),
    })
  })
  await page.route("**/api/marketplace/skills**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { items: [], nextCursor: null, totalCount: 0 },
      }),
    })
  })
}

async function assertCleanTipSurface(page: Page) {
  expect(await countRogueTooltipNodes(page)).toBe(0)
  expect(await countRogueFloatingHoverNodes(page)).toBe(0)
}

test.describe("tooltip runtime net (PR-B)", () => {
  test("store + truncation fixture: Radix tips, visible arrows, both flip sides", async ({
    page,
  }) => {
    test.setTimeout(30_000)
    await stubStoreCatalog(page)

    // ── /store: sample 5–8 triggers ─────────────────────────────────────
    await page.goto("/store")
    await expect(page.getByRole("link", { name: /Runtime Net Template/ }).first()).toBeVisible({
      timeout: 15_000,
    })
    const storeTriggers = page.locator("[data-tooltip-trigger]")
    await expect(storeTriggers.first()).toBeVisible({ timeout: 5_000 })
    const storeCount = await storeTriggers.count()
    expect(storeCount, "store should expose tooltip triggers").toBeGreaterThanOrEqual(5)
    const storeSample = Math.min(8, storeCount)
    for (let i = 0; i < storeSample; i++) {
      const trigger = storeTriggers.nth(i)
      if (!(await trigger.isVisible())) continue
      await trigger.scrollIntoViewIfNeeded()
      await trigger.hover()
      const tip = page.getByRole("tooltip")
      await expect(tip).toBeVisible({ timeout: 5_000 })
      await expectTooltipArrowVisible(tip)
      await assertCleanTipSurface(page)
      await page.mouse.move(0, 0)
    }

    // ── /e2e-truncation: conversation + force-bottom (side=bottom) ───────
    await page.goto("/e2e-truncation")

    const conversation = page
      .getByTestId("conversation-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, conversation, {
      content: /agent:twitter-commander/,
      expectedSide: "top",
    })
    await assertCleanTipSurface(page)

    // Near top viewport edge → Radix must flip to bottom; arrow still visible.
    const forceBottom = page
      .getByTestId("force-bottom-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, forceBottom, {
      content: /Force-bottom/,
      expectedSide: "bottom",
    })
    await assertCleanTipSurface(page)

    // Sidebar overflow list: mid-row tip must prefer top with viewport boundary.
    const midRow = page
      .getByTestId("sidebar-row-content-writer")
      .locator("[data-tooltip-trigger]")
      .first()
    await midRow.hover()
    const midTip = page.getByRole("tooltip")
    await expect(midTip).toBeVisible({ timeout: 5_000 })
    const midSide = await midTip.getAttribute("data-side")
    expect(midSide, "Content Writer mid-list tip should prefer top with viewport boundary").toBe(
      "top",
    )
    await expectTooltipArrowVisible(midTip, { expectedSide: "top" })
    await assertCleanTipSurface(page)
  })
})
