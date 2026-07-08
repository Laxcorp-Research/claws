import { expect, test, type Locator, type Page } from '@playwright/test';

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
      page.getByText('Extremely Long Strategic Research Agent Name That Must Ellipsize'),
      'Extremely Long Strategic Research Agent Name That Must Ellipsize',
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
});

