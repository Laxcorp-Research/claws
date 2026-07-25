import { expect, type Locator, type Page } from "@playwright/test"

export type Box = { x: number; y: number; width: number; height: number }

/** Nearest-edge gap between two axis-aligned boxes (0 if overlapping). */
export function nearestEdgeDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.hypot(dx, dy)
}

/**
 * Hover trigger → tip visible → nearest-edge ≤ 12px (any side; flip legal)
 * AND tip fully inside the viewport.
 *
 * MUTATION: portal into a transformed ancestor or sideOffset={0} with a
 * large intentional miss → adjacency fails. avoidCollisions={false} near
 * a viewport edge → containment fails.
 */
export async function expectTooltipAnchored(
  page: Page,
  trigger: Locator,
  opts?: { content?: string | RegExp; maxGapPx?: number },
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
}
