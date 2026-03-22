import { Page } from '@playwright/test';

export async function signInAsTestUser(page: Page) {
  await page.goto('/api/auth/test-session?redirect=/my-claws');
  await page.waitForURL('**/my-claws');
}
