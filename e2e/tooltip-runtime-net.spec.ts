/**
 * Tooltip runtime CI net (~30s, blocking) — closing round.
 * Nominal: truncated tips have Radix wrapper + arrow contact.
 * Negative: fitting text yields NO tooltip.
 * Forced-edge: containment; arrow may hide only with data-arrow-hidden=true.
 */
import { expect, test, type Page } from "@playwright/test"
import {
  countRogueFloatingHoverNodes,
  countRogueTooltipNodes,
  expectNoTooltip,
  expectTooltipAnchored,
  expectTooltipArrowVisible,
} from "./helpers/tooltip-geometry"

function mockTemplate(i: number) {
  return {
    id: `e2e-tpl-${i}`,
    name: `Runtime Net Template ${i} With A Long Name That Truncates`,
    slug: `runtime-net-template-${i}`,
    tagline: `Tagline ${i} that truncates and must tip via DS Tooltip on store cards`,
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

test.describe("tooltip runtime net (closing)", () => {
  test("store + fixture: contact, both flip sides, no tip on fitting text", async ({
    page,
  }) => {
    test.setTimeout(30_000)
    await stubStoreCatalog(page)

    // ── /store: truncated card tips with arrow contact ──────────────────
    await page.goto("/store")
    await expect(page.getByRole("link", { name: /Runtime Net Template/ }).first()).toBeVisible({
      timeout: 15_000,
    })
    // Wait for measure → data-truncated=true on a long name.
    await expect(
      page.locator("[data-tooltip-trigger]").first(),
    ).toBeVisible({ timeout: 5_000 })
    const storeTriggers = page.locator("[data-tooltip-trigger]")
    const storeCount = await storeTriggers.count()
    expect(storeCount, "store truncated tips").toBeGreaterThanOrEqual(5)
    const storeSample = Math.min(8, storeCount)
    for (let i = 0; i < storeSample; i++) {
      const trigger = storeTriggers.nth(i)
      if (!(await trigger.isVisible())) continue
      await trigger.scrollIntoViewIfNeeded()
      await expectTooltipAnchored(page, trigger)
      await assertCleanTipSurface(page)
      await page.mouse.move(0, 0)
    }

    // ── /e2e-truncation ─────────────────────────────────────────────────
    await page.goto("/e2e-truncation")

    // Negative: fitting text → NO tooltip (and no data-tooltip-trigger).
    const fitting = page.getByTestId("fitting-text-fixture").locator("[data-truncated='false']")
    await expect(fitting).toBeVisible()
    expect(await page.getByTestId("fitting-text-fixture").locator("[data-tooltip-trigger]").count()).toBe(0)
    await expectNoTooltip(page, fitting)

    const fittingSidebar = page
      .getByTestId("sidebar-fitting-content-writer")
      .locator("[data-truncated='false']")
    await expect(fittingSidebar).toBeVisible()
    expect(
      await page.getByTestId("sidebar-fitting-content-writer").locator("[data-tooltip-trigger]").count(),
    ).toBe(0)
    await expectNoTooltip(page, fittingSidebar)

    // Nominal truncated tip + contact.
    const truncated = page
      .getByTestId("truncated-text-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, truncated, {
      content: /intentionally longer/,
      expectedSide: "top",
    })
    await assertCleanTipSurface(page)

    const conversation = page
      .getByTestId("conversation-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, conversation, {
      content: /agent:twitter-commander/,
      expectedSide: "top",
    })
    await assertCleanTipSurface(page)

    // Force-bottom: side=bottom + contact (or data-arrow-hidden if unpointable).
    const forceBottom = page
      .getByTestId("force-bottom-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, forceBottom, {
      content: /Force-bottom/,
      expectedSide: "bottom",
      allowHiddenWhenUnpointable: true,
    })
    await assertCleanTipSurface(page)

    // Right-edge: containment; arrow may hide only with data-arrow-hidden.
    const rightEdge = page
      .getByTestId("right-edge-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await rightEdge.hover()
    const edgeTip = page.getByRole("tooltip")
    await expect(edgeTip).toBeVisible({ timeout: 5_000 })
    const tipBox = await edgeTip.boundingBox()
    const vp = page.viewportSize()!
    expect(tipBox!.x).toBeGreaterThanOrEqual(-0.5)
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(vp.width + 0.5)
    const hidden = (await edgeTip.getAttribute("data-arrow-hidden")) === "true"
    if (hidden) {
      expect(await edgeTip.getAttribute("data-arrow-hidden")).toBe("true")
    } else {
      await expectTooltipArrowVisible(edgeTip)
    }
    await assertCleanTipSurface(page)

    // Truncated sidebar row prefers top (viewport boundary).
    const midTrunc = page
      .getByTestId("sidebar-truncated-row-0")
      .locator("[data-tooltip-trigger]")
      .first()
    await midTrunc.hover()
    const midTip = page.getByRole("tooltip")
    await expect(midTip).toBeVisible({ timeout: 5_000 })
    expect(await midTip.getAttribute("data-side")).toBe("top")
    await expectTooltipArrowVisible(midTip, { expectedSide: "top" })
    await assertCleanTipSurface(page)
  })
})
