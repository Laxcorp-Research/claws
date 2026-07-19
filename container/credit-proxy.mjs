// Credit metering proxy for Claws containers.
// Intercepts Anthropic API calls, checks credit balance,
// forwards using platform master key, reports usage in batches.
//
// Only runs when CLAWS_CREDIT_MODE=true.
// Listens on 127.0.0.1:3789 (not accessible from outside container).

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Config ─────────────────────────────────────────────

const PORT = 3789;
const HOST = '127.0.0.1';
const REAL_ANTHROPIC_URL = 'https://api.anthropic.com';
const MASTER_KEY = process.env.ANTHROPIC_API_KEY;
const METERING_ENDPOINT = process.env.CLAWS_METERING_ENDPOINT;
const METERING_SECRET = process.env.CLAWS_METERING_SECRET;
const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID;
const USER_ID = process.env.CLAWS_USER_ID;

function isDirectEntrypoint() {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] && path.resolve(process.argv[1]);
    return Boolean(invoked) && thisFile === invoked;
  } catch {
    return true;
  }
}

// Only exit-on-missing-env when running as the container entrypoint (not unit tests).
if (
  isDirectEntrypoint() &&
  (!MASTER_KEY || !METERING_ENDPOINT || !METERING_SECRET || !WORKSPACE_ID || !USER_ID)
) {
  console.error('[credit-proxy] Missing required env vars');
  process.exit(1);
}

// ─── Pricing (must match src/lib/credits/pricing.ts) ────

const MODEL_PRICING = {
  'claude-haiku-4-5':  { inputPer1M: 100,  outputPer1M: 500 },
  'claude-sonnet-4-6': { inputPer1M: 300,  outputPer1M: 1500 },
  'claude-opus-4-6':   { inputPer1M: 1500, outputPer1M: 7500 },
};
const DEFAULT_PRICING = MODEL_PRICING['claude-sonnet-4-6'];

function calculateCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model] || DEFAULT_PRICING;
  return Math.ceil((inputTokens / 1e6) * p.inputPer1M)
       + Math.ceil((outputTokens / 1e6) * p.outputPer1M);
}

function estimateCost(model, estimatedInputTokens) {
  return calculateCost(model, estimatedInputTokens, estimatedInputTokens * 2);
}

// ─── Credit Window ──────────────────────────────────────
// Pre-reserves a chunk from Redis via platform API.
// Draws down locally until exhausted, then fetches another.

class CreditWindow {
  constructor() {
    this.windowCents = 0;
    this.lastKnownBalance = null;
  }

  get windowSizeCents() {
    if (this.lastKnownBalance !== null && this.lastKnownBalance < 500) return 50;
    if (this.lastKnownBalance !== null && this.lastKnownBalance < 1000) return 100;
    return 200;
  }

  async canSpend(estimatedCents) {
    if (this.windowCents >= estimatedCents) {
      this.windowCents -= estimatedCents;
      return { allowed: true };
    }

    if (this.windowCents > 0) {
      this.releaseUnused(this.windowCents);
      this.windowCents = 0;
    }

    try {
      const res = await fetch(`${METERING_ENDPOINT}/reserve-window`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Metering-Secret': METERING_SECRET,
        },
        body: JSON.stringify({
          userId: USER_ID,
          windowSizeCents: this.windowSizeCents,
        }),
        signal: AbortSignal.timeout(5000),
      });

      const data = await res.json();

      if (!data.data?.allowed) {
        return { allowed: false, reason: data.data?.reason || 'INSUFFICIENT_CREDITS' };
      }

