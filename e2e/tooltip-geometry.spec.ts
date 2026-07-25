import { expect, test } from "@playwright/test"
import { signInAsOnboardingUser, signInAsTestUser } from "./helpers/auth"
import { expectTooltipAnchored } from "./helpers/tooltip-geometry"
import { getOrCreateWorkspaceId } from "./helpers/workspace"

const TREND = "Trend & Topic Scanner"
const LONG_SESSION_KEY =
  "agent:twitter-commander:subagent:151eda19-a0c9-49de-969d-ed39d16fe21c"

/**
 * Platform tooltip geometry — REAL surfaces + highest-risk fixtures.
 * Uses expectTooltipAnchored (adjacency ≤12px + viewport containment).
 */
test.describe("tooltip geometry (class-kill)", () => {
  test("step-3 picker row TruncateWithTooltip is anchored", async ({ page }) => {
    test.setTimeout(90_000)
    await signInAsOnboardingUser(page, "/onboarding")
    await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible()

    await expect(page.getByRole("button", { name: "Create custom Claw" })).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: "Create custom Claw" }).click()
    await page.waitForURL(/\/builder\//, { timeout: 60_000 })

    await page.goto("/onboarding")
    await expect(page.getByText(/Claw created/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: /Set up & deploy/ }).click()
    await expect(page.getByText("Choose a Claw to set up")).toBeVisible()

    // Trigger = DS Tooltip wrapper around the claw name (full-width flex cell).
    const row = page.locator("ul").getByRole("button").filter({ hasText: /My Claw/ }).first()
    await expect(row).toBeVisible()
    const trigger = row.locator("[data-tooltip-trigger]").first()
    await expectTooltipAnchored(page, trigger, { content: /My Claw/ })
  })

  test("dashboard Live Ops TruncatedText is anchored", async ({ page }) => {
    await signInAsTestUser(page)
    const workspaceId = await getOrCreateWorkspaceId(page)

    await page.route(`**/api/activity/${workspaceId}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            workspace: {
              id: workspaceId,
              name: "E2E Geometry Workspace",
              status: "RUNNING",
              healthStatus: "HEALTHY",
              currentMonthApiCost: 0,
              apiSpendLimit: 100,
              costAlertThreshold: 80,
            },
            stats: {
              agentsRunning: 1,
              agentsPaused: 0,
              agentsError: 0,
              agentsOffline: 0,
              agentsDegraded: 0,
              tasksToday: 0,
              tasksYesterday: 0,
              apiCostThisMonth: 0,
              apiCostProjected: 0,
              estimatedCostToday: 0,
              estimatedCostTodayCalls: 0,
              pendingReview: 0,
            },
            agents: [
              {
                id: "e2e-trend",
                name: TREND,
                role: "WORKER",
                color: "#22c55e",
                model: "anthropic/claude-sonnet-4-6",
                agentSlug: "trend-topic-scanner",
                status: "healthy",
                isPaused: false,
                pauseApplied: true,
              },
            ],
            recentLogs: [],
            pendingApprovals: [],
            spend: null,
            expiredTools: [],
            activityPage: { nextCursor: null, hasMore: false },
          },
        }),
      })
    })

    await page.goto(`/dashboard/${workspaceId}`)
    await expect(page.getByRole("heading", { name: "Live Ops" })).toBeVisible({
      timeout: 20_000,
    })
    const tile = page.getByRole("article", { name: new RegExp(TREND) })
    const trigger = tile.locator("h3 [data-tooltip-trigger]").first()
    await expectTooltipAnchored(page, trigger, { content: TREND })
  })

  test("conversation-key TruncatedText is anchored", async ({ page }) => {
    await page.goto("/e2e-truncation")
    const trigger = page
      .getByTestId("conversation-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, trigger, { content: LONG_SESSION_KEY })
  })

  test("scroll-container TruncatedText portals without clip (highest-risk)", async ({
    page,
  }) => {
    await page.goto("/e2e-truncation")
    const trigger = page
      .getByTestId("scroll-clip-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, trigger, {
      content: /Scroll-container clipped name/,
    })
  })

  test("near-right viewport edge: tip stays contained (collision flip/shift)", async ({
    page,
  }) => {
    await page.goto("/e2e-truncation")
    const trigger = page
      .getByTestId("right-edge-fixture")
      .locator("[data-tooltip-trigger]")
      .first()
    await expectTooltipAnchored(page, trigger, {
      content: /Right-edge collision/,
      // Edge shift may leave arrow unpointable — native hide is OK with attribute.
      allowHiddenWhenUnpointable: true,
    })
  })
})
