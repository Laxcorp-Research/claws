// deployer-env-vars.test.ts — regression coverage for buildRailwayEnvVars'
// Composio emission.
//
// Scope is intentionally narrow: this file tests ONLY the env-var-building
// function. Deploy orchestration (Railway GraphQL, Prisma updates, service
// lifecycle) is covered by end-to-end tests separately.
//
// What these tests guard:
//   1. The PR #4 security boundary: COMPOSIO_API_KEY + COMPOSIO_USER_ID
//      must land together at container-env level, or neither does.
//   2. The claws_<userId> format matches the generator's output (both come
//      from getComposioUserId), so per-skill env and container-level env
//      agree on the user identity.
//   3. Pre-PR #4 backward compatibility: when COMPOSIO_API_KEY is unset
//      (dev/local, CI without the secret), the function silently omits
//      Composio vars — no throw, no breakage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildRailwayEnvVars } from '@/lib/openclaw/deployer';
import type { GeneratedWorkspace } from '@/lib/openclaw/generator';

// Minimal GeneratedWorkspace fixture. buildRailwayEnvVars only reads five
// top-level fields plus workspaces/cron; everything else can be empty.
const minimalGenerated: GeneratedWorkspace = {
  'openclaw.json': '{"gateway":{}}',
  '.env': 'OPENCLAW_GATEWAY_TOKEN=tok\n',
  'cron/jobs.json': '[]',
  workspaces: {},
  gatewayToken: 'tok-abc-123',
};

const workspace = { timezone: 'UTC', containerHost: null };

describe('buildRailwayEnvVars — Composio security boundary (PR #4 Commit 2)', () => {
  // Vitest does not isolate process.env between tests. Stash + restore so
  // nothing leaks to other files in the same test run.
  let prevComposioApiKey: string | undefined;
  beforeEach(() => {
    prevComposioApiKey = process.env.COMPOSIO_API_KEY;
  });
  afterEach(() => {
    if (prevComposioApiKey === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = prevComposioApiKey;
  });

  it('emits COMPOSIO_API_KEY + COMPOSIO_USER_ID together when COMPOSIO_API_KEY is set', () => {
    process.env.COMPOSIO_API_KEY = 'ak_platform_secret_deadbeef';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-test-1',
      userId: 'user-abc',
    });

    expect(env.COMPOSIO_API_KEY).toBe('ak_platform_secret_deadbeef');
    expect(env.COMPOSIO_USER_ID).toBe('claws_user-abc');
  });

  it('uses the getComposioUserId format (claws_<userId>) — matches generator skills.entries emission', () => {
    // The container-level COMPOSIO_USER_ID MUST match what generator.ts
    // emits into skills.entries[slug].env.COMPOSIO_USER_ID. Both derive
    // from the same getComposioUserId helper, so this test guards against
    // drift if either side's formatting changes.
    process.env.COMPOSIO_API_KEY = 'ak_fmt_test';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: true,
      workspaceId: 'ws-fmt-1',
      userId: 'abc123',
    });
    expect(env.COMPOSIO_USER_ID).toBe('claws_abc123');
  });

  it('does not emit any Composio env vars when COMPOSIO_API_KEY is unset (pre-PR #4 backward compat)', () => {
    delete process.env.COMPOSIO_API_KEY;
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-test-2',
      userId: 'user-xyz',
    });
    expect(env.COMPOSIO_API_KEY).toBeUndefined();
    expect(env.COMPOSIO_USER_ID).toBeUndefined();
    // Non-Composio env vars unchanged.
    expect(env.CLAWS_CREDIT_MODE).toBe('false');
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBe('tok-abc-123');
  });

  // PR2: two tests deleted here because they passed `undefined` as
  // creditConfig to exercise the "creditConfig missing entirely" branch
  // of the security-boundary throw. PR2 tightened buildRailwayEnvVars's
  // signature so creditConfig is REQUIRED — TypeScript now rejects
  // those calls at compile time. The runtime throw remains as
  // defense-in-depth for `as any` bypasses, but is no longer reachable
  // via the type-safe test surface. The empty-userId case below still
  // exercises the runtime throw with a valid CreditConfig shape.

  it('throws when creditConfig is passed but userId is empty (defense in depth)', () => {
    process.env.COMPOSIO_API_KEY = 'ak_platform_secret';
    expect(() =>
      buildRailwayEnvVars(minimalGenerated, workspace, {
        creditMode: false,
        workspaceId: 'ws-test-3',
        userId: '',
      }),
    ).toThrow(/refusing to emit platform API key without a user-id scope pin/);
  });

  it('does NOT throw when COMPOSIO_API_KEY is unset even if creditConfig.userId is empty (no platform key → no security boundary to enforce)', () => {
    delete process.env.COMPOSIO_API_KEY;
    expect(() =>
      buildRailwayEnvVars(minimalGenerated, workspace, {
        creditMode: false,
        workspaceId: 'ws-no-composio',
        userId: '',
      }),
    ).not.toThrow();
  });

  it('preserves existing creditMode behavior (CLAWS_USER_ID and CLAWS_WORKSPACE_ID) alongside the new Composio vars', () => {
    process.env.COMPOSIO_API_KEY = 'ak_mixed';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: true,
      workspaceId: 'ws-mixed',
      userId: 'user-mixed',
    });
    // Existing credit-mode surface unchanged.
    expect(env.CLAWS_CREDIT_MODE).toBe('true');
    expect(env.CLAWS_USER_ID).toBe('user-mixed');
    expect(env.CLAWS_WORKSPACE_ID).toBe('ws-mixed');
    // New Composio surface coexists — same source of truth for user id.
    expect(env.COMPOSIO_USER_ID).toBe('claws_user-mixed');
    expect(env.COMPOSIO_API_KEY).toBe('ak_mixed');
  });

  it('COMPOSIO_API_KEY value is trimmed (handles whitespace in server env)', () => {
    process.env.COMPOSIO_API_KEY = '   ak_padded   ';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-trim',
      userId: 'user-trim',
    });
    expect(env.COMPOSIO_API_KEY).toBe('ak_padded');
  });

  it('treats whitespace-only COMPOSIO_API_KEY as unset (no emission, no throw)', () => {
    process.env.COMPOSIO_API_KEY = '   ';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-ws',
      userId: 'user-ws',
    });
    expect(env.COMPOSIO_API_KEY).toBeUndefined();
    expect(env.COMPOSIO_USER_ID).toBeUndefined();
  });
});

