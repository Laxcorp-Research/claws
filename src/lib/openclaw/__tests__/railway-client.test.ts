// railway-client.test.ts - PR-8a/B/A coverage for the read helper
// (getServiceVariables) and the railwayGql 429/Retry-After + typed-error
// enhancements.
//
// ┌─ TEST GOTCHA (do not "fix" by moving the import to the top) ──────────────┐
// │ railway-client.ts captures its config at MODULE LOAD:                      │
// │   const RAILWAY_TOKEN = process.env.RAILWAY_API_TOKEN  (+ PROJECT/ENV ID)  │
// │ A top-level `import` would capture whatever env exists when the test file  │
// │ is first evaluated (usually undefined) and freeze it for every test.       │
// │ So we vi.stubEnv(...) and vi.resetModules() in beforeEach, then `await     │
// │ import(...)` INSIDE each test (loadClient) so the module re-reads the      │
// │ stubbed env every time.                                                    │
// └────────────────────────────────────────────────────────────────────────────┘
//
// Fake timers: railwayGql retries with real setTimeout backoffs (1s/3s/8s).
// We use fake timers + advanceTimersByTimeAsync to drive retries without real
// waiting. The success/401/malformed paths never schedule a retry timer, so
// they resolve on microtasks alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadClient() {
  return import('@/lib/openclaw/railway-client');
}

const PROD_RAILWAY_PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const STAGING_RAILWAY_PROJECT_ID = '00000000-0000-4000-8000-000000000004';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('RAILWAY_API_TOKEN', 'test-token');
  vi.stubEnv('RAILWAY_PROJECT_ID', 'proj-1');
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-1');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Type-level guard (PR-8a/B/A brand lock): RawContainerEnv is branded, so a
// plain object literal must NOT be assignable to it without an explicit cast.
// With the brand present, the line below errors and @ts-expect-error suppresses
// it → `tsc --noEmit` stays green. If the brand is removed, the assignment
// becomes valid, the directive is unused, and tsc fails. This is the mutation
// lock for decision 4 (the branded type carries no runtime footprint).
// @ts-expect-error plain Record is not assignable to the branded RawContainerEnv
const _brandGuard: import('@/lib/openclaw/container-env-actual').RawContainerEnv = { A: '1' };
void _brandGuard;

