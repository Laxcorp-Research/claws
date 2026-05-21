// PR2.8a Phase A — Composio auth-config probe.
//
// Diagnoses why `composio.authConfigs.create(slug, { type:
// "use_composio_managed_auth" })` fails for the 19 PR2.8a Composio adds
// (operator hit a 500 on Typefully Connect-OAuth on staging.app).
//
// Read-only: hits `composio.authConfigs.list` and `composio.toolkits.get`
// for each slug. Does NOT attempt `authConfigs.create`, so no side
// effects on our Composio project.
//
// Run: COMPOSIO_API_KEY=<staging key> node scripts/pr2.8a-composio-authconfig-probe.mjs
// Output: human-readable summary on stderr; full JSON on stdout (redirect
// to probe-composio-authconfigs-staging.json).

import { readFileSync } from 'node:fs'
import { Composio } from '@composio/core'

// Pick up COMPOSIO_API_KEY from .env.local if not already in the env. We
// deliberately do NOT touch .env.staging — Composio API keys live in
// Vercel's env, not in checked-in files. Operator passes the right key
// via shell env.
if (!process.env.COMPOSIO_API_KEY) {
  for (const f of ['.env.local']) {
    try {
      const content = readFileSync(f, 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    } catch { /* missing file ok */ }
  }
}

if (!process.env.COMPOSIO_API_KEY?.trim()) {
  console.error('FATAL: COMPOSIO_API_KEY not set. Pass via shell or .env.local.')
  process.exit(1)
}

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY })

// 17 OAUTH_COMPOSIO toolkits that existed in the catalog before PR2.8a.
// Probing them to validate the diagnostic methodology — these SHOULD all
// report a working auth config; if they don't, our diagnosis is wrong.
const PRE_PR28A_TOOLKITS = [
  'hubspot',
  'salesforce',
  'gmail',
  'googlecalendar', // composioToolkitId; catalog slug is `google_calendar`
  'google_analytics',
  'slack',
  'github',
  'linear',
  'asana',
  'clickup',
  'notion',
  'linkedin',
  'twitter',
  'kit', // composioToolkitId; catalog slug is `convertkit`
  'shopify',
  'jira',
  'calendly',
]

// 19 Composio toolkits added in PR2.8a Task 2. composioToolkitId == catalog
// slug for each (verified against tmp/composio-toolkits.txt).
const PR28A_NEW_TOOLKITS = [
  'typefully',
  'docusign',
  'follow_up_boss',
  'freshbooks',
  'gitlab',
  'googleads',
  'googledocs',
  'googledrive',
  'harvest',
  'jotform',
  'lever',
  'metaads',
  'outlook',
  'pipedrive',
  'quickbooks',
  'toggl',
  'typeform',
  'webflow',
  'youtube',
]

async function probeProjectInfo() {
  // Composio SDK doesn't expose a clean `composio.account.get()` in
  // 0.6.8, but the API key tier surfaces via failure modes elsewhere.
  // We dump the API key prefix (first 8 chars) so the operator can
  // match it against their Composio dashboard. Not a secret leak —
  // prefixes are public-ish identifiers.
  const key = process.env.COMPOSIO_API_KEY ?? ''
  return {
    apiKeyPrefix: key.slice(0, 8) + '...',
    apiKeyLength: key.length,
    note: '@composio/core@0.6.8 has no project-info getter. To identify the project, paste apiKeyPrefix into the Composio dashboard "API Keys" tab and match.',
  }
}

