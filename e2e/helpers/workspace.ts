import { expect, type Page } from '@playwright/test';

export async function getOrCreateWorkspaceId(page: Page): Promise<string> {
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
