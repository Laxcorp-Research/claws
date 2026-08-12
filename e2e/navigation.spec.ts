import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

test.describe('Navigation & Routing', () => {
  test('root / redirects to /store', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/store');
    expect(page.url()).toContain('/store');
  });

  test('pricing page loads without auth', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);

    const content = await page.textContent('body');
    const hasPricingContent =
      content?.includes('Pricing') ||
      content?.includes('pricing') ||
      content?.includes('Standard') ||
      content?.includes('Business') ||
      content?.includes('Premium') ||
      content?.includes('$79') ||
      content?.includes('$');

    expect(hasPricingContent).toBe(true);
  });

  test('settings page requires auth', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/auth/signin**', { timeout: 10_000 });
    expect(page.url()).toContain('auth/signin');
  });

  test('authenticated user can navigate between sections', async ({ page }) => {
    await signInAsTestUser(page);

    await page.goto('/settings');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');

    await page.goto('/store');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');

    await page.goto('/my-claws');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('health endpoint returns 200', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
  });
});