async function probeToolkit(slug) {
  const result = {
    slug,
    existingAuthConfigs: { count: 0, items: [] },
    toolkit: null,
    diagnosis: 'unknown',
    diagnosisDetail: '',
    error: null,
  }

  // 1. List existing auth configs scoped to this toolkit.
  try {
    const listed = await composio.authConfigs.list({ toolkit: slug, limit: 25 })
    result.existingAuthConfigs.count = listed.items?.length ?? 0
    result.existingAuthConfigs.items = (listed.items ?? []).map((c) => ({
      id: c.id,
      isComposioManaged: c.isComposioManaged ?? null,
      authScheme: c.authScheme ?? null,
      name: c.name ?? null,
      createdAt: c.createdAt ?? null,
    }))
  } catch (e) {
    result.error = `authConfigs.list failed: ${e instanceof Error ? e.message : String(e)}`
  }

  // 2. Toolkit metadata: managed-auth schemes + authConfigDetails.
  try {
    const tk = await composio.toolkits.get(slug)
    result.toolkit = {
      slug: tk.slug,
      name: tk.name,
      authSchemes: tk.authSchemes ?? [],
      composioManagedAuthSchemes: tk.composioManagedAuthSchemes ?? [],
      authConfigDetails: (tk.authConfigDetails ?? []).map((d) => ({
        name: d.name,
        mode: d.mode,
        requiredFields: d.fields?.authConfigCreation?.required?.map((f) => f.name) ?? [],
        optionalFields: d.fields?.authConfigCreation?.optional?.map((f) => f.name) ?? [],
      })),
    }
  } catch (e) {
    result.error = (result.error ? result.error + '; ' : '') +
      `toolkits.get failed: ${e instanceof Error ? e.message : String(e)}`
  }

  // 3. Diagnose.
  if (result.error && !result.toolkit) {
    result.diagnosis = 'red'
    result.diagnosisDetail = `SDK error reading toolkit metadata: ${result.error}`
    return result
  }

  if (result.existingAuthConfigs.count > 0) {
    const managed = result.existingAuthConfigs.items.some((c) => c.isComposioManaged === true)
    result.diagnosis = 'green'
    result.diagnosisDetail = managed
      ? `Existing Composio-managed auth config: ${result.existingAuthConfigs.items[0].id}`
      : `Existing custom auth config: ${result.existingAuthConfigs.items[0].id} (isComposioManaged=${result.existingAuthConfigs.items[0].isComposioManaged})`
    return result
  }

  // No existing config — does Composio offer managed auth for this toolkit?
  const managedSchemes = result.toolkit?.composioManagedAuthSchemes ?? []
  if (managedSchemes.length > 0) {
    result.diagnosis = 'yellow'
    result.diagnosisDetail =
      `No existing auth config, but Composio has managed-auth schemes available: [${managedSchemes.join(', ')}]. ` +
      `composio.authConfigs.create(slug, { type: "use_composio_managed_auth" }) SHOULD succeed — ` +
      `if the operator's Connect-OAuth attempt 500'd here, look for runtime errors in the create call ` +
      `(quota / dashboard-toggle / project-tier issue).`
    return result
  }

  // No existing config AND no managed-auth scheme. Operator must register
  // a custom OAuth app in the Composio dashboard for this toolkit.
  result.diagnosis = 'red'
  const authConfigDetails = result.toolkit?.authConfigDetails ?? []
  if (authConfigDetails.length === 0) {
    result.diagnosisDetail =
      `No existing auth config, no Composio-managed auth scheme, no authConfigDetails published. ` +
      `Toolkit may be in a state Composio hasn't enabled for our project tier. Contact Composio support.`
  } else {
    const requiredByMode = authConfigDetails.map(
      (d) => `${d.mode}: required[${d.requiredFields.join(', ') || '(none)'}]`,
    )
    result.diagnosisDetail =
      `No existing auth config and no Composio-managed scheme. Operator must create a custom auth ` +
      `config in the Composio dashboard supplying the toolkit's auth-creation fields:\n      ${requiredByMode.join('\n      ')}`
  }
  return result
}

