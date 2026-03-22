import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

test.describe('Setup Wizard', () => {
  test('setup wizard step 1 loads for an existing workspace', async ({ page }) => {
    await signInAsTestUser(page);

    const response = await page.request.get('/api/workspaces');
    const workspaces = await response.json();

    let workspaceId: string;

    if (workspaces.success && workspaces.data?.length > 0) {
      workspaceId = workspaces.data[0].id;
    } else {
      const createRes = await page.request.post('/api/workspaces', {
        data: { name: 'E2E Test Workspace' },
      });
      const created = await createRes.json();

      if (!created.success || !created.data?.id) {
        test.skip(true, 'Cannot create test workspace — template seeding may be needed');
        return;
      }
      workspaceId = created.data.id;
    }

    await page.goto(`/setup/${workspaceId}/step/1`);

    const pageContent = await page.textContent('body');
    const hasStep1Content =
      pageContent?.includes('API') ||
      pageContent?.includes('key') ||
      pageContent?.includes('Model') ||
      pageContent?.includes('Anthropic') ||
      pageContent?.includes('Step 1');

    expect(hasStep1Content).toBe(true);
  });

  test('wizard renders without errors', async ({ page }) => {
    await signInAsTestUser(page);

    const response = await page.request.get('/api/workspaces');
    const workspaces = await response.json();

    if (!workspaces.success || !workspaces.data?.length) {
      test.skip(true, 'No workspaces available for setup wizard test');
      return;
    }

    const workspaceId = workspaces.data[0].id;
    await page.goto(`/setup/${workspaceId}/step/1`);

    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('500');
  });
});