      this.lastKnownBalance = data.data.remainingCents;
      this.windowCents = this.windowSizeCents - estimatedCents;
      return { allowed: true };
    } catch {
      return this.degradedCheck(estimatedCents);
    }
  }

  refund(cents) {
    this.windowCents += cents;
  }

  releaseUnused(cents) {
    fetch(`${METERING_ENDPOINT}/release-reservation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metering-Secret': METERING_SECRET,
      },
      body: JSON.stringify({ userId: USER_ID, releaseCents: cents }),
    }).catch(() => {});
  }

  // ─── Degradation Mode ──────────────────────────────────

  degradedCheck(estimatedCents) {
    const state = this.loadDegradationState();
    const elapsed = (Date.now() - (state.since || Date.now())) / 1000;

    if (elapsed > 3600 || state.calls >= 50 || state.cost + estimatedCents > 1000) {
      return { allowed: false, reason: 'PLATFORM_UNREACHABLE_LIMITS_HIT' };
    }

    state.since = state.since || Date.now();
    state.calls++;
    state.cost += estimatedCents;
    this.saveDegradationState(state);

    return { allowed: true };
  }

  loadDegradationState() {
    try {
      return JSON.parse(fs.readFileSync('/home/node/.openclaw/.degradation-state.json', 'utf8'));
    } catch {
      return { since: null, calls: 0, cost: 0 };
    }
  }

  saveDegradationState(state) {
    try {
      fs.writeFileSync('/home/node/.openclaw/.degradation-state.json', JSON.stringify(state));
    } catch {}
  }

  clearDegradationState() {
    try { fs.unlinkSync('/home/node/.openclaw/.degradation-state.json'); } catch {}
  }
}

// ─── Usage Reporter ─────────────────────────────────────

class UsageReporter {
  constructor() {
    this.pending = [];
    this.MAX_PENDING = 500;
    this.dropped = 0;
    this.flushInterval = setInterval(() => this.flush(), 10_000);
  }

  add(record) {
    if (this.pending.length >= this.MAX_PENDING) {
      this.pending.shift();
      this.dropped++;
      if (this.dropped % 50 === 0) {
        console.warn(`[credit-proxy] Dropped ${this.dropped} records (platform unreachable)`);
      }
    }
    this.pending.push(record);
    if (this.pending.length >= 20) this.flush();
  }

  /**
   * Flush up to 50 pending records. -9 observability:
   * SUCCESS → log batch size + status; FAILURE → status + requeue depth.
   * @param {{ fetchImpl?: typeof fetch, label?: string }} [opts]
   */
  async flush({ fetchImpl = fetch, label = 'flush' } = {}) {
    if (this.pending.length === 0) return { flushed: 0, ok: true };
    const batch = this.pending.splice(0, 50);
    const batchSize = batch.length;

    try {
      const res = await fetchImpl(`${METERING_ENDPOINT}/report-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Metering-Secret': METERING_SECRET,
        },
        body: JSON.stringify({ records: batch, droppedCount: this.dropped }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        this.dropped = 0;
        creditWindow.clearDegradationState();
        console.log(
          `[credit-proxy] report-batch ok n=${batchSize} status=${res.status} label=${label}`,
        );
        return { flushed: batchSize, ok: true, status: res.status };
      }
      this.pending.unshift(...batch);
      console.error(
        `[credit-proxy] report-batch failed status=${res.status} requeueDepth=${this.pending.length} label=${label}`,
      );
      return { flushed: 0, ok: false, status: res.status, requeueDepth: this.pending.length };
    } catch (err) {
      this.pending.unshift(...batch);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[credit-proxy] report-batch failed error=${msg} requeueDepth=${this.pending.length} label=${label}`,
      );
      return { flushed: 0, ok: false, error: msg, requeueDepth: this.pending.length };
    }
  }

  async shutdown() {
    clearInterval(this.flushInterval);
    const pendingBefore = this.pending.length;
    try {
      const result = await this.flush({ label: 'SIGTERM' });
      console.log(
        `[credit-proxy] SIGTERM flush pendingBefore=${pendingBefore} flushed=${result.flushed ?? 0}`,
      );
    } catch (err) {
      console.error(
        `[credit-proxy] SIGTERM flush error pendingBefore=${pendingBefore} error=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

// ─── Proxy Server ───────────────────────────────────────

const creditWindow = new CreditWindow();
const reporter = new UsageReporter();

// ─── Metered API Call Handler ────────────────────────────

async function handleApiCall(req, res, body, parsed) {
  const model = parsed.model || 'claude-sonnet-4-6';
  const isStreaming = parsed.stream === true;
  const estimatedInputTokens = Math.ceil(body.length / 4);
  const estimatedCost = estimateCost(model, estimatedInputTokens);

  const check = await creditWindow.canSpend(estimatedCost);
  if (!check.allowed) {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: {
        type: 'credits_exhausted',
        message: check.reason || 'Claws Starter Credits exhausted. Add your own API key to continue.',
      },
    }));
    return;
  }

  try {
    const anthropicRes = await fetch(`${REAL_ANTHROPIC_URL}${req.url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MASTER_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        ...(req.headers['anthropic-beta'] ? { 'anthropic-beta': req.headers['anthropic-beta'] } : {}),
      },
      body: body,
      signal: AbortSignal.timeout(600_000),
    });

    const contentType = anthropicRes.headers.get('Content-Type') || '';

    if (isStreaming && contentType.includes('text/event-stream')) {
      await handleStreamingResponse(req, res, anthropicRes, model, estimatedCost, body);
    } else {
      await handleBufferedResponse(req, res, anthropicRes, model, estimatedCost);
    }
  } catch (err) {
    creditWindow.refund(estimatedCost);
    console.error('[credit-proxy] Anthropic request failed:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'proxy_error', message: `Failed to reach Anthropic API: ${err.message}` },
    }));
  }
}

async function handleStreamingResponse(req, res, anthropicRes, model, estimatedCost, requestBody) {
  let inputTokens = 0;
  let outputTokens = 0;

  res.writeHead(anthropicRes.status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const reader = anthropicRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      try {
        const canContinue = res.write(chunk);
        if (!canContinue) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      } catch {
        console.error('[credit-proxy] Client disconnected during stream');
        reader.cancel().catch(() => {});
        break;
      }

      sseBuffer += chunk;
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const event = JSON.parse(dataStr);
          if (event.type === 'message_start' && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
          }
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens || 0;
          }
        } catch {
          // Partial JSON or non-JSON data line — skip
        }
      }
    }
  } catch (err) {
    console.error('[credit-proxy] Stream read error:', err.message);
  } finally {
    res.end();
  }

  if (inputTokens === 0 && outputTokens === 0) {
    inputTokens = Math.ceil(requestBody.length / 4);
    outputTokens = inputTokens;
    console.warn('[credit-proxy] No usage data in stream, using estimates');
  }

  const actualCost = calculateCost(model, inputTokens, outputTokens);

  if (estimatedCost > actualCost) {
    creditWindow.refund(estimatedCost - actualCost);
  } else if (actualCost > estimatedCost) {
    creditWindow.windowCents -= (actualCost - estimatedCost);
  }

  reporter.add({
    workspaceId: WORKSPACE_ID,
    agentId: req.headers['x-agent-id'] || null,
    provider: 'ANTHROPIC',
    model,
    inputTokens,
    outputTokens,
    costCents: actualCost,
    timestamp: new Date().toISOString(),
  });
}

async function handleBufferedResponse(req, res, anthropicRes, model, estimatedCost) {
  const responseBody = await anthropicRes.text();

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const responseData = JSON.parse(responseBody);
    inputTokens = responseData.usage?.input_tokens || 0;
    outputTokens = responseData.usage?.output_tokens || 0;
  } catch {
    const estimated = Math.ceil(responseBody.length / 4);
    inputTokens = estimated;
    outputTokens = estimated;
  }

  const actualCost = calculateCost(model, inputTokens, outputTokens);

  if (estimatedCost > actualCost) {
    creditWindow.refund(estimatedCost - actualCost);
  } else if (actualCost > estimatedCost) {
    creditWindow.windowCents -= (actualCost - estimatedCost);
  }

  reporter.add({
    workspaceId: WORKSPACE_ID,
    agentId: req.headers['x-agent-id'] || null,
    provider: 'ANTHROPIC',
    model,
    inputTokens,
    outputTokens,
    costCents: actualCost,
    timestamp: new Date().toISOString(),
  });

  res.writeHead(anthropicRes.status, {
    'Content-Type': anthropicRes.headers.get('Content-Type') || 'application/json',
  });
  res.end(responseBody);
}

// ─── Server ─────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST') {
    await proxyPassthrough(req, res);
    return;
  }

  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { message: 'Failed to read request body' } }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString());
  } catch {
    await forwardToAnthropic(req, res, body);
    return;
  }

  await handleApiCall(req, res, body, parsed);
});

async function proxyPassthrough(req, res) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const anthropicRes = await fetch(`${REAL_ANTHROPIC_URL}${req.url}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'x-api-key': MASTER_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
      },
      body: body.length > 0 ? body : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const responseBody = await anthropicRes.text();
    res.writeHead(anthropicRes.status, {
      'Content-Type': anthropicRes.headers.get('Content-Type') || 'application/json',
    });
    res.end(responseBody);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { message: err.message } }));
  }
}

