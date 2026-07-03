// mcp-longtail.test.ts — unit contracts for the C-engine B1 module.
//
// Covers (B1 test plan items d-merge + f):
//   - mergeMcpDenyIntoAgentTools: merge-not-clobber semantics.
//   - resolveToolRouterSession: set-equal → reuse (create NOT called);
//     toolkit-set drift → create; retrieve rejection → create fallback;
//     disabled-shaped config → create; unconfigured composio → null.
//   - probeMcpEndpoint: ok on 2xx initialize + tools/list; failure detail on
//     non-2xx / thrown fetch; mcp-session-id propagation between calls.
//
// The SDK is mocked at the object level (injectable `composio` param) — no
// network, no module-graph mocking needed.
import { describe, it, expect, vi } from 'vitest';
import type { Composio } from '@composio/core';

vi.mock('@/lib/composio', () => ({
  // getComposio default is exercised only via the null-config test; the
  // rest inject `composio` explicitly.
  getComposio: vi.fn(() => null),
  getComposioUserId: (id: string) => `claws_${id}`,
}));

import {
  isMcpLongtailEnabled,
  mergeMcpDenyIntoAgentTools,
  resolveToolRouterSession,
  probeMcpEndpoint,
  MCP_TOOL_DENY_GLOB,
} from '@/lib/openclaw/mcp-longtail';

function buildMockComposio(overrides: {
  retrieve?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}) {
  const retrieve = overrides.retrieve ?? vi.fn();
  const create = overrides.create ?? vi.fn();
  const composio = {
    client: { toolRouter: { session: { retrieve } } },
    toolRouter: { create },
  } as unknown as Composio;
  return { composio, retrieve, create };
}

describe('isMcpLongtailEnabled (kill-switch)', () => {
  it('is OFF by default and only "true" enables it', () => {
    const prev = process.env.CLAWS_MCP_LONGTAIL_ENABLED;
    try {
      delete process.env.CLAWS_MCP_LONGTAIL_ENABLED;
      expect(isMcpLongtailEnabled()).toBe(false);
      process.env.CLAWS_MCP_LONGTAIL_ENABLED = '1';
      expect(isMcpLongtailEnabled()).toBe(false);
      process.env.CLAWS_MCP_LONGTAIL_ENABLED = 'true';
      expect(isMcpLongtailEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CLAWS_MCP_LONGTAIL_ENABLED;
      else process.env.CLAWS_MCP_LONGTAIL_ENABLED = prev;
    }
  });
});

describe('mergeMcpDenyIntoAgentTools', () => {
  it('adds the deny glob to an entry with no tools policy', () => {
    expect(mergeMcpDenyIntoAgentTools(undefined)).toEqual({ deny: [MCP_TOOL_DENY_GLOB] });
  });

  it('merges into an existing deny list without clobbering other entries or fields', () => {
    const merged = mergeMcpDenyIntoAgentTools({
      profile: 'minimal',
      deny: ['exec', 'browser'],
    });
    expect(merged).toEqual({
      profile: 'minimal',
      deny: ['exec', 'browser', MCP_TOOL_DENY_GLOB],
    });
  });

  it('is idempotent when the glob is already present', () => {
    const merged = mergeMcpDenyIntoAgentTools({ deny: [MCP_TOOL_DENY_GLOB] });
    expect(merged).toEqual({ deny: [MCP_TOOL_DENY_GLOB] });
  });
});

describe('resolveToolRouterSession', () => {
  const RETRIEVED = {
    session_id: 'trs_stored',
    mcp: { url: 'https://backend.composio.dev/tool_router/trs_stored/mcp' },
    config: { toolkits: { enabled: ['linear', 'zoom'] } },
  };

  it('reuses the stored session when the toolkit set is set-equal (create NOT called)', async () => {
    const { composio, retrieve, create } = buildMockComposio({
      retrieve: vi.fn().mockResolvedValue(RETRIEVED),
    });

    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: 'trs_stored',
      // Different order + case: set comparison, not array equality.
      toolkitIds: ['Zoom', 'linear'],
      composio,
    });

    expect(retrieve).toHaveBeenCalledWith('trs_stored');
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionId: 'trs_stored',
      mcpUrl: RETRIEVED.mcp.url,
      reused: true,
    });
  });

  it('creates a new session on toolkit-set drift', async () => {
    const { composio, create } = buildMockComposio({
      retrieve: vi.fn().mockResolvedValue(RETRIEVED),
      create: vi.fn().mockResolvedValue({
        sessionId: 'trs_new',
        mcp: { url: 'https://backend.composio.dev/tool_router/trs_new/mcp' },
      }),
    });

    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: 'trs_stored',
      toolkitIds: ['linear', 'zoom', 'notion'], // drift: notion added
      composio,
    });

    expect(create).toHaveBeenCalledWith('claws_user-1', {
      toolkits: { enable: ['linear', 'zoom', 'notion'] },
      workbench: { enable: false },
      manageConnections: false,
    });
    expect(result).toEqual({
      sessionId: 'trs_new',
      mcpUrl: 'https://backend.composio.dev/tool_router/trs_new/mcp',
      reused: false,
    });
  });

  it('creates a new session when retrieve rejects (dead/404 session)', async () => {
    const { composio, create } = buildMockComposio({
      retrieve: vi.fn().mockRejectedValue(new Error('404 session not found')),
      create: vi.fn().mockResolvedValue({
        sessionId: 'trs_recovered',
        mcp: { url: 'https://x/trs_recovered/mcp' },
      }),
    });

    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: 'trs_dead',
      toolkitIds: ['linear'],
      composio,
    });

    expect(create).toHaveBeenCalledOnce();
    expect(result?.sessionId).toBe('trs_recovered');
    expect(result?.reused).toBe(false);
  });

  it('treats a disabled-shaped toolkit config as drift (create called)', async () => {
    const { composio, create } = buildMockComposio({
      retrieve: vi.fn().mockResolvedValue({
        ...RETRIEVED,
        config: { toolkits: { disabled: ['github'] } },
      }),
      create: vi.fn().mockResolvedValue({ sessionId: 'trs_new', mcp: { url: 'https://x/mcp' } }),
    });

    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: 'trs_stored',
      toolkitIds: ['linear', 'zoom'],
      composio,
    });

    expect(create).toHaveBeenCalledOnce();
    expect(result?.reused).toBe(false);
  });

  it('skips retrieve entirely with no stored id and goes straight to create', async () => {
    const { composio, retrieve, create } = buildMockComposio({
      create: vi.fn().mockResolvedValue({ sessionId: 'trs_first', mcp: { url: 'https://x/mcp' } }),
    });

    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: null,
      toolkitIds: ['linear'],
      composio,
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(result?.sessionId).toBe('trs_first');
  });

  it('returns null when Composio is unconfigured (quiet no-op)', async () => {
    const result = await resolveToolRouterSession({
      userId: 'user-1',
      storedSessionId: null,
      toolkitIds: ['linear'],
      // no composio injected; mocked getComposio returns null
    });
    expect(result).toBeNull();
  });
});

