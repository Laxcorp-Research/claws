import { expect, test } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';
import { getOrCreateWorkspaceId } from './helpers/workspace';

/**
 * REAL-SURFACE RULE: Live Ops tile truncation must be asserted on the actual
 * dashboard route — not only /e2e-truncation. Synthetic fixture remains a
 * supplement in truncation.spec.ts.
 *
 * Pre-fix evidence: prior suite only greened /e2e-truncation while founder
 * repro on Overview Live Ops showed ellipsis with no tooltip (fixture-tested-
 * not-product + overflow remasure gap).
 */
const LONG_AGENT_NAME =
  'Trend & Topic Scouting Agent With An Extremely Long Strategic Name';

test.describe('Live Ops truncation (real dashboard)', () => {
  test('Overview Live Ops tile: long name ellipsizes and shows tooltip', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    // Fulfill without route.fetch — passthrough hangs under CI timeouts.
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
                id: 'e2e-long-agent',
                name: LONG_AGENT_NAME,
                role: 'WORKER',
                color: '#8BFCAE',
                model: 'anthropic/claude-sonnet-4-6',
                agentSlug: 'trend-topic-scouting',
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

    await page.goto(`/dashboard/${workspaceId}`);
    await expect(page.getByRole('status', { name: 'Loading briefing' })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Live Ops' })).toBeVisible({
      timeout: 20_000,
    });

    const tile = page.getByRole('article', {
      name: new RegExp(LONG_AGENT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    });
    await expect(tile).toBeVisible();

    const name = tile.locator('h3').getByText(LONG_AGENT_NAME);
    await expect(name).toBeVisible();
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(true);

    // Wait for TruncatedText overflow remasure (fonts / double-rAF).
    await expect(name).toHaveAttribute('data-truncated', 'true', { timeout: 5_000 });

    const trigger = tile.locator('h3 div.block.w-full').first();
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toContainText(LONG_AGENT_NAME, {
      timeout: 5_000,
    });
  });
});
