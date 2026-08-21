// lib/openclaw/mcp-longtail.ts
// ============================================================================
// C-engine B1: MCP long-tail support for uncurated tool connections.
//
// A workspace is "MCP long-tail enabled" when it has at least one CONNECTED
// tool with NO matching curated Skill row (the uncurated case detected by
// generator.ts > generateSkillsEntriesConfig). For those workspaces - and
// ONLY behind the CLAWS_MCP_LONGTAIL_ENABLED kill-switch - the generator
// emits an `mcp.servers.composio` block pointing at a Composio Tool Router
// session, so agents can reach the uncurated tools through the Router's
// meta-tools (COMPOSIO_SEARCH_TOOLS / COMPOSIO_MULTI_EXECUTE_TOOL / ...).
//
// Curated-only workspaces get NO mcp block: Probe 3 measured the Router's
// upfront tool-definition injection at ~7k tokens per agent turn (before
// workbench-off + per-agent scoping), so the block must never be emitted
// where SKILL.md coverage already exists.
//
// This module owns:
//   - the kill-switch (isMcpLongtailEnabled)
//   - Tool Router session reuse-or-create with toolkit/account drift detection
//     (resolveToolRouterSession)
//   - the per-agent deny merge helper (mergeMcpDenyIntoAgentTools)
//   - the post-boot MCP endpoint probe used by the deployer's best-effort
//     cold-boot surfacing (probeMcpEndpoint)
// ============================================================================

import type { Composio } from '@composio/core';
import { getComposio, getComposioUserId } from '@/lib/composio';

/** Env kill-switch. Default OFF everywhere; only 'true' enables. */
export function isMcpLongtailEnabled(): boolean {
  return process.env.CLAWS_MCP_LONGTAIL_ENABLED === 'true';
}

/**
 * Glob denied on every NON-Orchestrator agent in an MCP-enabled workspace.
 * Bundle-MCP tools are registered as `<serverName>__<toolName>` (e.g.
 * `composio__COMPOSIO_SEARCH_TOOLS`); the runtime's tool-policy matcher
 * compiles deny entries as globs (upstream v2026.5.22
 * dist/tool-policy-match: makeToolPolicyMatcher → compileGlobPatterns), so
 * this one pattern removes every Router tool from workers/critic - the
 * token-tax scoping half of the Probe 3 constraints.
 */
export const MCP_TOOL_DENY_GLOB = 'composio__*';

/**
 * Merge MCP_TOOL_DENY_GLOB into an agent entry's `tools.deny`, preserving
 * any existing policy fields and deny entries (merge, never clobber).
 * Pure helper so the merge contract is unit-testable.
 */
export function mergeMcpDenyIntoAgentTools(
  existingTools: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) };
  const existingDeny = Array.isArray(tools.deny)
    ? (tools.deny as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  tools.deny = existingDeny.includes(MCP_TOOL_DENY_GLOB)
    ? existingDeny
    : [...existingDeny, MCP_TOOL_DENY_GLOB];
  return tools;
}

export interface ResolvedToolRouterSession {
  sessionId: string;
  mcpUrl: string;
  /** true when the stored session was reused (toolkit set matched). */
  reused: boolean;
}

/**
 * Narrow structural view of the SDK's raw REST client, used for the drift
 * check. `Composio.client` is typed `protected` in @composio/core 0.6.8 but
 * is a plain public property at runtime; the public `toolRouter.use()`
 * wrapper drops the session's toolkit config (returns only sessionId+mcp),
 * so the raw `session.retrieve` - whose response carries
 * `config.toolkits.{enabled,disabled}` and `config.connected_accounts` -
 * is the only way to compare the stored session's toolkit/account binding
 * against the current uncurated set without a paginated round-trip per
 * toolkit.
 */
interface ToolRouterSessionRetrieveClient {
  client: {
    toolRouter: {
      session: {
        retrieve(sessionId: string): Promise<{
          session_id: string;
          mcp: { url: string };
          config?: {
            toolkits?: { enabled?: string[]; disabled?: string[] };
            connected_accounts?: Record<string, string>;
          };
        }>;
      };
    };
  };
}

/**
 * Reuse-or-create a Tool Router session for a user, drift-aware.
 *
 * Reuse path: when a stored session id exists, retrieve it and compare its
 * enabled-toolkit set AND connected-account bindings against the CURRENT
 * uncurated map. Set-equal → reuse (keeps Router-side memory/plan-cache
 * continuity across redeploys). Any mismatch, a disabled-list-shaped config,
 * account swap (disconnect/reconnect → new ca_), or a retrieve failure (dead
 * / 404'd session) → create a fresh session scoped to the current map.
 *
 * Session shape decisions (Phase A §2/§8, approved):
 *   - toolkits.enable: allowlist of exactly the uncurated toolkits with a
 *     bindable connected account.
 *   - connectedAccounts: explicit toolkitSlug → connectedAccountId map.
 *     B1.1: Probe A (implicit default lookup) returned
 *     ToolRouterV2_NoActiveConnection for googledocs; Probe B with this map
 *     created a real Google Doc. The default Tool Router auth-config lookup
 *     does not resolve accounts provisioned by our OAuth flow reliably.
 *   - workbench.enable: false - COMPOSIO_REMOTE_WORKBENCH +
 *     COMPOSIO_REMOTE_BASH_TOOL are ~10.8KB of the 26.7KB advertised
 *     payload (Probe 3); disabling them roughly halves the token tax.
 *   - manageConnections: false - connections are managed by the Claws
 *     connect flow, never by the agent.
 *
 * Returns null when Composio is not configured (no COMPOSIO_API_KEY) -
 * quiet no-op mirroring the generator's curated OAuth branch.
 */
