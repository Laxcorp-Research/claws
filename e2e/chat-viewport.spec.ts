import { expect, test } from '@playwright/test';

test.describe('Chat viewport bound (PR-A §6)', () => {
  test('30+ messages: pane stays within viewport − gap; list scrolls; document not inflated', async ({ page }) => {
    await page.goto('/e2e-chat-viewport');
    const pane = page.getByRole('region', { name: 'Web chat' });
    const log = page.getByRole('log', { name: 'Chat messages' });
    await expect(pane).toBeVisible();
    await expect(log).toBeVisible();

    const metrics = await page.evaluate(() => {
      const paneEl = document.querySelector('[aria-label="Web chat"]') as HTMLElement | null;
      const logEl = document.querySelector('[aria-label="Chat messages"]') as HTMLElement | null;
      if (!paneEl || !logEl) return null;
      const paneRect = paneEl.getBoundingClientRect();
      const gap = 24; // mb-6
      return {
        viewportHeight: window.innerHeight,
        paneBottom: paneRect.bottom,
        documentHeight: document.documentElement.scrollHeight,
        logScrollHeight: logEl.scrollHeight,
        logClientHeight: logEl.clientHeight,
        paneMaxHeightClass: paneEl.className.includes('max-h-[calc(100vh-260px)]'),
      };
    });

    expect(metrics).toBeTruthy();
    expect(metrics!.paneMaxHeightClass).toBe(true);
    expect(metrics!.paneBottom).toBeLessThanOrEqual(metrics!.viewportHeight - 8);
    expect(metrics!.documentHeight).toBeLessThanOrEqual(metrics!.viewportHeight + 80);
    expect(metrics!.logScrollHeight).toBeGreaterThan(metrics!.logClientHeight);

    await log.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const scrolled = await log.evaluate((el) => el.scrollTop > 0);
    expect(scrolled).toBe(true);
  });
});
