import { describe, it, expect } from 'vitest';
import { buildHeartbeatSchedule } from '@/lib/openclaw/generator';

describe('buildHeartbeatSchedule', () => {
  const TZ = 'America/New_York';
  // Stable agent slug used across tests. PR-2b #8/#9 threading.
  const SLUG = 'dispatch-commander';

  describe('off / unknown / null', () => {
    it('returns null for "off"', () => {
      expect(buildHeartbeatSchedule('off', null, TZ, SLUG)).toBeNull();
    });

    it('returns null for null frequency', () => {
      expect(buildHeartbeatSchedule(null, null, TZ, SLUG)).toBeNull();
    });

    it('returns null for undefined frequency', () => {
      expect(buildHeartbeatSchedule(undefined, undefined, undefined, SLUG)).toBeNull();
    });

    it('returns null for empty string frequency', () => {
      expect(buildHeartbeatSchedule('', '08:00', TZ, SLUG)).toBeNull();
    });

    it('returns null for unknown frequency', () => {
      expect(buildHeartbeatSchedule('every_minute', '08:00', TZ, SLUG)).toBeNull();
      expect(buildHeartbeatSchedule('weekly', '08:00', TZ, SLUG)).toBeNull();
      expect(buildHeartbeatSchedule('garbage', '08:00', TZ, SLUG)).toBeNull();
    });
  });

  describe('interval frequencies (cron/jobs.json path)', () => {
    it('maps "hourly" to cron "0 * * * *"', () => {
      const result = buildHeartbeatSchedule('hourly', null, TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule).toEqual({ kind: 'cron', expr: '0 * * * *', tz: TZ });
    });

    it('maps "every_6h" to cron "0 */6 * * *"', () => {
      const result = buildHeartbeatSchedule('every_6h', null, TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.expr).toBe('0 */6 * * *');
    });

    it('maps "every_12h" to cron "0 */12 * * *"', () => {
      const result = buildHeartbeatSchedule('every_12h', null, TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.expr).toBe('0 */12 * * *');
    });

    it('ignores time argument for interval frequencies', () => {
      const result = buildHeartbeatSchedule('hourly', '14:30', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 * * * *');
    });

    it('stamps workspace timezone on interval crons', () => {
      const result = buildHeartbeatSchedule('every_6h', null, 'Asia/Kolkata', SLUG);
      expect(result?.cronJob?.schedule.tz).toBe('Asia/Kolkata');
    });
  });

  describe('time-of-day frequencies (cron/jobs.json path)', () => {
    it('maps daily at 08:00 to cron "0 8 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.kind).toBe('cron');
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
      expect(result?.cronJob?.schedule.tz).toBe(TZ);
    });

    it('maps daily at 14:30 to cron "30 14 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '14:30', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('30 14 * * *');
    });

    it('maps daily at 00:00 to cron "0 0 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '00:00', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 0 * * *');
    });

    it('maps daily at 23:59 to cron "59 23 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '23:59', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('59 23 * * *');
    });

    it('handles single-digit hour string "9:30" as cron "30 9 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '9:30', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('30 9 * * *');
    });

    it('maps weekday at 09:00 to cron "0 9 * * 1-5"', () => {
      const result = buildHeartbeatSchedule('weekday', '09:00', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 9 * * 1-5');
    });

    it('maps weekday at 17:30 to cron "30 17 * * 1-5"', () => {
      const result = buildHeartbeatSchedule('weekday', '17:30', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('30 17 * * 1-5');
    });

    it('uses 08:00 default when time is null for daily', () => {
      const result = buildHeartbeatSchedule('daily', null, TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('uses 08:00 default when time is empty string for daily', () => {
      const result = buildHeartbeatSchedule('daily', '', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('uses 08:00 default when time is undefined for weekday', () => {
      const result = buildHeartbeatSchedule('weekday', undefined, TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * 1-5');
    });

    it('preserves timezone in cron job schedule', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', 'Asia/Kolkata', SLUG);
      expect(result?.cronJob?.schedule.tz).toBe('Asia/Kolkata');
    });

    it('omits timezone field when timezone is null', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', null, SLUG);
      expect(result?.cronJob?.schedule.tz).toBeUndefined();
    });

    it('omits timezone field when timezone is empty string', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', '', SLUG);
      expect(result?.cronJob?.schedule.tz).toBeUndefined();
    });
  });

  describe('cron job structural fields (verified shape)', () => {
    it('builds a cron job with all required OpenClaw fields', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const job = result?.cronJob;
      expect(job).toBeDefined();
      expect(typeof job!.name).toBe('string');
      expect(job!.name.length).toBeGreaterThan(0);
      expect(typeof job!.description).toBe('string');
      expect(job!.enabled).toBe(true);
      expect(job!.deleteAfterRun).toBe(false);
      expect(job!.wakeMode).toBe('now');
      expect(job!.payload.kind).toBe('agentTurn');
      expect(typeof job!.payload.message).toBe('string');
      expect(job!.payload.message.length).toBeGreaterThan(0);
    });

    it('uses distinct names for daily vs weekday cron jobs', () => {
      const daily = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const weekday = buildHeartbeatSchedule('weekday', '08:00', TZ, SLUG);
      expect(daily?.cronJob?.name).not.toBe(weekday?.cronJob?.name);
    });

    it('does NOT include the invented lightContext field on payload', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const payload = result?.cronJob?.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('lightContext');
    });

    it('does NOT include the invented assistant field at top-level', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(job).not.toHaveProperty('assistant');
    });

    it('does NOT include the invented cronExpression field', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const sched = result?.cronJob?.schedule as unknown as Record<string, unknown>;
      expect(sched).not.toHaveProperty('cronExpression');
    });

    it('does NOT include the invented timezone field at top-level (it lives under schedule.tz)', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(job).not.toHaveProperty('timezone');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // PR-2b items #8 and #9: contract tests for the cron-job shape OpenClaw
  // actually accepts. Each test below is anchored to a specific bug that
  // would cause real workspaces' heartbeats to silently fail to fire.
  // ───────────────────────────────────────────────────────────────────

  describe('PR-2b #8: cron id field (required by load - missing-id check at upstream cron/persisted-shape.ts:13-16)', () => {
    it('MUTATION-anchored: emits id as a non-empty string for daily', () => {
      // If we accidentally drop the id field, upstream
      // getInvalidPersistedCronJobReason() returns "missing-id" and the
      // job is silently skipped at load. This is the platform-wide bug
      // we discovered during PR-2 validation. The test fails if id is
      // unset, empty, or non-string.
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(job).toHaveProperty('id');
      expect(typeof job.id).toBe('string');
      expect(String(job.id).trim().length).toBeGreaterThan(0);
    });

    it('emits id as a non-empty string for weekday', () => {
      const result = buildHeartbeatSchedule('weekday', '08:00', TZ, SLUG);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(typeof job.id).toBe('string');
      expect(String(job.id).trim().length).toBeGreaterThan(0);
    });

    it('id is multi-agent-safe (includes the agent slug, not the literal "orchestrator")', () => {
      // Future-proofing for per-agent heartbeats. If we ever emit
      // multiple heartbeat crons in one container's store, ids must
      // collide-free. Two different orchestrator slugs would otherwise
      // collide if the id were "heartbeat-orchestrator-daily".
      const a = buildHeartbeatSchedule('daily', '08:00', TZ, 'orchestrator-a');
      const b = buildHeartbeatSchedule('daily', '08:00', TZ, 'orchestrator-b');
      expect(a?.cronJob?.id).not.toBe(b?.cronJob?.id);
      expect(a?.cronJob?.id).toContain('orchestrator-a');
      expect(b?.cronJob?.id).toContain('orchestrator-b');
    });

    it('id is deterministic across calls (same inputs → same id; redeploys do not churn the id)', () => {
      const a = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const b = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      expect(a?.cronJob?.id).toBe(b?.cronJob?.id);
    });
  });

  describe('PR-2b #9: agentId + sessionTarget for agentTurn payloads', () => {
    it('emits agentId equal to the orchestrator slug', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      expect(result?.cronJob?.agentId).toBe(SLUG);
    });

    it('emits sessionTarget in the session:agent:<slug>:main shape (NOT the literal "main")', () => {
      // Upstream src/cron/service/jobs.ts:267-268 rejects:
      //   sessionTarget="main" && payload.kind="agentTurn"
      //   → "main cron jobs require payload.kind=\"systemEvent\""
      // The previous PR-2 value of "main" hit that rejection silently
      // (cron loaded, but at fire time the validation skipped the run
      // with state.lastStatus="skipped"). The test below would catch a
      // regression to "main", "isolated", or anything else that isn't
      // a session-keyed target.
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      expect(result?.cronJob?.sessionTarget).toBe(`session:agent:${SLUG}:main`);
    });

    it('sessionTarget threads the actual agent slug (not a hardcoded "orchestrator")', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, 'study-commander');
      expect(result?.cronJob?.sessionTarget).toBe('session:agent:study-commander:main');
    });

    it('weekday and daily both use session-keyed sessionTarget', () => {
      const daily = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      const weekday = buildHeartbeatSchedule('weekday', '08:00', TZ, SLUG);
      expect(daily?.cronJob?.sessionTarget).toBe(`session:agent:${SLUG}:main`);
      expect(weekday?.cronJob?.sessionTarget).toBe(`session:agent:${SLUG}:main`);
    });

    it('sessionTarget is NEVER the literal "main" (would be rejected at fire time for agentTurn)', () => {
      // Stronger negative check: enumerate all our supported cron
      // frequencies and assert none use "main".
      for (const freq of ['daily', 'weekday']) {
        const result = buildHeartbeatSchedule(freq, '08:00', TZ, SLUG);
        expect(result?.cronJob?.sessionTarget).not.toBe('main');
      }
    });

    it('sessionTarget is NEVER "isolated" (would lose memory continuity for the orchestrator main session)', () => {
      // Strong assertion: "isolated" passes upstream validation but
      // routes to a throwaway session named cron:<jobId>, not the
      // orchestrator's main session. Heartbeats need full context to
      // read HEARTBEAT.md against memory/transcripts. If a future
      // refactor switches to "isolated" by accident, this test catches it.
      for (const freq of ['daily', 'weekday']) {
        const result = buildHeartbeatSchedule(freq, '08:00', TZ, SLUG);
        expect(result?.cronJob?.sessionTarget).not.toBe('isolated');
      }
    });
  });

  describe('cross-reference: orchestrator-heartbeat- name prefix (plugin filter)', () => {
    // The activity-reporter plugin filters cron_changed events by
    // checking job.name.startsWith('orchestrator-heartbeat-'). If the
    // name prefix is renamed without updating the plugin, HEARTBEAT
    // activity rows go silent. Pin the prefix so a rename trips this test.
    it('cron job name starts with "orchestrator-heartbeat-"', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ, SLUG);
      expect(result?.cronJob?.name.startsWith('orchestrator-heartbeat-')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // PR-2c: TEST-ONLY `test_5min` frequency. Emits a cron-shaped job
  // (NOT an interval) with */5 * * * * so wire-validation deploys can
  // redeploy-then-wait-5-min instead of racing a wall-clock fire window.
  // ───────────────────────────────────────────────────────────────────
  describe('PR-2c TEST-ONLY: test_5min frequency', () => {
    it('emits a cron job (NOT an interval) with */5 * * * * expression', () => {
      const result = buildHeartbeatSchedule('test_5min', null, null, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.kind).toBe('cron');
      expect(result?.cronJob?.schedule.expr).toBe('*/5 * * * *');
    });

    it('test_5min preserves all PR-2b correctness fields (id, agentId, session-keyed sessionTarget, plugin-filter-matching name)', () => {
      const result = buildHeartbeatSchedule('test_5min', null, null, SLUG);
      const job = result?.cronJob;
      expect(job?.id).toBe(`heartbeat-${SLUG}-test_5min`);
      expect(job?.agentId).toBe(SLUG);
      expect(job?.sessionTarget).toBe(`session:agent:${SLUG}:main`);
      // The plugin's isHeartbeatJob filter checks job.name.startsWith(
      // 'orchestrator-heartbeat-'). If this prefix ever breaks, HEARTBEAT
      // activity rows go silent.
      expect(job?.name.startsWith('orchestrator-heartbeat-')).toBe(true);
      expect(job?.payload.kind).toBe('agentTurn');
      expect(job?.wakeMode).toBe('now');
      expect(job?.enabled).toBe(true);
      expect(job?.deleteAfterRun).toBe(false);
    });

    it('test_5min ignores time + timezone args (interval-style cron, no tz needed)', () => {
      // Whatever the operator passes for time/timezone, the cron is
      // always */5 * * * * with no tz field. Predictable for testing.
      const a = buildHeartbeatSchedule('test_5min', '08:00', 'America/New_York', SLUG);
      const b = buildHeartbeatSchedule('test_5min', null, null, SLUG);
      expect(a?.cronJob?.schedule).toEqual({ kind: 'cron', expr: '*/5 * * * *' });
      expect(b?.cronJob?.schedule).toEqual({ kind: 'cron', expr: '*/5 * * * *' });
      // Explicit assertion that we omitted the tz field (the cron expr
      // is timezone-agnostic for */5 - but we still want the absence
      // documented so a future refactor doesn't accidentally add it).
      expect(a?.cronJob?.schedule as unknown as Record<string, unknown>).not.toHaveProperty('tz');
    });
  });

  describe('invalid time fallback', () => {
    it('defaults daily to 08:00 when time is "not-a-time"', () => {
      const result = buildHeartbeatSchedule('daily', 'not-a-time', TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('defaults daily to 08:00 when hour is out of range', () => {
      expect(buildHeartbeatSchedule('daily', '24:00', TZ, SLUG)?.cronJob?.schedule.expr).toBe('0 8 * * *');
      expect(buildHeartbeatSchedule('daily', '25:30', TZ, SLUG)?.cronJob?.schedule.expr).toBe('0 8 * * *');
      expect(buildHeartbeatSchedule('daily', '-1:00', TZ, SLUG)?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('defaults daily to 08:00 when minute is out of range', () => {
      expect(buildHeartbeatSchedule('daily', '08:60', TZ, SLUG)?.cronJob?.schedule.expr).toBe('0 8 * * *');
      expect(buildHeartbeatSchedule('daily', '08:99', TZ, SLUG)?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('defaults daily to 08:00 when minute is missing entirely', () => {
      const result = buildHeartbeatSchedule('daily', '08', TZ, SLUG);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('defaults weekday to 08:00 with invalid time too', () => {
      const result = buildHeartbeatSchedule('weekday', 'foo:bar', TZ, SLUG);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * 1-5');
    });
  });
});
