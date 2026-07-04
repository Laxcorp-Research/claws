// deployer-mcp-boot-probe.test.ts — C-engine B1 cold-boot surfacing contract.
//
// surfaceMcpBootFailure is the deployer's minimal detection for the SILENT
// in-container MCP connect failure (Probe 3 step 7): probe the Tool Router
// endpoint directly, and on failure write ONE ActivityLog ERROR row. Full
// handling (retries, re-probe loops) is PR-R scope, deliberately absent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/composio', () => ({
  getComposioUserId: (id: string) => `claws_${id}`,
  getComposio: vi.fn(() => null),
}));

import { surfaceMcpBootFailure } from '@/lib/openclaw/deployer';
import type { probeMcpEndpoint } from '@/lib/openclaw/mcp-longtail';

const MCP_CONFIG = JSON.stringify({
  mcp: {
    servers: {
      composio: {
        url: 'https://backend.composio.dev/tool_router/trs_x/mcp',
        transport: 'streamable-http',
        headers: { 'x-api-key': 'ak_k' },
      },
    },
  },
});

beforeEach(() => {
  (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'log-1' });
  (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('surfaceMcpBootFailure', () => {
  it('writes the exact ActivityLog ERROR row when the probe fails', async () => {
    const probe = vi
      .fn()
      .mockResolvedValue({ ok: false, detail: 'initialize returned HTTP 502' }) as unknown as typeof probeMcpEndpoint;

    await surfaceMcpBootFailure('ws-1', { 'openclaw.json': MCP_CONFIG }, probe);

    expect(probe).toHaveBeenCalledWith({
      url: 'https://backend.composio.dev/tool_router/trs_x/mcp',
      headers: { 'x-api-key': 'ak_k' },
    });
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        action: 'Long-tail tool connection failed at boot',
        actionType: 'ERROR',
        detail: 'initialize returned HTTP 502',
      },
    });
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        mcpSessionHealthStatus: 'DEAD',
        mcpSessionLastError: 'initialize returned HTTP 502',
      }),
    });
  });

  it('writes HEALTHY session metadata when the probe succeeds', async () => {
    const probe = vi
      .fn()
      .mockResolvedValue({ ok: true, detail: 'initialize + tools/list ok' }) as unknown as typeof probeMcpEndpoint;

    await surfaceMcpBootFailure('ws-1', { 'openclaw.json': MCP_CONFIG }, probe);

    expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        mcpSessionHealthStatus: 'HEALTHY',
        mcpSessionLastError: null,
      }),
    });
  });

  it('does not probe at all for non-MCP deploys (no mcp block in openclaw.json)', async () => {
    const probe = vi.fn() as unknown as typeof probeMcpEndpoint;

    await surfaceMcpBootFailure(
      'ws-1',
      { 'openclaw.json': JSON.stringify({ gateway: { port: 18789 } }) },
      probe,
    );

    expect(probe).not.toHaveBeenCalled();
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('swallows unparseable config instead of throwing (never blocks a deploy)', async () => {
    const probe = vi.fn() as unknown as typeof probeMcpEndpoint;

    await expect(
      surfaceMcpBootFailure('ws-1', { 'openclaw.json': 'not json' }, probe),
    ).resolves.toBeUndefined();

    expect(probe).not.toHaveBeenCalled();
  });
});
