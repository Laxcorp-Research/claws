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

export async function signInAsAdminUser(page: Page) {
  const attempts = process.env.CI ? 5 : 3;
  const urlTimeout = process.env.CI ? 25_000 : 15_000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.goto('/api/auth/test-session?role=admin&redirect=/admin/reviews');
    try {
      await page.waitForURL('**/admin/reviews', { timeout: urlTimeout });
      return;
    } catch {
      if (attempt === attempts - 1) {
        throw new Error(
          `Failed to sign in as admin user after ${attempts} attempts (DB may be cold)`
        );
      }
      await page.waitForTimeout(process.env.CI ? 3000 : 2000);
    }
  }
}

/** Fresh-signup fixture: JWT + DB flag false. Lands on /onboarding. */
export async function signInAsOnboardingUser(page: Page, redirect = '/onboarding') {
  const attempts = process.env.CI ? 5 : 3;
  const urlTimeout = process.env.CI ? 25_000 : 15_000;
  const target = encodeURIComponent(redirect);
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.goto(
      `/api/auth/test-session?onboardingCompleted=false&redirect=${target}`,
    );
    try {
      await page.waitForURL(`**${redirect}`, { timeout: urlTimeout });
      return;
    } catch {
      if (attempt === attempts - 1) {
        throw new Error(
          `Failed to sign in as onboarding user after ${attempts} attempts (DB may be cold)`,
        );
      }
      await page.waitForTimeout(process.env.CI ? 3000 : 2000);
    }
  }
}