// PR2.8a-fix1 Task 1 — Negative-path probe.
//
// Runs ONE `composio.authConfigs.create(slug, { type: "use_composio_managed_auth" })`
// against a known-RED toolkit and dumps the verbatim error so we can pattern-
// match it as a defense-in-depth catch in `ensureAuthConfigForToolkit` (the
// primary detection is structural — `composioManagedAuthSchemes.length === 0`).
//
// Why typefully: confirmed RED in the prior probe (no managed auth scheme,
// API_KEY-only). Calling create on it WILL fail; that is the point. No
// auth config gets created on success-or-failure for RED toolkits because
// Composio rejects the request shape.
async function probeNegativePath(slug = 'typefully') {
  const result = {
    slug,
    attempted: 'composio.authConfigs.create(slug, { type: "use_composio_managed_auth", name: ... })',
    captured: null,
  }
  try {
    const tk = await composio.toolkits.get(slug)
    const created = await composio.authConfigs.create(slug, {
      type: 'use_composio_managed_auth',
      name: `${tk.name} (Claws negative-path probe)`,
    })
    // Should not happen on a RED toolkit. If it does, our diagnosis is wrong.
    result.captured = {
      kind: 'unexpected_success',
      createdId: created.id,
      note: 'Probe expected RED toolkit to reject managed-auth create. Diagnosis may be off.',
    }
    return result
  } catch (err) {
    // Walk the error object exhaustively. We don't know in advance whether
    // @composio/core surfaces typed errors, axios-like envelopes, or raw
    // Error instances — so capture everything that's plausibly useful to a
    // string-match catch in ensureAuthConfigForToolkit.
    const dump = {
      kind: 'thrown',
      constructorName: err?.constructor?.name ?? null,
      name: err?.name ?? null,
      message: err?.message ?? null,
      stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 6).join('\n') : null,
      // Common HTTP-error shapes
      status: err?.status ?? err?.statusCode ?? err?.response?.status ?? null,
      statusText: err?.statusText ?? err?.response?.statusText ?? null,
      code: err?.code ?? err?.response?.data?.code ?? null,
      body: err?.body ?? err?.response?.data ?? err?.response?.body ?? null,
      cause: err?.cause ? { name: err.cause?.name, message: err.cause?.message } : null,
      // Composio-specific (best-effort)
      details: err?.details ?? null,
      errors: err?.errors ?? null,
      // All own-enumerable properties not already captured above
      ownProps: (() => {
        try {
          const seen = new Set([
            'constructor', 'name', 'message', 'stack', 'status', 'statusCode',
            'statusText', 'code', 'body', 'cause', 'details', 'errors', 'response',
          ])
          const out = {}
          for (const k of Object.getOwnPropertyNames(err)) {
            if (seen.has(k)) continue
            const v = err[k]
            if (typeof v === 'function') continue
            try {
              out[k] = JSON.parse(JSON.stringify(v))
            } catch {
              out[k] = String(v)
            }
          }
          return out
        } catch {
          return null
        }
      })(),
    }
    result.captured = dump
    return result
  }
}

