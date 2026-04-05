import { Page } from '@playwright/test';

export async function signInAsTestUser(page: Page) {
  const attempts = process.env.CI ? 5 : 3;
  const urlTimeout = process.env.CI ? 25_000 : 15_000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.goto('/api/auth/test-session?redirect=/my-claws');
    try {
      await page.waitForURL('**/my-claws', { timeout: urlTimeout });
      return;
    } catch {
      if (attempt === attempts - 1) {
        throw new Error(
          `Failed to sign in as test user after ${attempts} attempts (DB may be cold)`
        );
      }
      await page.waitForTimeout(process.env.CI ? 3000 : 2000);
    }
  }
}
