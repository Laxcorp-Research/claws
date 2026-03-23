import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

test.describe('Dashboard', () => {
  test('dashboard page loads for an existing workspace', async ({ page }) => {
    await signInAsTestUser(page);

    const response = await page.request.get('/api/workspaces');
    const workspaces = await response.json();

    if (!workspaces.success || !workspaces.data?.length) {
      test.skip(true, 'No workspaces available for dashboard test');
      return;
    }

    const workspaceId = workspaces.data[0].id;
    await page.goto(`/dashboard/${workspaceId}`);

    const pageContent = await page.textContent('body');
    const hasDashboardContent =
      pageContent?.includes('Dashboard') ||
      pageContent?.includes('Activity') ||
      pageContent?.includes('Agent') ||
      pageContent?.includes('Status') ||
      pageContent?.includes('Cost');

    expect(hasDashboardContent).toBe(true);
  });

  test('dashboard renders without server errors', async ({ page }) => {
    await signInAsTestUser(page);

    const response = await page.request.get('/api/workspaces');
    const workspaces = await response.json();

    if (!workspaces.success || !workspaces.data?.length) {
      test.skip(true, 'No workspaces available');
      return;
    }

    const workspaceId = workspaces.data[0].id;
    await page.goto(`/dashboard/${workspaceId}`);

    // Don't use networkidle — dashboard has an SSE activity stream that never settles
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
  });
});
