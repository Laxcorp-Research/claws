import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

async function getOrCreateWorkspaceId(page: Page): Promise<string> {
  const response = await page.request.get('/api/workspaces');
  expect(response.status()).toBe(200);

  const workspaces = await response.json();
  expect(workspaces.success).toBe(true);

  if (workspaces.data?.length > 0) {
    return workspaces.data[0].id;
  }

  const createRes = await page.request.post('/api/workspaces', {
    data: { name: 'E2E Test Workspace' },
  });
  expect(createRes.status()).toBe(201);

  const created = await createRes.json();
  expect(created.success).toBe(true);
  expect(typeof created.data?.id).toBe('string');

  return created.data.id;
}

test.describe('Setup Wizard', () => {
  test('setup wizard step 1 loads for an existing workspace', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    await page.goto(`/setup/${workspaceId}/step/1`);
    await expect(
      page.getByRole('heading', { name: 'Choose AI models for your agents' })
    ).toBeVisible();
  });

  test('wizard renders without errors', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    await page.goto(`/setup/${workspaceId}/step/1`);
    await expect(
      page.getByRole('heading', { name: 'Choose AI models for your agents' })
    ).toBeVisible();

    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('500');
  });
});
