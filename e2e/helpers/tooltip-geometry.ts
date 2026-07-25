import { expect, type Locator, type Page } from "@playwright/test"

export type Box = { x: number; y: number; width: number; height: number }

/** Nearest-edge gap between two axis-aligned boxes (0 if overlapping). */
export function nearestEdgeDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.hypot(dx, dy)
}

/** Shared-edge gap along one axis (0 if overlapping or touching). */
function axisGap(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1
  if (b1 < a0) return a0 - b1
  return 0
}

/**
 * Assert tip is Radix-anchored AND arrow is VISIBLE with contact:
 * - nonzero rendered box, visibility ≠ hidden
 * - arrow abuts content box on the trigger-facing side (≤1px)
 * - arrow lies on the trigger-facing side of the tip
 *
 * MUTATION: strip `<Arrow>` → fails. restore w-full trigger → contact fails.
 */
export async function expectTooltipArrowVisible(
  tip: Locator,
  opts?: {
    expectedSide?: "top" | "bottom" | "left" | "right"
    /** When true, allow Radix hide-on-unpointable (`data-arrow-hidden=true`). */
    allowHiddenWhenUnpointable?: boolean
  },
): Promise<void> {
  const inRadix = await tip.evaluate(
    (el) => el.closest("[data-radix-popper-content-wrapper]") !== null,
  )
  expect(inRadix, "tooltip must live under [data-radix-popper-content-wrapper]").toBe(true)

  const side =
    opts?.expectedSide ??
    ((await tip.getAttribute("data-side")) as "top" | "bottom" | "left" | "right" | null)
  if (opts?.expectedSide) {
    expect(side, `expected data-side=${opts.expectedSide}`).toBe(opts.expectedSide)
  }

  const arrowHidden = (await tip.getAttribute("data-arrow-hidden")) === "true"
  if (opts?.allowHiddenWhenUnpointable && arrowHidden) {
    // Forced-edge: arrow may hide only when Radix marks unpointable.
    expect(await tip.getAttribute("data-arrow-hidden")).toBe("true")
    return
  }

  const arrow = tip.locator("svg").first()
  await expect(arrow, "tooltip arrow svg in DOM").toHaveCount(1)

  const metrics = await arrow.evaluate((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }
  })
  expect(metrics.visibility, "arrow must not be visibility:hidden").not.toBe("hidden")
  expect(metrics.opacity, "arrow opacity").toBeGreaterThan(0)
  expect(metrics.width, "arrow rendered width").toBeGreaterThan(0)
  expect(metrics.height, "arrow rendered height").toBeGreaterThan(0)

  const tipBox = await tip.boundingBox()
  expect(tipBox, "tooltip content box").toBeTruthy()

  // Arrow-abuts-box (≤1px) on the trigger-facing side.
  const contactGap =
    side === "top"
      ? axisGap(tipBox!.y, tipBox!.y + tipBox!.height, metrics.y, metrics.y + metrics.height)
      : side === "bottom"
        ? axisGap(tipBox!.y, tipBox!.y + tipBox!.height, metrics.y, metrics.y + metrics.height)
        : side === "left"
          ? axisGap(tipBox!.x, tipBox!.x + tipBox!.width, metrics.x, metrics.x + metrics.width)
          : axisGap(tipBox!.x, tipBox!.x + tipBox!.width, metrics.x, metrics.x + metrics.width)

  expect(
    contactGap,
    `arrow↔content contact gap ${contactGap}px exceeds 1px (side=${side})`,
  ).toBeLessThanOrEqual(1)

  // Arrow on the trigger-facing side of the tip.
  if (side === "top") {
    expect(metrics.y + metrics.height / 2, "arrow below tip for side=top").toBeGreaterThanOrEqual(
      tipBox!.y + tipBox!.height - 1,
    )
  } else if (side === "bottom") {
    expect(metrics.y + metrics.height / 2, "arrow above tip for side=bottom").toBeLessThanOrEqual(
      tipBox!.y + 1,
    )
  } else if (side === "left") {
    expect(metrics.x + metrics.width / 2, "arrow right of tip for side=left").toBeGreaterThanOrEqual(
      tipBox!.x + tipBox!.width - 1,
    )
  } else if (side === "right") {
    expect(metrics.x + metrics.width / 2, "arrow left of tip for side=right").toBeLessThanOrEqual(
      tipBox!.x + 1,
    )
  }

  expect(await tip.getAttribute("data-arrow-visible")).toBe("true")
  expect(await tip.getAttribute("data-arrow-hidden")).toBe("false")
}

/**
 * Hover trigger → tip visible → nearest-edge ≤ 12px (any side; flip legal)
 * AND tip fully inside the viewport AND arrow contact on the facing side.
 */
export async function expectTooltipAnchored(
  page: Page,
  trigger: Locator,
  opts?: {
    content?: string | RegExp
    maxGapPx?: number
    expectedSide?: "top" | "bottom" | "left" | "right"
    allowHiddenWhenUnpointable?: boolean
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
  expect(tipBox!.x).toBeGreaterThanOrEqual(-0.5)
  expect(tipBox!.y).toBeGreaterThanOrEqual(-0.5)
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(vp!.width + 0.5)
  expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(vp!.height + 0.5)

  await expectTooltipArrowVisible(tip, {
    expectedSide: opts?.expectedSide,
    allowHiddenWhenUnpointable: opts?.allowHiddenWhenUnpointable,
  })
}

/** Hover a surface and assert NO role=tooltip appears. */
export async function expectNoTooltip(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  await target.hover()
  await page.waitForTimeout(400)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
}

export async function countRogueTooltipNodes(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tips = Array.from(document.querySelectorAll('[role="tooltip"]'))
    return tips.filter((el) => el.closest("[data-radix-popper-content-wrapper]") === null)
      .length
  })
}

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
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      if (r.width > 480 || r.height > 200) continue
      if ((el.textContent ?? "").trim().length === 0) continue
      n += 1
    }
    return n
  })
}