describe('Railway environment isolation guard', () => {
  it('staging + production project id → throws before any Railway mutation request', async () => {
    vi.stubEnv('CLAWS_ENV', 'staging');
    vi.stubEnv('RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-staging');
    vi.stubEnv('PROD_RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('STAGING_RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { createService } = await loadClient();

    await expect(
      createService({ name: 'claw-test', envVars: {}, image: 'ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4' }),
    ).rejects.toThrow('Refusing staging deploy into production Railway project');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production + non-production project id → throws', async () => {
    vi.stubEnv('CLAWS_ENV', 'production');
    vi.stubEnv('RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);
    vi.stubEnv('PROD_RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('STAGING_RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);

    const { assertRailwayTargetAllowed } = await loadClient();

    expect(() => assertRailwayTargetAllowed()).toThrow('Refusing production deploy outside production Railway project');
  });

  it('staging + staging project id → passes', async () => {
    vi.stubEnv('CLAWS_ENV', 'staging');
    vi.stubEnv('RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);
    vi.stubEnv('PROD_RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('STAGING_RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);

    const { assertRailwayTargetAllowed } = await loadClient();

    expect(() => assertRailwayTargetAllowed()).not.toThrow();
  });

  it('production + production project id → passes', async () => {
    vi.stubEnv('CLAWS_ENV', 'production');
    vi.stubEnv('RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('PROD_RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('STAGING_RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);

    const { assertRailwayTargetAllowed } = await loadClient();

    expect(() => assertRailwayTargetAllowed()).not.toThrow();
  });

  it('CLAWS_ENV unset → isRailwayConfigured returns false without throwing at import', async () => {
    vi.stubEnv('RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'env-staging');
    vi.stubEnv('PROD_RAILWAY_PROJECT_ID', PROD_RAILWAY_PROJECT_ID);
    vi.stubEnv('STAGING_RAILWAY_PROJECT_ID', STAGING_RAILWAY_PROJECT_ID);

    const { isRailwayConfigured } = await loadClient();

    expect(isRailwayConfigured()).toBe(false);
  });
});

describe('getServiceVariables (PR-8a/B/A)', () => {
  it('success → returns the flat variables map and sends projectId/environmentId/serviceId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { variables: { ANTHROPIC_API_KEY: 'sk-ant-x', CLAWS_CREDIT_MODE: 'true' } } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const env = await getServiceVariables('svc-1');

    expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-x', CLAWS_CREDIT_MODE: 'true' });
    // The query carried the verified args (serviceId + module-level project/env).
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.variables).toEqual({ projectId: 'proj-1', environmentId: 'env-1', serviceId: 'svc-1' });
    expect(sentBody.query).toContain('variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)');
  });

  it('null variables (deleted/missing service) → coerced to {}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { variables: null } })));
    const { getServiceVariables } = await loadClient();
    await expect(getServiceVariables('svc')).resolves.toEqual({});
  });

  it('empty variables map → {}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { variables: {} } })));
    const { getServiceVariables } = await loadClient();
    await expect(getServiceVariables('svc')).resolves.toEqual({});
  });

  it('401 → throws RailwayApiError{status:401} with NO retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    await expect(getServiceVariables('svc')).rejects.toMatchObject({ name: 'RailwayApiError', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GraphQL errors[] (service not found) → throws RailwayApiError{status:200}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Service not found' }] })));
    const { getServiceVariables } = await loadClient();
    await expect(getServiceVariables('svc')).rejects.toMatchObject({ name: 'RailwayApiError', status: 200 });
  });

  it('malformed JSON body → throws (parse error propagates)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('NOT JSON <html>', { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
    const { getServiceVariables } = await loadClient();
    await expect(getServiceVariables('svc')).rejects.toBeInstanceOf(Error);
  });

  it('network error → retries then throws RailwayApiError{status:0} after exhausting the budget', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc');
    const assertion = expect(p).rejects.toMatchObject({ name: 'RailwayApiError', status: 0 });
    await vi.advanceTimersByTimeAsync(12000); // 1s + 3s + 8s backoffs
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('429 → honors Retry-After (waits the header duration, NOT the shorter default backoff)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { variables: { OK: '1' } } }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc');
    // Retry-After=2s; default backoff for attempt 0 is 1s. At 1.5s the retry
    // must NOT have fired yet - proving the header (2s) was honored over the
    // default (1s). If the code ignored Retry-After, fetch would already be 2.
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(700); // now past 2s
    await expect(p).resolves.toEqual({ OK: '1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 without Retry-After → falls back to the default backoff (1s) then retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rl', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ data: { variables: {} } }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc');
    await vi.advanceTimersByTimeAsync(1000); // RAILWAY_RETRY_DELAYS[0]
    await expect(p).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx → still retries then succeeds (existing behavior preserved)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ data: { variables: { A: '1' } } }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ A: '1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getServiceVariables timeout/retry options (PR-8a/C/B)', () => {
  it('default (no options) → 3 retries on persistent 5xx (4 fetch calls): behavior unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc'); // no options → default maxRetries=3
    const assertion = expect(p).rejects.toMatchObject({ name: 'RailwayApiError', status: 500 });
    await vi.advanceTimersByTimeAsync(15000); // 1s + 3s + 8s backoffs
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('maxRetries: 1 → exactly 2 fetch calls on persistent 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    const p = getServiceVariables('svc', { maxRetries: 1 });
    const assertion = expect(p).rejects.toMatchObject({ name: 'RailwayApiError', status: 500 });
    await vi.advanceTimersByTimeAsync(2000); // one 1s backoff
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('maxRetries: 0 → exactly 1 fetch call (no retry) on 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getServiceVariables } = await loadClient();

    await expect(getServiceVariables('svc', { maxRetries: 0 })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('custom timeoutMs is threaded to AbortSignal.timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { variables: {} } })));
    const { getServiceVariables } = await loadClient();

    await getServiceVariables('svc', { timeoutMs: 5000, maxRetries: 0 });
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it('default timeoutMs is 90_000 (regression lock for existing callers)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { variables: {} } })));
    const { getServiceVariables } = await loadClient();

    await getServiceVariables('svc'); // no options
    expect(timeoutSpy).toHaveBeenCalledWith(90_000);
    timeoutSpy.mockRestore();
  });
});

describe('sleepApplication_bypasses_entitlement_gate', () => {
  it('throws when sleepApplication is true (Rider-2 serverless skips canWakeHibernatedWorkspace)', async () => {
    const { assertSleepApplicationNeverEnabled, SLEEP_APPLICATION_BYPASSES_ENTITLEMENT_GATE } =
      await loadClient();
    expect(() => assertSleepApplicationNeverEnabled({ sleepApplication: true })).toThrow(
      SLEEP_APPLICATION_BYPASSES_ENTITLEMENT_GATE,
    );
  });

  it('allows explicit false and omitted field', async () => {
    const { assertSleepApplicationNeverEnabled } = await loadClient();
    expect(() => assertSleepApplicationNeverEnabled({ sleepApplication: false })).not.toThrow();
    expect(() => assertSleepApplicationNeverEnabled({})).not.toThrow();
  });
});

describe('removeLatestDeployment - hibernated-with-service is legal', () => {
  function gqlData(data: unknown) {
    return jsonResponse({ data });
  }

  it('REMOVED latest → no deploymentRemove mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      gqlData({
        deployments: {
          edges: [{ node: { id: 'dep-gone', status: 'REMOVED', createdAt: '2026-08-01T00:00:00Z' } }],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { removeLatestDeployment } = await loadClient();

    await expect(removeLatestDeployment('svc-hwd')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { query: string };
    expect(body.query).toContain('deployments(');
    expect(body.query).not.toContain('deploymentRemove');
  });

  it('NO_DEPLOYMENT → no deploymentRemove mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gqlData({ deployments: { edges: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    const { removeLatestDeployment } = await loadClient();

    await expect(removeLatestDeployment('svc-hwd')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { query: string };
    expect(body.query).not.toContain('deploymentRemove');
  });
});

describe("9.4 Railway trustedProxies boot patch", () => {
  it("MUTATION: boot unpack still writes the CGNAT/private CIDRs 9.4 attribution needs", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/openclaw/railway-client.ts"),
      "utf8",
    )
    expect(src).toContain("100.64.0.0/10")
    expect(src).toContain("10.0.0.0/8")
    expect(src).toContain("172.16.0.0/12")
    expect(src).toContain("c.gateway.trustedProxies=tp")
  })
})
