import { expect, type Page } from '@playwright/test';

type WorkspaceListItem = {
  id: string
  status?: string
}

/** Prefer setup/draft claws so hibernated snapshot fixtures do not steal this helper. */
function pickWorkspaceId(workspaces: WorkspaceListItem[]): string | null {
  if (!workspaces.length) return null
  const preferred =
    workspaces.find((w) => w.status === 'DRAFT' || w.status === 'SETUP_INCOMPLETE') ??
    workspaces.find((w) => w.status !== 'HIBERNATED' && w.status !== 'STOPPED' && w.status !== 'WAKING') ??
    workspaces[0]
  return preferred?.id ?? null
}

export async function getOrCreateWorkspaceId(page: Page): Promise<string> {
  const response = await page.request.get('/api/workspaces');
  expect(response.status()).toBe(200);

  const workspaces = await response.json();
  expect(workspaces.success).toBe(true);

  const existingId = pickWorkspaceId((workspaces.data ?? []) as WorkspaceListItem[])
  if (existingId) {
    return existingId;
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