// PR2: universal state-preservation env-var distribution
//
// Before PR2, CLAWS_WORKSPACE_ID, CLAWS_METERING_ENDPOINT, and
// CLAWS_METERING_SECRET were emitted ONLY when creditConfig.creditMode was
// true — bundled with the credit-proxy-specific vars in the same conditional.
// process-manager.mjs needs all three for syncState() and
// restoreStateFromPlatform() to fire. So non-credit containers got no
// state preservation despite the feature shipping.
//
// After PR2, the 3 state-sync vars are emitted whenever creditConfig is
// passed (which all current callers do — deployer + redeployer always
// provide it). Only credit-proxy-specific vars (CLAWS_USER_ID,
// ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, NODE_OPTIONS) remain gated on
// creditMode=true.
describe('buildRailwayEnvVars — PR2 universal state-sync env-var distribution', () => {
  let prevMeteringEndpoint: string | undefined;
  let prevMeteringSecret: string | undefined;
  let prevComposioApiKey: string | undefined;

  beforeEach(() => {
    prevMeteringEndpoint = process.env.METERING_ENDPOINT;
    prevMeteringSecret = process.env.METERING_MASTER_SECRET;
    prevComposioApiKey = process.env.COMPOSIO_API_KEY;
    // Composio unset for this whole block to keep it orthogonal.
    delete process.env.COMPOSIO_API_KEY;
    process.env.METERING_ENDPOINT = 'https://custom-metering.example.com/api/internal/metering';
    process.env.METERING_MASTER_SECRET = 'test_metering_secret_abc';
  });

  afterEach(() => {
    if (prevMeteringEndpoint === undefined) delete process.env.METERING_ENDPOINT;
    else process.env.METERING_ENDPOINT = prevMeteringEndpoint;
    if (prevMeteringSecret === undefined) delete process.env.METERING_MASTER_SECRET;
    else process.env.METERING_MASTER_SECRET = prevMeteringSecret;
    if (prevComposioApiKey === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = prevComposioApiKey;
  });

  it('emits CLAWS_WORKSPACE_ID for non-credit users (regression: was credit-mode-gated)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-non-credit-1',
      userId: 'user-non-credit-1',
    });
    expect(env.CLAWS_WORKSPACE_ID).toBe('ws-non-credit-1');
  });

  it('emits CLAWS_METERING_ENDPOINT for non-credit users (regression: was credit-mode-gated)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-non-credit-2',
      userId: 'user-non-credit-2',
    });
    expect(env.CLAWS_METERING_ENDPOINT).toBe('https://custom-metering.example.com/api/internal/metering');
  });

  it('emits CLAWS_METERING_SECRET for non-credit users (regression: was credit-mode-gated)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-non-credit-3',
      userId: 'user-non-credit-3',
    });
    expect(env.CLAWS_METERING_SECRET).toBe('test_metering_secret_abc');
  });

  it('falls back to default metering endpoint when METERING_ENDPOINT env is unset', () => {
    delete process.env.METERING_ENDPOINT;
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-default',
      userId: 'user-default',
    });
    expect(env.CLAWS_METERING_ENDPOINT).toBe('https://app.buildclaws.ai/api/internal/metering');
  });

  it('still gates credit-proxy-specific vars on creditMode=true (non-credit does NOT get them)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-non-credit-4',
      userId: 'user-non-credit-4',
    });
    // Credit-proxy vars must NOT appear for non-credit users.
    expect(env.CLAWS_USER_ID).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    // But the state-sync triplet IS present.
    expect(env.CLAWS_WORKSPACE_ID).toBe('ws-non-credit-4');
    expect(env.CLAWS_METERING_ENDPOINT).toBeDefined();
    expect(env.CLAWS_METERING_SECRET).toBeDefined();
    // And the CREDIT_MODE flag is explicitly false.
    expect(env.CLAWS_CREDIT_MODE).toBe('false');
  });

  it('credit-mode users get BOTH state-sync vars AND credit-proxy vars', () => {
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = 'sk-ant-test-master';
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: true,
      workspaceId: 'ws-credit-1',
      userId: 'user-credit-1',
    });
    // State-sync surface (universal).
    expect(env.CLAWS_WORKSPACE_ID).toBe('ws-credit-1');
    expect(env.CLAWS_METERING_ENDPOINT).toBeDefined();
    expect(env.CLAWS_METERING_SECRET).toBeDefined();
    // Credit-proxy surface (credit-mode-only).
    expect(env.CLAWS_CREDIT_MODE).toBe('true');
    expect(env.CLAWS_USER_ID).toBe('user-credit-1');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test-master');
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:3789');
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=700');
  });
});
