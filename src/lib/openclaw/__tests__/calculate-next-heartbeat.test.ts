import { describe, it, expect } from 'vitest';
import { calculateNextHeartbeat, extractCronExpression } from '@/lib/openclaw/deployer';

describe('extractCronExpression', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(extractCronExpression(null)).toBeNull();
    expect(extractCronExpression(undefined)).toBeNull();
    expect(extractCronExpression({})).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(extractCronExpression('foo')).toBeNull();
    expect(extractCronExpression(42)).toBeNull();
    expect(extractCronExpression(true)).toBeNull();
  });

  it('extracts expr from verified OpenClaw object shape', () => {
    expect(extractCronExpression({ schedule: { kind: 'cron', expr: '0 8 * * *' } })).toBe('0 8 * * *');
    expect(extractCronExpression({ schedule: { kind: 'cron', expr: '*/5 * * * *', tz: 'UTC' } })).toBe('*/5 * * * *');
  });

  it('returns null for non-cron schedule kinds (every, at)', () => {
    expect(extractCronExpression({ schedule: { kind: 'every', everyMs: 60000 } })).toBeNull();
    expect(extractCronExpression({ schedule: { kind: 'at', at: '2026-01-01T00:00:00Z' } })).toBeNull();
  });

  it('returns null for malformed schedule object', () => {
    expect(extractCronExpression({ schedule: { kind: 'cron' } })).toBeNull();
    expect(extractCronExpression({ schedule: { kind: 'cron', expr: '' } })).toBeNull();
    expect(extractCronExpression({ schedule: { kind: 'cron', expr: 42 } })).toBeNull();
    expect(extractCronExpression({ schedule: {} })).toBeNull();
  });

  it('falls back to schedule string (legacy)', () => {
    expect(extractCronExpression({ schedule: '0 8 * * *' })).toBe('0 8 * * *');
  });

  it('falls back to cron string (legacy)', () => {
    expect(extractCronExpression({ cron: '0 8 * * *' })).toBe('0 8 * * *');
  });

  it('prefers schedule object over cron string when both present', () => {
    expect(
      extractCronExpression({
        schedule: { kind: 'cron', expr: '0 8 * * *' },
        cron: '0 0 * * *',
      })
    ).toBe('0 8 * * *');
  });
});

describe('calculateNextHeartbeat', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(calculateNextHeartbeat(null)).toBeNull();
    expect(calculateNextHeartbeat(undefined)).toBeNull();
    expect(calculateNextHeartbeat('')).toBeNull();
    expect(calculateNextHeartbeat('[]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(calculateNextHeartbeat('{not-valid-json')).toBeNull();
  });

  it('returns null for non-array root', () => {
    expect(calculateNextHeartbeat('{}')).toBeNull();
    expect(calculateNextHeartbeat('"foo"')).toBeNull();
    expect(calculateNextHeartbeat('42')).toBeNull();
  });

  it('returns null when no jobs have parseable cron expressions', () => {
    const json = JSON.stringify([
      { schedule: { kind: 'every', everyMs: 60000 } },
      { schedule: { kind: 'at', at: '2026-01-01T00:00:00Z' } },
    ]);
    expect(calculateNextHeartbeat(json)).toBeNull();
  });

  it('returns a Date for a valid cron job (object schedule shape)', () => {
    const json = JSON.stringify([
      { schedule: { kind: 'cron', expr: '0 8 * * *' } },
    ]);
    const result = calculateNextHeartbeat(json);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns a Date when schedule is a legacy string (defensive fallback)', () => {
    const json = JSON.stringify([
      { schedule: '0 8 * * *' },
    ]);
    const result = calculateNextHeartbeat(json);
    expect(result).toBeInstanceOf(Date);
  });

  it('honours timezone in the schedule when computing next fire', () => {
    // Pick a daily-at-08:00 schedule and verify the parser doesn't blow up
    // when tz is supplied. Two different timezones should yield different
    // next-fire times (unless the test happens to run at exactly the boundary
    // — extremely unlikely).
    const utcJson = JSON.stringify([
      { schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'UTC' } },
    ]);
    const istJson = JSON.stringify([
      { schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Kolkata' } },
    ]);
    const utcNext = calculateNextHeartbeat(utcJson);
    const istNext = calculateNextHeartbeat(istJson);
    expect(utcNext).toBeInstanceOf(Date);
    expect(istNext).toBeInstanceOf(Date);
    expect(utcNext!.getTime()).not.toBe(istNext!.getTime());
  });

  it('returns the EARLIEST of multiple valid cron jobs', () => {
    // 0 1 * * * fires at 01:00; 0 5 * * * fires at 05:00. Earliest of any
    // current time is the next 01:00 mark.
    const json = JSON.stringify([
      { schedule: { kind: 'cron', expr: '0 5 * * *', tz: 'UTC' } },
      { schedule: { kind: 'cron', expr: '0 1 * * *', tz: 'UTC' } },
    ]);
    const result = calculateNextHeartbeat(json);
    expect(result).toBeInstanceOf(Date);
    // Verify it's the 1AM job by parsing the result hour in UTC
    expect(result!.getUTCHours()).toBe(1);
  });

  it('skips jobs with invalid cron expressions and uses the valid ones', () => {
    const json = JSON.stringify([
      { schedule: { kind: 'cron', expr: 'totally-bogus' } },
      { schedule: { kind: 'cron', expr: '0 8 * * *' } },
    ]);
    const result = calculateNextHeartbeat(json);
    expect(result).toBeInstanceOf(Date);
  });

  it('returns null when ALL cron expressions are invalid', () => {
    const json = JSON.stringify([
      { schedule: { kind: 'cron', expr: 'totally-bogus' } },
      { schedule: { kind: 'cron', expr: 'also-bogus' } },
    ]);
    expect(calculateNextHeartbeat(json)).toBeNull();
  });

  it('handles realistic generator output (full heartbeat job shape)', () => {
    const json = JSON.stringify([
      {
        name: 'orchestrator-heartbeat-daily',
        description: 'Orchestrator heartbeat (daily at 08:00 America/New_York)',
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'America/New_York' },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: { kind: 'agentTurn', message: 'Heartbeat. Read HEARTBEAT.md...' },
      },
    ]);
    const result = calculateNextHeartbeat(json);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThan(Date.now());
  });
});
