import { expect, test } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';
import { getOrCreateWorkspaceId } from './helpers/workspace';

/**
 * REAL-SURFACE RULE: chat viewport bound must be asserted on the actual
 * dashboard Chat tab. /e2e-chat-viewport remains a dense-message supplement.
 */
test.describe('Chat viewport bound (PR-A §6)', () => {
  test('REAL dashboard Chat tab: pane uses max-h viewport bound', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    await page.route(`**/api/activity/${workspaceId}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            workspace: {
              id: workspaceId,
              name: 'E2E Chat Workspace',
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
                id: 'e2e-orch',
                name: 'Orchestrator',
                role: 'ORCHESTRATOR',
                color: '#8BFCAE',
                model: 'anthropic/claude-sonnet-4-6',
                agentSlug: 'orchestrator',
                status: 'healthy',
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

    // Stub ancillary dashboard fetches so the Chat tab can mount.
    await page.route(`**/api/deploy/${workspaceId}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{}}' }),
    );
    await page.route(`**/api/channels/${workspaceId}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"success":true,"data":{"configuredChannelIds":[],"channels":{}}}',
      }),
    );

    await page.goto(`/dashboard/${workspaceId}?tab=chat`);
    await expect(page.getByRole('status', { name: 'Loading briefing' })).toHaveCount(0, {
      timeout: 20_000,
    });
    const pane = page.getByRole('region', { name: 'Web chat' });
    await expect(pane).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveClass(/max-h-\[calc\(100vh-260px\)\]/);
    const paneBottom = await pane.evaluate((el) => el.getBoundingClientRect().bottom);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(paneBottom).toBeLessThanOrEqual(viewportHeight - 8);
  });

  test('SUPPLEMENT fixture: 30+ messages pane scrolls without inflating document', async ({ page }) => {
    await page.goto('/e2e-chat-viewport');
    const pane = page.getByRole('region', { name: 'Web chat' });
    const log = page.getByRole('log', { name: 'Chat messages' });
    await expect(pane).toBeVisible();
    await expect(log).toBeVisible();

    const metrics = await page.evaluate(() => {
      const paneEl = document.querySelector('[aria-label="Web chat"]') as HTMLElement | null;
      const logEl = document.querySelector('[aria-label="Chat messages"]') as HTMLElement | null;
      if (!paneEl || !logEl) return null;
      const paneRect = paneEl.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        paneBottom: paneRect.bottom,
        documentHeight: document.documentElement.scrollHeight,
        logScrollHeight: logEl.scrollHeight,
        logClientHeight: logEl.clientHeight,
        paneMaxHeightClass: paneEl.className.includes('max-h-[calc(100vh-260px)]'),
        paneOverflowHidden: paneEl.className.includes('overflow-hidden'),
        workingVisible: Boolean(document.querySelector('[data-working-indicator]')),
      };
    });

    expect(metrics).toBeTruthy();
    expect(metrics!.paneMaxHeightClass).toBe(true);
    expect(metrics!.paneOverflowHidden).toBe(true);
    expect(metrics!.workingVisible).toBe(true);
    expect(metrics!.paneBottom).toBeLessThanOrEqual(metrics!.viewportHeight - 8);
    expect(metrics!.documentHeight).toBeLessThanOrEqual(metrics!.viewportHeight + 80);
    expect(metrics!.logScrollHeight).toBeGreaterThan(metrics!.logClientHeight);

    await log.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const scrolled = await log.evaluate((el) => el.scrollTop > 0);
    expect(scrolled).toBe(true);
  });
});