// PR2.9-prep — BYOK lifecycle probe.
//
// Validates whether @composio/core@0.6.8 supports the "user-supplies-API-key,
// Composio brokers" pattern end-to-end against a real Composio project.
//
// Lifecycle attempted (against `typefully` by default, which is API_KEY-only):
//   1. authConfigs.create(toolkit, { type:CUSTOM, authScheme:API_KEY,
//      credentials:{apiKey: '<dummy>'} })
//   2. connectedAccounts.initiate(testUserId, configId,
//      { config: AuthScheme.APIKey({api_key:'<dummy>'}) })
//   3. composio.tools.list({ userId, toolkits:[toolkit] }) AND
//      composio.tools.execute(<tool>, { userId, arguments:{} })
//   4. Cleanup: delete connected account, delete auth config (in any order
//      that succeeds; the auth config delete may require connected account
//      gone first).
//
// "Dummy API key" is by design — we want to test SDK plumbing, not a real
// API call. The actual typefully API will return 401 with this key; that
// 401 (or whatever maps to it through Composio) is success for our probe
// since it confirms the call reached the toolkit's HTTP endpoint.
//
// Test user id is namespaced + timestamped so it can't collide with real
// users: claws_pr29_byok_probe_<unix-ms>.
async function probeByok(slug = 'typefully') {
  const { AuthScheme } = await import('@composio/core')

  const testUserId = `claws_pr29_byok_probe_${Date.now()}`
  const dummyApiKey = `test-key-dummy-${Date.now()}`
  const result = {
    slug,
    testUserId,
    dummyApiKey: '<redacted>',
    steps: {},
    cleanup: { connectedAccountDeleted: null, authConfigDeleted: null },
  }

  let createdAuthConfigId = null
  let createdConnectedAccountId = null

  // --- Step 1: create custom API_KEY auth config ---
  try {
    const tk = await composio.toolkits.get(slug)
    const created = await composio.authConfigs.create(slug, {
      type: 'use_custom_auth',
      authScheme: 'API_KEY',
      name: `${tk.name} (Claws PR2.9 BYOK probe)`,
      credentials: { apiKey: dummyApiKey },
    })
    createdAuthConfigId = created.id ?? created.auth_config?.id ?? null
    result.steps.createAuthConfig = {
      ok: true,
      id: createdAuthConfigId,
      // Full SDK response shape captured for the verdict.
      raw: JSON.parse(JSON.stringify(created, (_, v) => typeof v === 'function' ? undefined : v)),
    }
  } catch (err) {
    result.steps.createAuthConfig = captureError(err)
    return finish(result, createdAuthConfigId, createdConnectedAccountId)
  }

  // --- Step 2: initiate connected account with API key ---
  try {
    const connectionRequest = await composio.connectedAccounts.initiate(
      testUserId,
      createdAuthConfigId,
      {
        config: AuthScheme.APIKey({ api_key: dummyApiKey }),
      },
    )
    createdConnectedAccountId = connectionRequest.id ?? connectionRequest.connectedAccountId ?? null
    result.steps.initiateConnection = {
      ok: true,
      id: createdConnectedAccountId,
      redirectUrl: connectionRequest.redirectUrl ?? null,
      // Whether the connection auto-activated or requires further steps.
      raw: pickConnectionShape(connectionRequest),
    }
  } catch (err) {
    result.steps.initiateConnection = captureError(err)
    return finish(result, createdAuthConfigId, createdConnectedAccountId)
  }

  // --- Step 3a: list tools the connection can execute ---
  // SDK method is `tools.getRawComposioTools({ toolkits, limit })` —
  // returns `ToolList` (array of Tool). The provider-wrapped variant
  // `tools.get(userId, filters)` exists too but adds wrapping we don't
  // need for the probe.
  try {
    const listed = await composio.tools.getRawComposioTools({
      toolkits: [slug],
      limit: 5,
    })
    const items = Array.isArray(listed) ? listed : (Array.isArray(listed?.items) ? listed.items : [])
    result.steps.listTools = {
      ok: true,
      count: items.length,
      firstSlugs: items.slice(0, 5).map((t) => t.slug ?? t.name ?? '?'),
    }
  } catch (err) {
    result.steps.listTools = captureError(err)
  }

  // --- Step 3b: attempt a tools.execute. Use the first slug discovered
  //     in step 3a so we're not guessing a name. Expect this to 401 at
  //     the toolkit's HTTP endpoint with a dummy key — success criterion
  //     is "the SDK call returned a response shape" not "the tool executed
  //     successfully". The HTTP 401 (or equivalent Composio-wrapped error)
  //     confirms the SDK plumbing routed our credential to the toolkit.
  const executeSlug = result.steps.listTools?.firstSlugs?.[0]
    || `${slug.toUpperCase()}_GET_PROFILE`
  try {
    const exec = await composio.tools.execute(executeSlug, {
      userId: testUserId,
      arguments: {},
    })
    result.steps.executeTool = {
      ok: true,
      slug: executeSlug,
      successful: exec?.successful ?? null,
      error: exec?.error ?? null,
      // truncated: don't dump entire payload to chat
      dataKeys: exec?.data ? Object.keys(exec.data).slice(0, 10) : null,
    }
  } catch (err) {
    result.steps.executeTool = { slug: executeSlug, ...captureError(err) }
  }

  return finish(result, createdAuthConfigId, createdConnectedAccountId)
}

function captureError(err) {
  return {
    ok: false,
    constructorName: err?.constructor?.name ?? null,
    name: err?.name ?? null,
    message: err?.message ?? null,
    status: err?.status ?? err?.statusCode ?? err?.response?.status ?? null,
    body: err?.body ?? err?.response?.data ?? err?.error ?? null,
    code: err?.code ?? err?.response?.data?.code ?? null,
  }
}

function pickConnectionShape(req) {
  const out = {}
  for (const k of ['id', 'connectedAccountId', 'status', 'redirectUrl', 'callbackUrl']) {
    if (req?.[k] !== undefined) out[k] = req[k]
  }
  return out
}

async function finish(result, authConfigId, connectedAccountId) {
  // Best-effort cleanup. Delete connected account first (Composio may
  // require this before allowing auth config deletion), then auth config.
  if (connectedAccountId) {
    try {
      await composio.connectedAccounts.delete(connectedAccountId)
      result.cleanup.connectedAccountDeleted = true
    } catch (err) {
      result.cleanup.connectedAccountDeleted = false
      result.cleanup.connectedAccountDeleteError = err?.message ?? String(err)
    }
  }
  if (authConfigId) {
    try {
      await composio.authConfigs.delete(authConfigId)
      result.cleanup.authConfigDeleted = true
    } catch (err) {
      result.cleanup.authConfigDeleted = false
      result.cleanup.authConfigDeleteError = err?.message ?? String(err)
    }
  }
  return result
}

