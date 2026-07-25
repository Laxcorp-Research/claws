import { expect, type Locator, type Page } from "@playwright/test"

export type Box = { x: number; y: number; width: number; height: number }

/** Nearest-edge gap between two axis-aligned boxes (0 if overlapping). */
export function nearestEdgeDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.hypot(dx, dy)
}

/**
 * Assert tip is Radix-anchored AND arrow is VISIBLE (nonzero rendered box,
 * visibility ≠ hidden). Covers Item-0 flip-side defect: arrow present-in-DOM
 * but visibility:hidden after shift still fails.
 *
 * MUTATION: strip `<Arrow>` from DS → fails. force side=bottom + strip → fails.
 */
export async function expectTooltipArrowVisible(
  tip: Locator,
  opts?: { expectedSide?: "top" | "bottom" | "left" | "right" },
): Promise<void> {
  const inRadix = await tip.evaluate(
    (el) => el.closest("[data-radix-popper-content-wrapper]") !== null,
  )
  expect(inRadix, "tooltip must live under [data-radix-popper-content-wrapper]").toBe(true)

  if (opts?.expectedSide) {
    const side = await tip.getAttribute("data-side")
    expect(side, `expected data-side=${opts.expectedSide}`).toBe(opts.expectedSide)
  }

  const arrow = tip.locator("svg").first()
  await expect(arrow, "tooltip arrow svg in DOM").toHaveCount(1)

  const metrics = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
      width: r.width,
      height: r.height,
    }
  })
  expect(metrics.visibility, "arrow must not be visibility:hidden").not.toBe("hidden")
  expect(metrics.opacity, "arrow opacity").toBeGreaterThan(0)
  expect(metrics.width, "arrow rendered width").toBeGreaterThan(0)
  expect(metrics.height, "arrow rendered height").toBeGreaterThan(0)
}

/**
 * Hover trigger → tip visible → nearest-edge ≤ 12px (any side; flip legal)
 * AND tip fully inside the viewport AND arrow visible on whichever side Radix chose.
 *
 * MUTATION: portal into a transformed ancestor or sideOffset={0} with a
 * large intentional miss → adjacency fails. avoidCollisions={false} near
 * a viewport edge → containment fails. strip Arrow → arrow-visible fails.
 */
export async function expectTooltipAnchored(
  page: Page,
  trigger: Locator,
  opts?: {
    content?: string | RegExp
    maxGapPx?: number
    expectedSide?: "top" | "bottom" | "left" | "right"
  },
): Promise<void> {
  const maxGap = opts?.maxGapPx ?? 12
  await expect(trigger).toBeVisible()
  await trigger.hover()
  const tip = page.getByRole("tooltip")
  await expect(tip).toBeVisible({ timeout: 5_000 })
  if (opts?.content !== undefined) {
    await expect(tip).toContainText(opts.content)
  }

  const tipBox = await tip.boundingBox()
  const triggerBox = await trigger.boundingBox()
  expect(tipBox, "tooltip bounding box").toBeTruthy()
  expect(triggerBox, "trigger bounding box").toBeTruthy()

  const gap = nearestEdgeDistance(tipBox!, triggerBox!)
  expect(
    gap,
    `tooltip nearest-edge gap ${gap}px exceeds ${maxGap}px (tip=${JSON.stringify(tipBox)} trigger=${JSON.stringify(triggerBox)})`,
  ).toBeLessThanOrEqual(maxGap)

  const vp = page.viewportSize()
  expect(vp, "viewport size").toBeTruthy()
  // Allow sub-pixel rounding at edges.
  expect(tipBox!.x).toBeGreaterThanOrEqual(-0.5)
  expect(tipBox!.y).toBeGreaterThanOrEqual(-0.5)
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(vp!.width + 0.5)
  expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(vp!.height + 0.5)

  await expectTooltipArrowVisible(tip, { expectedSide: opts?.expectedSide })
}

/**
 * Count [role=tooltip] nodes that are NOT under a Radix popper wrapper.
 * Used by the runtime CI net — must stay 0 while tips are open.
 */
export async function countRogueTooltipNodes(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tips = Array.from(document.querySelectorAll('[role="tooltip"]'))
    return tips.filter((el) => el.closest("[data-radix-popper-content-wrapper]") === null)
      .length
  })
}

/**
 * Floating hover-label shells (fixed/absolute + high z + pointer-events-none)
 * that are NOT Radix popper content — must stay 0.
 */
export async function countRogueFloatingHoverNodes(page: Page): Promise<number> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("body *"))
    let n = 0
    for (const el of all) {
      if (el.closest("[data-radix-popper-content-wrapper]")) continue
      const style = getComputedStyle(el)
      if (style.pointerEvents !== "none") continue
      if (style.position !== "fixed" && style.position !== "absolute") continue
      const z = Number(style.zIndex)
      if (!Number.isFinite(z) || z < 50) continue
      // Tip-sized text bubble heuristic (exclude full-screen overlays).
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      if (r.width > 480 || r.height > 200) continue
      if ((el.textContent ?? "").trim().length === 0) continue
      n += 1
    }
    return n
  })
}
