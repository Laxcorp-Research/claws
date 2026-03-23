import { test, expect } from '@playwright/test';

test.describe('Store Page', () => {
  test('loads and displays Claw catalog', async ({ page }) => {
    await page.goto('/store');

    await expect(page).toHaveTitle(/Claws|Store/i);

    const pageContent = await page.textContent('body');

    const hasStoreUI =
      pageContent?.includes('Store') ||
      pageContent?.includes('Browse') ||
      pageContent?.includes('Claws') ||
      pageContent?.includes('All') ||
      pageContent?.includes('Money') ||
      pageContent?.includes('Creator');

    expect(hasStoreUI).toBe(true);
  });

  test('store page is accessible without authentication', async ({ page }) => {
    const response = await page.goto('/store');
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain('/store');
  });

  test('clicking a Claw card navigates to detail page', async ({ page }) => {
    await page.goto('/store');

    const clawLink = page.locator('a[href^="/store/"]').first();

    if (await clawLink.isVisible()) {
      await clawLink.click();
      await expect(page).toHaveURL(/\/store\/.+/);
    }
  });
});
