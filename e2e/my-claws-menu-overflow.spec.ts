import { expect, test, type Page } from "@playwright/test"
import { signInAsTestUser } from "./helpers/auth"

type StubWorkspace = {
  id: string
  name: string
  status: string
  updatedAt: string
  currentMonthApiCost: number
  clawTemplateId: string | null
  clawTemplate: null
  agents: { role: string }[]
  _count: { agents: number }
}

function stubWorkspace(id: string, name: string, status: string): StubWorkspace {
  return {
    id,
    name,
    status,
    updatedAt: new Date().toISOString(),
    currentMonthApiCost: 0,
    clawTemplateId: null,
    clawTemplate: null,
    agents: [{ role: "ORCHESTRATOR" }, { role: "WORKER" }, { role: "CRITIC" }],
    _count: { agents: 3 },
  }
}

/** Nine cards (3×3) so the last row sits near the viewport bottom on a short window. */
function stubList(): StubWorkspace[] {
  const statuses = [
    "RUNNING",
    "RUNNING",
    "HIBERNATED",
    "STOPPED",
    "DRAFT",
    "ERROR",
    "SETUP_INCOMPLETE",
    "RUNNING",
    "RUNNING",
  ]
  return statuses.map((status, i) =>
    stubWorkspace(`e2e-ws-${i + 1}`, `E2E Claw ${i + 1}`, status),
  )
}

async function stubMyClawsApis(page: Page) {
  const list = stubList()
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: list }),
    })
  })
  await page.route("**/api/creator/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: null }),
    })
  })
}

test.describe("My Claws menu overflow + status filter pills", () => {
  // Short viewport so the bottom-row card has insufficient space below for the menu.
  test.use({ viewport: { width: 1280, height: 520 } })

  test("bottom-row … menu flips into viewport; document scrollHeight does not grow", async ({
    page,
  }) => {
    await signInAsTestUser(page)
    await stubMyClawsApis(page)
    await page.goto("/my-claws")

    const lastCard = page.getByRole("button").filter({ hasText: "E2E Claw 9" })
    await expect(lastCard).toBeVisible({ timeout: 15_000 })

    const menuBtn = lastCard.getByRole("button", { name: "Workspace options" })
    // Pin trigger to the bottom edge so preferred side=bottom collides.
    await menuBtn.evaluate((el) => {
      el.scrollIntoView({ block: "end", inline: "nearest" })
    })

    const scrollBefore = await page.evaluate(() => document.documentElement.scrollHeight)

    await menuBtn.click()

    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()

    const box = await menu.boundingBox()
    expect(box).toBeTruthy()
    const vp = page.viewportSize()!
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1)

    // Flipped upward when space below is tight (Radix data-side=top).
    await expect(menu).toHaveAttribute("data-side", "top")

    const scrollAfter = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(scrollAfter).toBeLessThanOrEqual(scrollBefore)
  })

  test("Sleeping + Stopped pills render and filter card-visible statuses", async ({ page }) => {
    await signInAsTestUser(page)
    await stubMyClawsApis(page)
    await page.goto("/my-claws")

    // exact:true — cards also expose status badge text in their accessible name.
    const sleepingPill = page.getByRole("button", { name: "Sleeping", exact: true })
    const stoppedPill = page.getByRole("button", { name: "Stopped", exact: true })
    await expect(sleepingPill).toBeVisible({ timeout: 15_000 })
    await expect(stoppedPill).toBeVisible()

    await sleepingPill.click()
    await expect(page.getByText("E2E Claw 3")).toBeVisible()
    await expect(page.getByText("E2E Claw 1")).toHaveCount(0)
    await expect(page.getByText("E2E Claw 4")).toHaveCount(0)

    await stoppedPill.click()
    await expect(page.getByText("E2E Claw 4")).toBeVisible()
    await expect(page.getByText("E2E Claw 3")).toHaveCount(0)
    await expect(page.getByText("E2E Claw 1")).toHaveCount(0)
  })
})
