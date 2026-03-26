import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent timestamps', () => {
    const result = timeAgo(new Date().toISOString());
    expect(result).toBe('just now');
  });

  it('returns minutes for timestamps within an hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5 min ago');
  });

  it('returns hours for timestamps within a day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for timestamps older than a day', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
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
