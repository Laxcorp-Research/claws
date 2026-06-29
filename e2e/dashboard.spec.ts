import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';
import { getOrCreateWorkspaceId } from './helpers/workspace';

async function expectDashboardLoaded(page: Page) {
  await expect(page.getByRole('status', { name: 'Loading briefing' })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.getByText(/is ready, but/i)).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('Dashboard', () => {
  test('dashboard page loads for an existing workspace', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);
    await page.goto(`/dashboard/${workspaceId}`);

    await expectDashboardLoaded(page);
    await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
  });

  test('dashboard renders without server errors', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);
    await page.goto(`/dashboard/${workspaceId}`);

    await expectDashboardLoaded(page);

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
    expect(bodyText).not.toContain('500');
  });
});
