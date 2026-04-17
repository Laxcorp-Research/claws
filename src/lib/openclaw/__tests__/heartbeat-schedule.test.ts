import { describe, it, expect } from 'vitest';
import { buildHeartbeatSchedule } from '@/lib/openclaw/generator';

describe('buildHeartbeatSchedule', () => {
  const TZ = 'America/New_York';

  describe('off / unknown / null', () => {
    it('returns null for "off"', () => {
      expect(buildHeartbeatSchedule('off', null, TZ)).toBeNull();
    });

    it('returns null for null frequency', () => {
      expect(buildHeartbeatSchedule(null, null, TZ)).toBeNull();
    });

    it('returns null for undefined frequency', () => {
      expect(buildHeartbeatSchedule(undefined, undefined, undefined)).toBeNull();
    });

    it('returns null for empty string frequency', () => {
      expect(buildHeartbeatSchedule('', '08:00', TZ)).toBeNull();
    });

    it('returns null for unknown frequency', () => {
      expect(buildHeartbeatSchedule('every_minute', '08:00', TZ)).toBeNull();
      expect(buildHeartbeatSchedule('weekly', '08:00', TZ)).toBeNull();
      expect(buildHeartbeatSchedule('garbage', '08:00', TZ)).toBeNull();
    });
  });

  describe('interval frequencies (agents.defaults.heartbeat path)', () => {
    it('maps "hourly" to { every: "1h" }', () => {
      const result = buildHeartbeatSchedule('hourly', null, TZ);
      expect(result?.intervalConfig).toEqual({ every: '1h' });
      expect(result?.cronJob).toBeUndefined();
    });

    it('maps "every_6h" to { every: "6h" }', () => {
      const result = buildHeartbeatSchedule('every_6h', null, TZ);
      expect(result?.intervalConfig).toEqual({ every: '6h' });
      expect(result?.cronJob).toBeUndefined();
    });

    it('maps "every_12h" to { every: "12h" }', () => {
      const result = buildHeartbeatSchedule('every_12h', null, TZ);
      expect(result?.intervalConfig).toEqual({ every: '12h' });
      expect(result?.cronJob).toBeUndefined();
    });

    it('ignores time argument for interval frequencies', () => {
      const result = buildHeartbeatSchedule('hourly', '14:30', TZ);
      expect(result?.intervalConfig).toEqual({ every: '1h' });
    });

    it('ignores timezone argument for interval frequencies', () => {
      const result = buildHeartbeatSchedule('every_6h', null, 'Asia/Kolkata');
      expect(result?.intervalConfig).toEqual({ every: '6h' });
    });
  });

  describe('time-of-day frequencies (cron/jobs.json path)', () => {
    it('maps daily at 08:00 to cron "0 8 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      expect(result?.intervalConfig).toBeUndefined();
      expect(result?.cronJob?.schedule.kind).toBe('cron');
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
      expect(result?.cronJob?.schedule.tz).toBe(TZ);
    });

    it('maps daily at 14:30 to cron "30 14 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '14:30', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('30 14 * * *');
    });

    it('maps daily at 00:00 to cron "0 0 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '00:00', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('0 0 * * *');
    });

    it('maps daily at 23:59 to cron "59 23 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '23:59', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('59 23 * * *');
    });

    it('handles single-digit hour string "9:30" as cron "30 9 * * *"', () => {
      const result = buildHeartbeatSchedule('daily', '9:30', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('30 9 * * *');
    });

    it('maps weekday at 09:00 to cron "0 9 * * 1-5"', () => {
      const result = buildHeartbeatSchedule('weekday', '09:00', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('0 9 * * 1-5');
    });

    it('maps weekday at 17:30 to cron "30 17 * * 1-5"', () => {
      const result = buildHeartbeatSchedule('weekday', '17:30', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('30 17 * * 1-5');
    });

    it('uses 08:00 default when time is null for daily', () => {
      const result = buildHeartbeatSchedule('daily', null, TZ);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('uses 08:00 default when time is empty string for daily', () => {
      const result = buildHeartbeatSchedule('daily', '', TZ);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * *');
    });

    it('uses 08:00 default when time is undefined for weekday', () => {
      const result = buildHeartbeatSchedule('weekday', undefined, TZ);
      expect(result?.cronJob?.schedule.expr).toBe('0 8 * * 1-5');
    });

    it('preserves timezone in cron job schedule', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', 'Asia/Kolkata');
      expect(result?.cronJob?.schedule.tz).toBe('Asia/Kolkata');
    });

    it('omits timezone field when timezone is null', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', null);
      expect(result?.cronJob?.schedule.tz).toBeUndefined();
    });

    it('omits timezone field when timezone is empty string', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', '');
      expect(result?.cronJob?.schedule.tz).toBeUndefined();
    });
  });

  describe('cron job structural fields (verified shape)', () => {
    it('builds a cron job with all required OpenClaw fields', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      const job = result?.cronJob;
      expect(job).toBeDefined();
      expect(typeof job!.name).toBe('string');
      expect(job!.name.length).toBeGreaterThan(0);
      expect(typeof job!.description).toBe('string');
      expect(job!.enabled).toBe(true);
      expect(job!.deleteAfterRun).toBe(false);
      expect(job!.sessionTarget).toBe('main');
      expect(job!.wakeMode).toBe('now');
      expect(job!.payload.kind).toBe('agentTurn');
      expect(typeof job!.payload.message).toBe('string');
      expect(job!.payload.message.length).toBeGreaterThan(0);
    });

    it('uses distinct names for daily vs weekday cron jobs', () => {
      const daily = buildHeartbeatSchedule('daily', '08:00', TZ);
      const weekday = buildHeartbeatSchedule('weekday', '08:00', TZ);
      expect(daily?.cronJob?.name).not.toBe(weekday?.cronJob?.name);
    });

    it('does NOT include the invented lightContext field on payload', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      const payload = result?.cronJob?.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('lightContext');
    });

    it('does NOT include the invented assistant field at top-level', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(job).not.toHaveProperty('assistant');
    });

    it('does NOT include the invented cronExpression field', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      const sched = result?.cronJob?.schedule as unknown as Record<string, unknown>;
      expect(sched).not.toHaveProperty('cronExpression');
    });

    it('does NOT include the invented timezone field at top-level (it lives under schedule.tz)', () => {
      const result = buildHeartbeatSchedule('daily', '08:00', TZ);
      const job = result?.cronJob as unknown as Record<string, unknown>;
      expect(job).not.toHaveProperty('timezone');
    });
  });

  describe('invalid time fallback', () => {
    it('falls back to hourly interval when time is "not-a-time"', () => {
      const result = buildHeartbeatSchedule('daily', 'not-a-time', TZ);
      expect(result?.intervalConfig).toEqual({ every: '1h' });
      expect(result?.cronJob).toBeUndefined();
    });

    it('falls back to hourly interval when hour is out of range', () => {
      expect(buildHeartbeatSchedule('daily', '24:00', TZ)?.intervalConfig).toEqual({ every: '1h' });
      expect(buildHeartbeatSchedule('daily', '25:30', TZ)?.intervalConfig).toEqual({ every: '1h' });
      expect(buildHeartbeatSchedule('daily', '-1:00', TZ)?.intervalConfig).toEqual({ every: '1h' });
    });

    it('falls back to hourly interval when minute is out of range', () => {
      expect(buildHeartbeatSchedule('daily', '08:60', TZ)?.intervalConfig).toEqual({ every: '1h' });
      expect(buildHeartbeatSchedule('daily', '08:99', TZ)?.intervalConfig).toEqual({ every: '1h' });
    });

    it('falls back to hourly interval when minute is missing entirely', () => {
      const result = buildHeartbeatSchedule('daily', '08', TZ);
      expect(result?.intervalConfig).toEqual({ every: '1h' });
    });

    it('falls back for weekday with invalid time too', () => {
      const result = buildHeartbeatSchedule('weekday', 'foo:bar', TZ);
      expect(result?.intervalConfig).toEqual({ every: '1h' });
      expect(result?.cronJob).toBeUndefined();
    });
  });
});
