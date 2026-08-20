import { expect, test, type Page } from "@playwright/test"

/**
 * C4-a/C4-b: real template + skill detail pages.
 * Stubs purchase/install so the Reviews CTA is on the real surface without
 * inventing a checkout e2e.
 */

const TEMPLATE_SLUG = "e2e-review-cta-template"
const SKILL_SLUG = "e2e-review-cta-skill"

function templatePayload(reviews: Array<Record<string, unknown>>) {
  return {
    success: true,
    data: {
      template: {
        id: "tpl-e2e-review",
        name: "test template 4",
        slug: TEMPLATE_SLUG,
        tagline: "Tagline",
        description: "Description",
        category: "CREATOR",
        price: 0,
        isFree: true,
        trustTier: "OFFICIAL",
        installCount: 1,
        avgRating: reviews.length ? 5 : null,
        estimatedMonthlyCost: "40",
        agentCount: 1,
        version: 1,
        creatorId: null,
        creator: null,
        agents: [
          { name: "Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "m", roleDescription: "r" },
        ],
        tools: { required: [], recommended: [] },
        flowDescription: "Flow",
        legalDisclaimer: null,
      },
      reviews,
      reviewCount: reviews.length,
      installCount: 1,
      similar: [],
      hasPurchased: true,
      isOwner: false,
    },
  }
}

function skillPayload(reviews: Array<Record<string, unknown>>) {
  return {
    success: true,
    data: {
      skill: {
        id: "sk-e2e-review",
        slug: SKILL_SLUG,
        name: "Test Skill",
        emoji: null,
        description: "A skill",
        category: "utility",
        trustTier: "OFFICIAL",
        isFree: true,
        price: 0,
        installCount: 1,
        avgRating: reviews.length ? 5 : null,
        skillMd: "# Skill",
        requiredBins: [],
        requiredEnvVars: [],
        minOpenClawVersion: null,
        creator: null,
        publishedAt: "2026-08-01T00:00:00.000Z",
      },
      reviews,
      reviewCount: reviews.length,
      installStatus: {
        installed: true,
        hasPurchased: true,
        hasRunningWorkspaces: true,
        workspaces: [],
      },
      isOwner: false,
    },
  }
}

const ONE_REVIEW = {
  id: "rev-1",
  userName: "Alex",
  rating: 5,
  title: "Great",
  body: "Works",
  verifiedInstall: true,
  createdAt: "2026-08-01T00:00:00.000Z",
}

async function stubTemplate(page: Page, reviews: Array<Record<string, unknown>>) {
  await page.route(`**/api/marketplace/templates/${TEMPLATE_SLUG}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(templatePayload(reviews)),
    })
  })
}

async function stubSkill(page: Page, reviews: Array<Record<string, unknown>>) {
  await page.route(`**/api/marketplace/skills/${SKILL_SLUG}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(skillPayload(reviews)),
    })
  })
}

async function expectWriteReviewFindable(page: Page) {
  const cta = page.getByTestId("write-review-cta")
  await expect(cta).toBeVisible()
  await expect(cta).toHaveText("Write a review")
  const metrics = await cta.evaluate((el) => {
    const styles = getComputedStyle(el)
    return {
      fontSize: styles.fontSize,
      visibility: styles.visibility,
      display: styles.display,
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
    }
  })
  expect(metrics.visibility).toBe("visible")
  expect(metrics.display).not.toBe("none")
  expect(metrics.fontSize).toBe("11px")
  expect(metrics.width).toBeGreaterThan(80)
  expect(metrics.height).toBeGreaterThan(22)
}

test.describe("C4 store review CTA + modal focus", () => {
  test("template empty Reviews: Write a review is visible at DS default 11px", async ({ page }) => {
    await stubTemplate(page, [])
    await page.goto(`/store/${TEMPLATE_SLUG}`)
    await expect(page.getByText("No reviews yet. Be the first!")).toBeVisible()
    await expectWriteReviewFindable(page)
  })

  test("template with reviews: Write a review stays findable at 11px", async ({ page }) => {
    await stubTemplate(page, [ONE_REVIEW])
    await page.goto(`/store/${TEMPLATE_SLUG}`)
    await expect(page.getByText("Great")).toBeVisible()
    await expectWriteReviewFindable(page)
  })

  test("skill empty Reviews: Write a review is visible at DS default 11px", async ({ page }) => {
    await stubSkill(page, [])
    await page.goto(`/store/skills/${SKILL_SLUG}`)
    await expect(page.getByText("No reviews yet. Be the first!")).toBeVisible()
    await expectWriteReviewFindable(page)
  })

  test("skill with reviews: Write a review stays findable at 11px", async ({ page }) => {
    await stubSkill(page, [ONE_REVIEW])
    await page.goto(`/store/skills/${SKILL_SLUG}`)
    await expect(page.getByText("Great")).toBeVisible()
    await expectWriteReviewFindable(page)
  })

  test("template review modal: typing Title/Review does not steal focus to stars", async ({ page }) => {
    await stubTemplate(page, [])
    await page.goto(`/store/${TEMPLATE_SLUG}`)
    await page.getByTestId("write-review-cta").click()
    const dialog = page.getByRole("dialog", { name: "Write a Review" })
    await expect(dialog).toBeVisible()

    await page.getByRole("radio", { name: "1 star" }).click()
    await expect(page.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true")

    const title = page.getByPlaceholder("Summarize your experience")
    await title.click()
    await title.pressSequentially("TESTTESTTE")
    await expect(title).toBeFocused()
    await expect(title).toHaveValue("TESTTESTTE")
    await expect(page.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true")

    const body = page.getByPlaceholder("Share your experience with this template...")
    await body.click()
    await body.pressSequentially("HELLOHELLO")
    await expect(body).toBeFocused()
    await expect(body).toHaveValue("HELLOHELLO")
    await expect(page.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true")
  })
})