async function forwardToAnthropic(req, res, body) {
  try {
    const anthropicRes = await fetch(`${REAL_ANTHROPIC_URL}${req.url}`, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'x-api-key': MASTER_KEY,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
      },
      body: body,
      signal: AbortSignal.timeout(30_000),
    });

    const responseBody = await anthropicRes.text();
    res.writeHead(anthropicRes.status, {
      'Content-Type': anthropicRes.headers.get('Content-Type') || 'application/json',
    });
    res.end(responseBody);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { message: err.message } }));
  }
}

// ─── Graceful Shutdown ──────────────────────────────────

async function shutdown(signal) {
  console.log(`[credit-proxy] ${signal} received, shutting down...`);

  if (creditWindow.windowCents > 0) {
    creditWindow.releaseUnused(creditWindow.windowCents);
  }

  await reporter.shutdown();

  server.close(() => {
    console.log('[credit-proxy] Server closed');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 5000);
}

export const __test__ = {
  UsageReporter,
  isDirectEntrypoint,
  shutdown,
};

// ─── Start Server (entrypoint only — vitest imports must not listen) ───

if (isDirectEntrypoint()) {
  server.listen(PORT, HOST, () => {
    console.log(`[credit-proxy] Listening on ${HOST}:${PORT}`);
    console.log(`[credit-proxy] Workspace: ${WORKSPACE_ID}`);
    console.log(`[credit-proxy] Metering: ${METERING_ENDPOINT}`);
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > 50 * 1024 * 1024) {
      console.error(
        `[credit-proxy] Memory leak detected (${Math.round(mem.heapUsed / 1024 / 1024)}MB), exiting for restart`,
      );
      shutdown('MEMORY_LIMIT').catch(() => process.exit(1));
    }
  }, 30_000);

  process.on('uncaughtException', (err) => {
    console.error('[credit-proxy] Uncaught exception:', err);
    shutdown('UNCAUGHT_EXCEPTION').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[credit-proxy] Unhandled rejection:', reason);
  });
}
