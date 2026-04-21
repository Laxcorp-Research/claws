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

  it('throws rather than emitting COMPOSIO_API_KEY without a user-id pin (fail-closed security boundary)', () => {
    // This is the core PR #4 security invariant: the platform API key
    // must never land in a container that we cannot scope to a specific
    // user. If a future caller forgets to pass creditConfig — or passes
    // one without userId — this throw catches the regression at deploy
    // time rather than silently widening the blast radius.
    process.env.COMPOSIO_API_KEY = 'ak_platform_secret';
    expect(() =>
      buildRailwayEnvVars(minimalGenerated, workspace, undefined),
    ).toThrow(/refusing to emit platform API key without a user-id scope pin/);
  });

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

  it('does NOT throw when COMPOSIO_API_KEY is unset even if creditConfig.userId is missing (no platform key → no security boundary to enforce)', () => {
    delete process.env.COMPOSIO_API_KEY;
    expect(() =>
      buildRailwayEnvVars(minimalGenerated, workspace, undefined),
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
