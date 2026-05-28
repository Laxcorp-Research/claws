// deployer-env-vars.test.ts — regression coverage for buildRailwayEnvVars'
// Composio emission + PR-2b env-guards (fail-closed + host-match).
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
//   4. PR-2b #1 fail-closed: throws when ACTIVITY_ENDPOINT or
//      METERING_ENDPOINT is unset (no silent prod fallback).
//   5. PR-2b #2 host-match: throws when endpoint host doesn't match
//      NEXT_PUBLIC_APP_URL host (catches misrouted-env-baked-into-container).

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

// PR-2b: every successful path needs these three set together so the host
// guard agrees. Tests that exercise the unset/mismatch branches override
// them inline.
function setStagingLikeEnv() {
  process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
  process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
  process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
}

describe('buildRailwayEnvVars — Composio security boundary (PR #4 Commit 2)', () => {
  // Vitest does not isolate process.env between tests. Stash + restore so
  // nothing leaks to other files in the same test run. PR-2b: also stash
  // the new required env vars (ACTIVITY_ENDPOINT, METERING_ENDPOINT,
  // NEXT_PUBLIC_APP_URL) since the env-guards read them.
  let prevComposioApiKey: string | undefined;
  let prevActivityEndpoint: string | undefined;
  let prevMeteringEndpoint: string | undefined;
  let prevAppUrl: string | undefined;
  beforeEach(() => {
    prevComposioApiKey = process.env.COMPOSIO_API_KEY;
    prevActivityEndpoint = process.env.ACTIVITY_ENDPOINT;
    prevMeteringEndpoint = process.env.METERING_ENDPOINT;
    prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    setStagingLikeEnv();
  });
  afterEach(() => {
    if (prevComposioApiKey === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = prevComposioApiKey;
    if (prevActivityEndpoint === undefined) delete process.env.ACTIVITY_ENDPOINT;
    else process.env.ACTIVITY_ENDPOINT = prevActivityEndpoint;
    if (prevMeteringEndpoint === undefined) delete process.env.METERING_ENDPOINT;
    else process.env.METERING_ENDPOINT = prevMeteringEndpoint;
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
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
  let prevActivityEndpoint: string | undefined;
  let prevComposioApiKey: string | undefined;
  let prevAppUrl: string | undefined;

  beforeEach(() => {
    prevMeteringEndpoint = process.env.METERING_ENDPOINT;
    prevMeteringSecret = process.env.METERING_MASTER_SECRET;
    prevActivityEndpoint = process.env.ACTIVITY_ENDPOINT;
    prevComposioApiKey = process.env.COMPOSIO_API_KEY;
    prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    // Composio unset for this whole block to keep it orthogonal.
    delete process.env.COMPOSIO_API_KEY;
    // PR-2b: set all three required env vars so the host-match guard
    // agrees. Tests that need to vary the metering URL set it again
    // inline with a host that still matches NEXT_PUBLIC_APP_URL.
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
    process.env.METERING_MASTER_SECRET = 'test_metering_secret_abc';
  });

  afterEach(() => {
    if (prevMeteringEndpoint === undefined) delete process.env.METERING_ENDPOINT;
    else process.env.METERING_ENDPOINT = prevMeteringEndpoint;
    if (prevMeteringSecret === undefined) delete process.env.METERING_MASTER_SECRET;
    else process.env.METERING_MASTER_SECRET = prevMeteringSecret;
    if (prevActivityEndpoint === undefined) delete process.env.ACTIVITY_ENDPOINT;
    else process.env.ACTIVITY_ENDPOINT = prevActivityEndpoint;
    if (prevComposioApiKey === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = prevComposioApiKey;
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
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
    expect(env.CLAWS_METERING_ENDPOINT).toBe('https://staging.app.buildclaws.ai/api/internal/metering');
  });

  it('emits CLAWS_METERING_SECRET for non-credit users (regression: was credit-mode-gated)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-non-credit-3',
      userId: 'user-non-credit-3',
    });
    expect(env.CLAWS_METERING_SECRET).toBe('test_metering_secret_abc');
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

  it('emits CLAWS_ACTIVITY_ENDPOINT alongside metering (PR-2)', () => {
    const env = buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-activity-1',
      userId: 'user-activity-1',
    });
    expect(env.CLAWS_ACTIVITY_ENDPOINT).toBe('https://staging.app.buildclaws.ai/api/internal/activity');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PR-2b #1 + #2: fail-closed + host-match guards on the endpoint env vars.
//
// Background: PR-2 originally hardcoded a fallback to
//   'https://app.buildclaws.ai/api/internal/activity'
// when ACTIVITY_ENDPOINT was unset. That fallback was the silent-misroute
// bug we discovered during PR-2 staging validation: staging containers
// without the env set posted activity events at prod's endpoint, which
// rejected them but with no obvious surface signal. METERING_ENDPOINT
// had the same shape. Both are now required.
//
// Each test in this block targets a specific failure mode of the deploy
// pipeline that the guard must catch loudly.
// ─────────────────────────────────────────────────────────────────────────
describe('buildRailwayEnvVars — PR-2b fail-closed + host-match guards', () => {
  let prev: Record<string, string | undefined>;
  beforeEach(() => {
    prev = {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      ACTIVITY_ENDPOINT: process.env.ACTIVITY_ENDPOINT,
      METERING_ENDPOINT: process.env.METERING_ENDPOINT,
      METERING_MASTER_SECRET: process.env.METERING_MASTER_SECRET,
      COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    };
    // Composio off so it can't be the cause of any unexpected throws.
    delete process.env.COMPOSIO_API_KEY;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function callIt() {
    return buildRailwayEnvVars(minimalGenerated, workspace, {
      creditMode: false,
      workspaceId: 'ws-guard',
      userId: 'user-guard',
    });
  }

  it('MUTATION-anchored: throws when ACTIVITY_ENDPOINT is unset (no silent prod fallback)', () => {
    // This is the bug we shipped in PR-2 and discovered during staging
    // validation. If a future change re-introduces the silent fallback
    // (e.g., `process.env.ACTIVITY_ENDPOINT || '<prod-url>'`), this test
    // fails. Lock the fail-closed posture in code-and-tests.
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    delete process.env.ACTIVITY_ENDPOINT;
    expect(callIt).toThrow(/ACTIVITY_ENDPOINT env var is required but not set/);
  });

  it('throws when METERING_ENDPOINT is unset (same fail-closed treatment)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
    delete process.env.METERING_ENDPOINT;
    expect(callIt).toThrow(/METERING_ENDPOINT env var is required but not set/);
  });

  it('throws when ACTIVITY_ENDPOINT is whitespace-only', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = '   ';
    expect(callIt).toThrow(/ACTIVITY_ENDPOINT env var is required but not set/);
  });

  it('throws on host mismatch — ACTIVITY_ENDPOINT host != NEXT_PUBLIC_APP_URL host', () => {
    // The exact misconfig we want to catch at deploy time, not at
    // request time. A staging deploy pointed at a prod endpoint URL
    // (or vice versa) silently routed traffic to the wrong control
    // plane in PR-2 — visible only because the workspace ID didn't
    // exist in the wrong DB.
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = 'https://app.buildclaws.ai/api/internal/activity'; // prod
    expect(callIt).toThrow(/Host mismatch refusing deploy.*ACTIVITY_ENDPOINT/);
  });

  it('throws on host mismatch — METERING_ENDPOINT host != NEXT_PUBLIC_APP_URL host', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
    process.env.METERING_ENDPOINT = 'https://app.buildclaws.ai/api/internal/metering'; // prod
    expect(callIt).toThrow(/Host mismatch refusing deploy.*METERING_ENDPOINT/);
  });

  it('throws when NEXT_PUBLIC_APP_URL is unset (cannot run host-match guard)', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
    expect(callIt).toThrow(/NEXT_PUBLIC_APP_URL env var is required/);
  });

  it('accepts matching staging-shaped env (all three on same host)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = 'https://staging.app.buildclaws.ai/api/internal/activity';
    expect(callIt).not.toThrow();
    const env = callIt();
    expect(env.CLAWS_ACTIVITY_ENDPOINT).toBe('https://staging.app.buildclaws.ai/api/internal/activity');
    expect(env.CLAWS_METERING_ENDPOINT).toBe('https://staging.app.buildclaws.ai/api/internal/metering');
  });

  it('accepts matching prod-shaped env (all three on same host)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.buildclaws.ai';
    process.env.METERING_ENDPOINT = 'https://app.buildclaws.ai/api/internal/metering';
    process.env.ACTIVITY_ENDPOINT = 'https://app.buildclaws.ai/api/internal/activity';
    expect(callIt).not.toThrow();
    const env = callIt();
    expect(env.CLAWS_ACTIVITY_ENDPOINT).toBe('https://app.buildclaws.ai/api/internal/activity');
  });
});
