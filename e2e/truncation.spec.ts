import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectTooltipAnchored } from './helpers/tooltip-geometry';

/**
 * REAL-SURFACE RULE: primary Live Ops truncation coverage lives in
 * e2e/truncation-live-ops.spec.ts (real /dashboard/:id Overview tile).
 * This file keeps the synthetic /e2e-truncation page as a supplement.
 */
const LONG_AGENT_NAME = 'Extremely Long Strategic Research Agent Name That Must Ellipsize';

async function expectEllipsisAndTooltip(page: Page, locator: Locator, text: string) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS('text-overflow', 'ellipsis');
  const clipped = await locator.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
  await locator.hover();
  await expect(page.getByRole('tooltip')).toContainText(text);
}

test.describe('K4.2 truncation layout (synthetic supplement)', () => {
  test('agent tile long name ellipsizes and shows tooltip', async ({ page }) => {
    // Synthetic fixture page — see truncation-live-ops.spec.ts for real dashboard.
    await page.goto('/e2e-truncation');
    await expectEllipsisAndTooltip(
      page,
      page.getByText(LONG_AGENT_NAME),
      LONG_AGENT_NAME,
    );
  });

  test('conversation session key ellipsizes and shows tooltip', async ({ page }) => {
    await page.goto('/e2e-truncation');
    await expectEllipsisAndTooltip(
      page,
      page.getByText('agent:twitter-commander:subagent:151eda19-a0c9-49de-969d-ed39d16fe21c'),
      'agent:twitter-commander:subagent:151eda19-a0c9-49de-969d-ed39d16fe21c',
    );
  });

  test('Live Ops fixture: tooltip adjacent to trigger and in viewport', async ({ page }) => {
    await page.goto('/e2e-truncation');
    const name = page.getByTestId('agent-fixture').getByText(LONG_AGENT_NAME);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(true);

    const trigger = page.getByTestId('agent-fixture').locator('h3 [data-tooltip-trigger]').first();
    await expectTooltipAnchored(page, trigger, { content: LONG_AGENT_NAME });
  });
});
