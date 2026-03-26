import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { verifyWorkspaceOwnership } from '@/lib/api/ownership';

describe('verifyWorkspaceOwnership (IDOR prevention)', () => {
  it('returns NOT_FOUND when workspace does not exist', async () => {
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await verifyWorkspaceOwnership('ws-nonexistent', 'user-1');
    expect(result.error).toBe('NOT_FOUND');
    expect(result.workspace).toBeNull();
  });

  it('returns FORBIDDEN when workspace belongs to another user', async () => {
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ws-1', userId: 'user-owner', name: 'Secret Claw',
    });
    const result = await verifyWorkspaceOwnership('ws-1', 'user-attacker');
    expect(result.error).toBe('FORBIDDEN');
    expect(result.workspace).toBeNull();
  });

  it('returns workspace when user is the owner', async () => {
    const workspace = { id: 'ws-1', userId: 'user-owner', name: 'My Claw' };
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(workspace);
    const result = await verifyWorkspaceOwnership('ws-1', 'user-owner');
    expect(result.error).toBeNull();
    expect(result.workspace).toEqual(workspace);
  });

  it('is case-sensitive on userId (no type coercion bypass)', async () => {
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ws-1', userId: 'user-123',
    });
    const result = await verifyWorkspaceOwnership('ws-1', 'USER-123');
    expect(result.error).toBe('FORBIDDEN');
  });
});