// PR2.9 Task 6 — BYOK-eligibility audit.
//
// For a set of toolkit slugs, dumps each one's auth modes (from
// `composio.toolkits.get(slug)`) so we can decide which RED toolkits are
// BYOK-eligible (i.e., expose API_KEY mode and can therefore use the
// use_custom_auth + AuthScheme.APIKey path PR2.9 implements) vs which are
// genuinely OAuth-only (operator must register a custom OAuth app first).
//
// Outputs one line per toolkit:
//   <slug> | managedSchemes=[OAUTH2|OAUTH1|...] | authModes=[OAUTH2,API_KEY,...] | byokEligible=yes/no
async function probeByokEligibility(slugs) {
  const out = []
  for (const slug of slugs) {
    try {
      const tk = await composio.toolkits.get(slug)
      const managed = tk.composioManagedAuthSchemes ?? []
      const details = tk.authConfigDetails ?? []
      const modes = details.map((d) => d.mode)
      const hasApiKey = modes.includes('API_KEY')
      const byokEligible = hasApiKey
      out.push({ slug, managedSchemes: managed, authModes: modes, byokEligible })
      process.stderr.write(
        `${slug.padEnd(20)} | managedSchemes=[${managed.join(',') || 'none'}] | authModes=[${modes.join(',') || 'none'}] | byokEligible=${byokEligible ? 'YES' : 'no'}\n`,
      )
    } catch (err) {
      out.push({ slug, error: err?.message ?? String(err) })
      process.stderr.write(`${slug.padEnd(20)} | ERROR: ${err?.message ?? err}\n`)
    }
  }
  return out
}

