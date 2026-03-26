import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapWorkspaceStatus, timeAgo, cn } from '@/lib/utils';

describe('mapWorkspaceStatus', () => {
  it('maps RUNNING to running', () => {
    expect(mapWorkspaceStatus('RUNNING')).toBe('running');
  });

  it('maps PAUSED to paused', () => {
    expect(mapWorkspaceStatus('PAUSED')).toBe('paused');
  });

  it('maps ERROR to error', () => {
    expect(mapWorkspaceStatus('ERROR')).toBe('error');
  });

  it('maps DRAFT to draft', () => {
    expect(mapWorkspaceStatus('DRAFT')).toBe('draft');
  });

  it('maps SETUP_INCOMPLETE to setup', () => {
    expect(mapWorkspaceStatus('SETUP_INCOMPLETE')).toBe('setup');
  });

  it('maps DEPLOYING to deploying', () => {
    expect(mapWorkspaceStatus('DEPLOYING')).toBe('deploying');
  });

  it('maps STOPPED to stopped', () => {
    expect(mapWorkspaceStatus('STOPPED')).toBe('stopped');
  });

  it('returns draft for unknown status', () => {
    expect(mapWorkspaceStatus('SOMETHING_UNKNOWN')).toBe('draft');
  });

  it('returns draft for empty string', () => {
    expect(mapWorkspaceStatus('')).toBe('draft');
  });
});

describe('timeAgo', () => {
  const FIXED_NOW = new Date('2026-03-27T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps under 60 seconds ago', () => {
    const tenSecondsAgo = new Date(FIXED_NOW - 10_000).toISOString();
    expect(timeAgo(tenSecondsAgo)).toBe('just now');
  });

  it('returns "1 min ago" at exactly 60 seconds', () => {
    const oneMinAgo = new Date(FIXED_NOW - 60_000).toISOString();
    expect(timeAgo(oneMinAgo)).toBe('1 min ago');
  });

  it('returns minutes for timestamps within an hour', () => {
    const fiveMinAgo = new Date(FIXED_NOW - 5 * 60_000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5 min ago');
  });

  it('returns hours for timestamps within a day', () => {
    const threeHoursAgo = new Date(FIXED_NOW - 3 * 3600_000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for timestamps older than a day', () => {
    const twoDaysAgo = new Date(FIXED_NOW - 2 * 86400_000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe('2d ago');
  });
});

describe('cn', () => {
  it('merges tailwind classes', () => {
    const result = cn('p-4', 'p-6');
    expect(result).toBe('p-6');
  });

  it('handles conditional classes', () => {
    const result = cn('text-sm', false && 'hidden', 'font-bold');
    expect(result).toBe('text-sm font-bold');
  });

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('');
  });
});