describe('probeMcpEndpoint', () => {
  type FetchCall = { url: string; headers: Record<string, string>; body: string };

  function fetchStub(
    responses: Array<{ status: number; sessionId?: string }>,
    calls: FetchCall[] = [],
  ) {
    let i = 0;
    const impl = vi.fn(async (url: unknown, init: RequestInit | undefined) => {
      calls.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      });
      const res = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        status: res.status,
        headers: { get: (name: string) => (name === 'mcp-session-id' ? res.sessionId ?? null : null) },
        text: async () => '',
      } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it('returns ok when initialize + tools/list both 2xx, propagating mcp-session-id', async () => {
    const { impl, calls } = fetchStub([
      { status: 200, sessionId: 'mcp-sess-1' },
      { status: 200 },
    ]);

    const result = await probeMcpEndpoint({
      url: 'https://backend.composio.dev/tool_router/trs_x/mcp',
      headers: { 'x-api-key': 'ak_k' },
      fetchImpl: impl,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toContain('"initialize"');
    expect(calls[0].headers['x-api-key']).toBe('ak_k');
    expect(calls[1].body).toContain('"tools/list"');
    // The session id returned by initialize is forwarded to tools/list.
    expect(calls[1].headers['mcp-session-id']).toBe('mcp-sess-1');
  });

  it('reports failure with the HTTP status when initialize is rejected', async () => {
    const { impl, calls } = fetchStub([{ status: 401 }]);

    const result = await probeMcpEndpoint({
      url: 'https://x/mcp',
      headers: {},
      fetchImpl: impl,
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('initialize returned HTTP 401');
    expect(calls).toHaveLength(1); // no tools/list after a failed initialize
  });

  it('reports failure with the HTTP status when tools/list is rejected', async () => {
    const { impl } = fetchStub([{ status: 200 }, { status: 500 }]);

    const result = await probeMcpEndpoint({ url: 'https://x/mcp', headers: {}, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('tools/list returned HTTP 500');
  });

  it('never throws — network errors become { ok:false, detail }', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const result = await probeMcpEndpoint({ url: 'https://x/mcp', headers: {}, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('fetch failed');
  });
});
