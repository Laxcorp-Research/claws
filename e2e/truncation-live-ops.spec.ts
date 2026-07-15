import { expect, test, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';
import { getOrCreateWorkspaceId } from './helpers/workspace';

/**
 * REAL-SURFACE RULE: Live Ops truncation on the actual dashboard.
 * Founder SS1/SS2: Social Content Reviewer tip OK; Trend & Topic Scanner tip
 * missing — closed by hover-time remasure + canvas fallback.
 */
const TREND = 'Trend & Topic Scanner';
const SOCIAL = 'Social Content Reviewer';

async function seedLiveOps(page: Page, workspaceId: string) {
  await page.route(`**/api/activity/${workspaceId}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          workspace: {
            id: workspaceId,
            name: 'E2E Truncation Workspace',
            status: 'RUNNING',
            healthStatus: 'HEALTHY',
            currentMonthApiCost: 0,
            apiSpendLimit: 100,
            costAlertThreshold: 80,
          },
          stats: {
            agentsRunning: 2,
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
              id: 'e2e-trend',
              name: TREND,
              role: 'WORKER',
              color: '#22c55e',
              model: 'anthropic/claude-sonnet-4-6',
              agentSlug: 'trend-topic-scanner',
              status: 'healthy',
              isPaused: false,
              pauseApplied: true,
            },
            {
              id: 'e2e-social',
              name: SOCIAL,
              role: 'CRITIC',
              color: '#a855f7',
              model: 'anthropic/claude-opus-4-6',
              agentSlug: 'social-content-reviewer',
              status: 'healthy',
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
    });
  });
}

async function expectTileTooltip(page: Page, fullName: string) {
  const tile = page.getByRole('article', {
    name: new RegExp(fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  });
  await expect(tile).toBeVisible();
  const name = tile.locator('h3').getByText(fullName);
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  const clipped = await name.evaluate((el) => {
    // Prefer visual ellipsis signal; scrollWidth can false-negative.
    const style = window.getComputedStyle(el);
    return (
      style.textOverflow === 'ellipsis' &&
      (el.scrollWidth > el.clientWidth || el.clientWidth < 400)
    );
  });
  expect(clipped).toBe(true);

  const trigger = tile.locator('h3 div.block.w-full').first();
  await trigger.hover();
  // Hover remasure must show tip even if data-truncated was stale false.
  await expect(page.getByRole('tooltip')).toContainText(fullName, { timeout: 5_000 });
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0, { timeout: 5_000 });
}

test.describe('Live Ops truncation (real dashboard)', () => {
  test('SS1+SS2: Social Content AND Trend & Topic both show tooltips', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);
    await seedLiveOps(page, workspaceId);

    await page.goto(`/dashboard/${workspaceId}`);
    await expect(page.getByRole('status', { name: 'Loading briefing' })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Live Ops' })).toBeVisible({
      timeout: 20_000,
    });

    // Order matches founder repro: working tile then previously-failing tile.
    await expectTileTooltip(page, SOCIAL);
    await expectTileTooltip(page, TREND);
  });
});
