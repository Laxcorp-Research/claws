import { test, expect } from '@playwright/test';
import { signInAsAdminUser, signInAsTestUser } from './helpers/auth';

const adminRoutes = ['/admin/reviews', '/admin/reports', '/admin/versions'];

test.describe('Admin authorization', () => {
  test('non-admin authenticated user receives not-found for admin pages without a sign-in redirect', async ({
    page,
  }) => {
    await signInAsTestUser(page);

    for (const route of adminRoutes) {
      const response = await page.goto(route);

      expect(response?.status(), `${route} should not redirect to sign-in`).not.toBe(307);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(
        page.getByText("This page doesn't exist or has been moved.")
      ).toBeVisible();
    }
  });

  test('admin authenticated user can load the review queue', async ({ page }) => {
    await signInAsAdminUser(page);

    await expect(page).toHaveURL(/\/admin\/reviews$/);
    await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
    await expect(page.getByText('Page not found')).toBeHidden();
  });

  test('unauthenticated user redirects from admin pages to sign-in', async ({ page }) => {
    await page.goto('/admin/reviews');

    await page.waitForURL('**/auth/signin**', { timeout: 10_000 });
    expect(page.url()).toContain('/auth/signin');
  });
});