export async function resolveToolRouterSession(params: {
  /** Claws User.id (NOT the composio external id - mapped internally). */
  userId: string;
  storedSessionId: string | null;
  /** Composio toolkit slug → connected account id for uncurated tools. */
  connectedAccounts: Record<string, string>;
  /** Full toolkit allowlist, including no_auth toolkits without accounts. */
  toolkits?: string[];
  /** Injectable for tests. Defaults to the platform singleton. */
  composio?: Composio;
}): Promise<ResolvedToolRouterSession | null> {
  const composio = params.composio ?? getComposio();
  if (!composio) return null;

  const desiredAccounts = normalizeConnectedAccountMap(params.connectedAccounts);
  const desiredToolkitList = normalizeToolkitList(params.toolkits ?? Object.keys(desiredAccounts));
  const desired = new Set(desiredToolkitList);

  if (params.storedSessionId) {
    try {
      const rawClient = (composio as unknown as ToolRouterSessionRetrieveClient).client;
      const existing = await rawClient.toolRouter.session.retrieve(params.storedSessionId);
      const enabled = existing.config?.toolkits?.enabled;
      if (Array.isArray(enabled)) {
        const current = new Set(enabled.map((t) => t.toLowerCase()));
        const toolkitSetEqual =
          current.size === desired.size && [...desired].every((t) => current.has(t));
        const accountMapEqual = connectedAccountMapsEqual(
          desiredAccounts,
          normalizeConnectedAccountMap(existing.config?.connected_accounts ?? {}),
        );
        if (toolkitSetEqual && accountMapEqual) {
          return {
            sessionId: existing.session_id,
            mcpUrl: existing.mcp.url,
            reused: true,
          };
        }
      }
      // Toolkit-set drift (or a non-allowlist config shape): fall through
      // to create a session scoped to the current set.
    } catch {
      // Dead/unknown session (404, network, Labs-endpoint churn): fall
      // through to create. The caller persists the new id.
    }
  }

  const session = await composio.toolRouter.create(getComposioUserId(params.userId), {
    toolkits: { enable: desiredToolkitList },
    connectedAccounts: desiredAccounts,
    workbench: { enable: false },
    manageConnections: false,
  });

  return { sessionId: session.sessionId, mcpUrl: session.mcp.url, reused: false };
}

function normalizeToolkitList(input: string[]): string[] {
  return [...new Set(input.map((toolkit) => toolkit.trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeConnectedAccountMap(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && entry[1].trim().length > 0)
      .map(([toolkit, accountId]) => [toolkit.toLowerCase(), accountId]),
  );
}

function connectedAccountMapsEqual(
  expected: Record<string, string>,
  actual: Record<string, string>,
): boolean {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  return (
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
}

export interface McpProbeResult {
  ok: boolean;
  detail: string;
}

const MCP_PROBE_TIMEOUT_MS = 2_500;

/**
 * Direct MCP endpoint probe: initialize + tools/list over streamable-http.
 * Used by the deployer's best-effort cold-boot surfacing - the in-container
 * MCP connect failure is SILENT (one gateway log line, Probe 3 step 7), so
 * the deploy function probes the same endpoint itself and writes an
 * ActivityLog warning on failure. Probes Vercel→Composio directly (the
 * container connects lazily on first agent run, so there is no container
 * log to scrape at deploy time).
 *
 * Never throws. Hard per-request timeout; measured happy path is ~470ms
 * (initialize) + ~350ms (tools/list) from Probe 3, so 2.5s per request is
 * comfortably above p99 without delaying deploys meaningfully.
 */
export async function probeMcpEndpoint(params: {
  url: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<McpProbeResult> {
  const doFetch = params.fetchImpl ?? fetch;
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...params.headers,
  };

  let mcpSessionId: string | null = null;

  const rpc = async (
    method: string,
    rpcParams: Record<string, unknown>,
    id: number,
  ): Promise<{ status: number }> => {
    const headers = { ...baseHeaders };
    if (mcpSessionId) headers['mcp-session-id'] = mcpSessionId;
    const res = await doFetch(params.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: rpcParams }),
      signal: AbortSignal.timeout(MCP_PROBE_TIMEOUT_MS),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) mcpSessionId = sid;
    // Drain the body so the connection is released; content is irrelevant
    // to the probe (status codes are the health signal).
    await res.text().catch(() => {});
    return { status: res.status };
  };

  try {
    const init = await rpc(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'claws-deploy-probe', version: '0.0.0' },
      },
      1,
    );
    if (init.status < 200 || init.status >= 300) {
      return { ok: false, detail: `initialize returned HTTP ${init.status}` };
    }
    const list = await rpc('tools/list', {}, 2);
    if (list.status < 200 || list.status >= 300) {
      return { ok: false, detail: `tools/list returned HTTP ${list.status}` };
    }
    return { ok: true, detail: 'initialize + tools/list ok' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
