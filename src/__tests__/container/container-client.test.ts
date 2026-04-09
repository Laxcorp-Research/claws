import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: {
    deployEvent: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Container Client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isContainerHostConfigured returns false without env vars', async () => {
    const originalHost = process.env.CONTAINER_HOST;
    const originalSecret = process.env.CONTAINER_AGENT_SECRET;
    delete process.env.CONTAINER_HOST;
    delete process.env.CONTAINER_AGENT_SECRET;

    const { isContainerHostConfigured } = await import('@/lib/container-client');
    expect(isContainerHostConfigured()).toBe(false);

    if (originalHost) process.env.CONTAINER_HOST = originalHost;
    if (originalSecret) process.env.CONTAINER_AGENT_SECRET = originalSecret;
  });

  it('isContainerHostConfigured returns true when both env vars set', async () => {
    const originalHost = process.env.CONTAINER_HOST;
    const originalSecret = process.env.CONTAINER_AGENT_SECRET;
    process.env.CONTAINER_HOST = 'http://localhost:9876';
    process.env.CONTAINER_AGENT_SECRET = 'test-secret';

    const { isContainerHostConfigured } = await import('@/lib/container-client');
    expect(isContainerHostConfigured()).toBe(true);

    if (originalHost) process.env.CONTAINER_HOST = originalHost;
    else delete process.env.CONTAINER_HOST;
    if (originalSecret) process.env.CONTAINER_AGENT_SECRET = originalSecret;
    else delete process.env.CONTAINER_AGENT_SECRET;
  });

  it('checkAgentHealth returns false when host not configured', async () => {
    const originalHost = process.env.CONTAINER_HOST;
    delete process.env.CONTAINER_HOST;

    const { checkAgentHealth } = await import('@/lib/container-client');
    const result = await checkAgentHealth();
    expect(result).toBe(false);

    if (originalHost) process.env.CONTAINER_HOST = originalHost;
  });

  it('exports all expected functions', async () => {
    const mod = await import('@/lib/container-client');
    expect(typeof mod.isContainerHostConfigured).toBe('function');
    expect(typeof mod.checkAgentHealth).toBe('function');
    expect(typeof mod.createContainer).toBe('function');
    expect(typeof mod.stopContainer).toBe('function');
    expect(typeof mod.startContainer).toBe('function');
    expect(typeof mod.restartContainer).toBe('function');
    expect(typeof mod.removeContainer).toBe('function');
    expect(typeof mod.inspectContainer).toBe('function');
    expect(typeof mod.getContainerLogs).toBe('function');
    expect(typeof mod.writeFilesToVolume).toBe('function');
    expect(typeof mod.listContainers).toBe('function');
    expect(typeof mod.pullImage).toBe('function');
  });
});
