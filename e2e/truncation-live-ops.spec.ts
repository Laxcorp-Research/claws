import { expect, test } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';
import { getOrCreateWorkspaceId } from './helpers/workspace';

/**
 * REAL-SURFACE RULE: Live Ops tile truncation must be asserted on the actual
 * dashboard route — not only /e2e-truncation. Synthetic fixture remains a
 * supplement in truncation.spec.ts.
 */
const LONG_AGENT_NAME =
  'Trend & Topic Scouting Agent With An Extremely Long Strategic Name';

test.describe('Live Ops truncation (real dashboard)', () => {
  test('Overview Live Ops tile: long name ellipsizes and shows tooltip', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    // Seed long names onto whatever agents the activity payload returns (or
    // inject a worker tile if the workspace has none yet).
    await page.route(`**/api/activity/${workspaceId}**`, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as {
        success?: boolean;
        data?: {
          agents?: Array<Record<string, unknown>>;
          workspace?: Record<string, unknown>;
          stats?: Record<string, unknown>;
          recentLogs?: unknown[];
          pendingApprovals?: unknown[];
        };
      };
      if (json.data) {
        // Force a non-empty dashboard so Live Ops mounts (not the empty path).
        if (json.data.workspace) {
          json.data.workspace = {
            ...json.data.workspace,
            status: 'RUNNING',
            healthStatus: json.data.workspace.healthStatus ?? 'HEALTHY',
          };
        }
        const agents = Array.isArray(json.data.agents) ? [...json.data.agents] : [];
        if (agents.length === 0) {
          agents.push({
            id: 'e2e-long-agent',
            name: LONG_AGENT_NAME,
            role: 'WORKER',
            color: '#8BFCAE',
            model: 'anthropic/claude-sonnet-4-6',
            agentSlug: 'trend-topic-scouting',
            status: 'healthy',
            isPaused: false,
            pauseApplied: true,
          });
        } else {
          agents[0] = { ...agents[0], name: LONG_AGENT_NAME };
        }
        json.data.agents = agents;
        if (!json.data.stats) {
          json.data.stats = {
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
          };
        }
        if (!Array.isArray(json.data.recentLogs)) json.data.recentLogs = [];
        if (!Array.isArray(json.data.pendingApprovals)) json.data.pendingApprovals = [];
      }
      await route.fulfill({
        status: response.status(),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(json),
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

    // The ellipsized text node inside the Live Ops name row.
    const name = tile.locator('h3').getByText(LONG_AGENT_NAME);
    await expect(name).toBeVisible();
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(true);

    // Hover the width-stable tooltip trigger (parent of the text node).
    const trigger = tile.locator('h3 div.block.w-full').first();
    await trigger.hover();
    await expect(page.getByRole('tooltip')).toContainText(LONG_AGENT_NAME, {
      timeout: 5_000,
    });
  });
});
