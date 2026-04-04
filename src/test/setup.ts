import { vi } from 'vitest';

process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);
process.env.ENCRYPTION_KEY_VERSION = 'v1';
process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

vi.mock('@axiomhq/nextjs', () => ({
  createAxiomRouteHandler: () => (handler: Function) => handler,
  createProxyRouteHandler: () => async () => new Response('ok'),
  nextJsFormatters: [],
}));

vi.mock('@axiomhq/logging', () => {
  const noop = () => {};
  class MockTransport { constructor() {} }
  class MockLogger {
    info = noop; warn = noop; error = noop; debug = noop; log = noop; flush = async () => {};
    constructor() {}
  }
  return {
    Logger: MockLogger,
    ConsoleTransport: MockTransport,
    AxiomJSTransport: MockTransport,
    ProxyTransport: MockTransport,
  };
});

vi.mock('@axiomhq/js', () => ({
  Axiom: class { constructor() {} ingest() {} flush() {} },
}));
