import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

const stepOneHeading = 'Choose AI models for your agents';

async function expectStepOneLoaded(page: Page, timeout: number) {
  // Step 1 is post-load gated. Next dev cold-compiles this route on the first
  // CI hit, then the page hydrates and waits for three mount-time fetches.
  // These per-assertion timeouts cover that cold loaded-state path without
  // changing global retries or hiding real failures.
  await expect(page.getByRole('status', { name: 'Loading content' })).toHaveCount(0, {
    timeout,
  });
  await expect(page.getByRole('heading', { name: stepOneHeading })).toBeVisible({
    timeout,
  });
}

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
    await expectStepOneLoaded(page, 20_000);
  });

  test('wizard renders without errors', async ({ page }) => {
    await signInAsTestUser(page);
    const workspaceId = await getOrCreateWorkspaceId(page);

    await page.goto(`/setup/${workspaceId}/step/1`);
    await expectStepOneLoaded(page, 15_000);

    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('500');
  });
});
