import { expect, test, type Locator, type Page } from '@playwright/test';

const LONG_AGENT_NAME = 'Extremely Long Strategic Research Agent Name That Must Ellipsize';

async function expectEllipsisAndTooltip(page: Page, locator: Locator, text: string) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS('text-overflow', 'ellipsis');
  const clipped = await locator.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
  await locator.hover();
  await expect(page.getByRole('tooltip')).toContainText(text);
}

test.describe('K4.2 truncation layout', () => {
  test('agent tile long name ellipsizes and shows tooltip', async ({ page }) => {
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

  test('Live Ops fixture: tooltip bbox center within 8px of trigger center', async ({ page }) => {
    await page.goto('/e2e-truncation');
    const name = page.getByTestId('agent-fixture').getByText(LONG_AGENT_NAME);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(true);

    // Hover the Tooltip trigger wrapper (width-stable parent), not just the text node.
    const trigger = page.getByTestId('agent-fixture').locator('h3 div.block.w-full').first();
    await trigger.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText(LONG_AGENT_NAME);

    const tipBox = await tip.boundingBox();
    const triggerBox = await trigger.boundingBox();
    expect(tipBox).toBeTruthy();
    expect(triggerBox).toBeTruthy();
    const tipCenter = tipBox!.x + tipBox!.width / 2;
    const triggerCenter = triggerBox!.x + triggerBox!.width / 2;
    // MUTATION (run once): revert Tooltip to left = triggerCenter - maxWidth/2 → fails.
    expect(Math.abs(tipCenter - triggerCenter)).toBeLessThanOrEqual(8);
  });
});
