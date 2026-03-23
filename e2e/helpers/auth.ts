import { Page } from '@playwright/test';

export async function signInAsTestUser(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/api/auth/test-session?redirect=/my-claws');
    try {
      await page.waitForURL('**/my-claws', { timeout: 15_000 });
      return;
    } catch {
      if (attempt === 2) {
        throw new Error('Failed to sign in as test user after 3 attempts (DB may be cold)');
      }
      await page.waitForTimeout(2000);
    }
  }
}