async function main() {
  const startedAt = new Date().toISOString()

  if (process.argv.includes('--byok-eligibility')) {
    process.stderr.write(`Composio BYOK-eligibility audit — ${startedAt}\n\n`)
    const project = await probeProjectInfo()
    process.stderr.write(
      `Project: apiKeyPrefix=${project.apiKeyPrefix} keyLen=${project.apiKeyLength}\n\n`,
    )
    // Default: the 11 RED toolkits surfaced in the PR2.8a Phase A probe.
    // RED-1 (API_KEY only): typefully, jotform, toggl
    // RED-2 (mixed): twitter, shopify, docusign, lever, metaads, pipedrive, webflow, follow_up_boss
    const idx = process.argv.indexOf('--byok-eligibility')
    const argList = process.argv.slice(idx + 1).filter((a) => !a.startsWith('-'))
    const slugs = argList.length > 0 ? argList : [
      // RED-1
      'typefully', 'jotform', 'toggl',
      // RED-2
      'twitter', 'shopify', 'docusign', 'lever', 'metaads',
      'pipedrive', 'webflow', 'follow_up_boss',
    ]
    process.stderr.write(`Probing ${slugs.length} toolkits...\n\n`)
    const results = await probeByokEligibility(slugs)
    process.stdout.write(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), results }, null, 2))
    const eligible = results.filter((r) => r.byokEligible).map((r) => r.slug)
    const notEligible = results.filter((r) => r.byokEligible === false).map((r) => r.slug)
    process.stderr.write(`\n=== SUMMARY ===\n`)
    process.stderr.write(`BYOK-eligible  (${eligible.length}): ${eligible.join(', ') || '(none)'}\n`)
    process.stderr.write(`OAuth-only     (${notEligible.length}): ${notEligible.join(', ') || '(none)'}\n`)
    return
  }

  if (process.argv.includes('--byok-probe')) {
    process.stderr.write(`Composio BYOK lifecycle probe — ${startedAt}\n\n`)
    const project = await probeProjectInfo()
    process.stderr.write(
      `Project: apiKeyPrefix=${project.apiKeyPrefix} keyLen=${project.apiKeyLength}\n${project.note}\n\n`,
    )
    const idx = process.argv.indexOf('--byok-probe')
    const slug = process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')
      ? process.argv[idx + 1]
      : 'typefully'
    process.stderr.write(`Probing BYOK lifecycle for "${slug}" with dummy API key...\n\n`)
    const r = await probeByok(slug)
    process.stdout.write(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), ...r }, null, 2))
    process.stderr.write('\n=== Step results ===\n')
    for (const [step, info] of Object.entries(r.steps)) {
      process.stderr.write(`\n[${step}] ${info?.ok ? 'OK' : 'FAIL'}\n`)
      process.stderr.write(JSON.stringify(info, null, 2))
      process.stderr.write('\n')
    }
    process.stderr.write(`\n=== Cleanup ===\n${JSON.stringify(r.cleanup, null, 2)}\n`)
    return
  }

  if (process.argv.includes('--negative-path')) {
    process.stderr.write(`Composio negative-path probe — ${startedAt}\n\n`)
    const project = await probeProjectInfo()
    process.stderr.write(
      `Project: apiKeyPrefix=${project.apiKeyPrefix} keyLen=${project.apiKeyLength}\n${project.note}\n\n`,
    )
    const idx = process.argv.indexOf('--negative-path')
    const slug = process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')
      ? process.argv[idx + 1]
      : 'typefully'
    process.stderr.write(`Attempting authConfigs.create on RED toolkit "${slug}" — expecting failure...\n\n`)
    const r = await probeNegativePath(slug)
    process.stdout.write(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), ...r }, null, 2))
    process.stderr.write('\n=== Captured error shape ===\n')
    process.stderr.write(JSON.stringify(r.captured, null, 2))
    process.stderr.write('\n')
    return
  }

  process.stderr.write(`Composio auth-config probe — ${startedAt}\n\n`)

  const project = await probeProjectInfo()
  process.stderr.write(
    `Project: apiKeyPrefix=${project.apiKeyPrefix} keyLen=${project.apiKeyLength}\n${project.note}\n\n`,
  )

  const allSlugs = [
    ...PR28A_NEW_TOOLKITS.map((s) => ({ slug: s, group: 'PR2.8a-new' })),
    ...PRE_PR28A_TOOLKITS.map((s) => ({ slug: s, group: 'pre-PR2.8a' })),
  ]

  const results = []
  for (const { slug, group } of allSlugs) {
    process.stderr.write(`[${group}] ${slug}... `)
    const r = await probeToolkit(slug)
    r.group = group
    results.push(r)
    process.stderr.write(
      `${r.diagnosis.toUpperCase()} (${r.existingAuthConfigs.count} existing config${r.existingAuthConfigs.count === 1 ? '' : 's'}; managedSchemes=[${(r.toolkit?.composioManagedAuthSchemes ?? []).join(',') || 'none'}])\n`,
    )
  }

  // Aggregate
  const byDiagnosis = { green: [], yellow: [], red: [], unknown: [] }
  for (const r of results) byDiagnosis[r.diagnosis].push(r.slug)

  process.stderr.write('\n=== SUMMARY ===\n')
  process.stderr.write(`GREEN  (${byDiagnosis.green.length}): ${byDiagnosis.green.join(', ') || '(none)'}\n`)
  process.stderr.write(`YELLOW (${byDiagnosis.yellow.length}): ${byDiagnosis.yellow.join(', ') || '(none)'}\n`)
  process.stderr.write(`RED    (${byDiagnosis.red.length}): ${byDiagnosis.red.join(', ') || '(none)'}\n`)
  if (byDiagnosis.unknown.length) {
    process.stderr.write(`UNKNOWN(${byDiagnosis.unknown.length}): ${byDiagnosis.unknown.join(', ')}\n`)
  }

  process.stderr.write('\n=== Per-toolkit detail ===\n')
  for (const r of results) {
    process.stderr.write(`\n${r.slug} [${r.group}] — ${r.diagnosis.toUpperCase()}\n  ${r.diagnosisDetail}\n`)
  }

  // JSON to stdout for file capture.
  const output = {
    startedAt,
    finishedAt: new Date().toISOString(),
    project,
    summary: {
      total: results.length,
      green: byDiagnosis.green.length,
      yellow: byDiagnosis.yellow.length,
      red: byDiagnosis.red.length,
      unknown: byDiagnosis.unknown.length,
      greenSlugs: byDiagnosis.green,
      yellowSlugs: byDiagnosis.yellow,
      redSlugs: byDiagnosis.red,
      unknownSlugs: byDiagnosis.unknown,
    },
    results,
  }
  process.stdout.write(JSON.stringify(output, null, 2))
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(2)
})
