// PR-2b items #1 + #2 - fail-closed activity/metering endpoint guards.
//
// History: PR-2 shipped the activity wire with a hardcoded fallback to the
// PROD endpoint URL (`'https://app.buildclaws.ai/api/internal/activity'`)
// when `ACTIVITY_ENDPOINT` env was unset. We discovered during PR-2 staging
// validation (2026-05-27) that staging Vercel hadn't been configured with
// `ACTIVITY_ENDPOINT` either, so staging containers booted with
// `CLAWS_ACTIVITY_ENDPOINT=<prod URL>`. The plugin then POSTed STAGING
// workspace events at the PROD endpoint, which 401'd silently (different DB,
// same secret value caused the auth check to pass but workspace lookup
// returned 404 → batch dropped with no surface signal). That's the exact
// silent-misroute footgun this guard is designed to make impossible.
//
// The same pattern applied to `METERING_ENDPOINT`. Metering rows are how
// `CreditAccount.balanceCents` gets reconciled per turn, so a silent prod-
// fallback there would mean staging containers debiting prod credit
// accounts. Worse than activity. So we fail-closed both.
//
// Host-mismatch guard (#2) is the defense-in-depth layer: even if the env
// var IS set, refuse to deploy if its host doesn't match
// `NEXT_PUBLIC_APP_URL`. Catches "staging deploys with prod URL pasted in
// by mistake" without needing a 401 in production to learn about it.

const ACTIVITY_ENDPOINT_HINT =
  'Set ACTIVITY_ENDPOINT to the workspace-environment-appropriate URL ' +
  '(e.g., https://staging.app.buildclaws.ai/api/internal/activity for ' +
  'staging, https://app.buildclaws.ai/api/internal/activity for production).';

const METERING_ENDPOINT_HINT =
  'Set METERING_ENDPOINT to the workspace-environment-appropriate URL ' +
  '(e.g., https://staging.app.buildclaws.ai/api/internal/metering for ' +
  'staging, https://app.buildclaws.ai/api/internal/metering for production).';

export function requireActivityEndpoint(): string {
  const raw = process.env.ACTIVITY_ENDPOINT;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'ACTIVITY_ENDPOINT env var is required but not set. Refusing to ' +
        'bake a silent prod fallback into a container env. ' +
        ACTIVITY_ENDPOINT_HINT,
    );
  }
  return raw.trim();
}

export function requireMeteringEndpoint(): string {
  const raw = process.env.METERING_ENDPOINT;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'METERING_ENDPOINT env var is required but not set. Refusing to ' +
        'bake a silent prod fallback into a container env. ' +
        METERING_ENDPOINT_HINT,
    );
  }
  return raw.trim();
}

/**
 * #2: refuse to deploy if NEXT_PUBLIC_APP_URL host doesn't match the
 * provided endpoint host. Catches the "staging deploy points at prod
 * endpoint" misconfig at deploy time (loud throw), not silently at request
 * time (silent 401/404 + dropped batch).
 *
 * Each control-plane environment has exactly one matched (NEXT_PUBLIC_APP_URL,
 * ACTIVITY_ENDPOINT, METERING_ENDPOINT) host triple. If they diverge, the
 * deploy is misconfigured.
 *
 * Throws with the offending pair in the error message so the operator can
 * fix the Vercel env without spelunking through logs.
 */
export function assertEndpointHostMatchesApp(params: {
  endpointUrl: string;
  endpointName: 'ACTIVITY_ENDPOINT' | 'METERING_ENDPOINT';
}): void {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || appUrl.trim().length === 0) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL env var is required but not set. Cannot run ' +
        'the deploy-time host-match guard for ' +
        params.endpointName +
        '.',
    );
  }
  let appHost: string;
  try {
    appHost = new URL(appUrl).host;
  } catch (err) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL is not a valid URL: ' +
        JSON.stringify(appUrl) +
        ' (' +
        (err instanceof Error ? err.message : String(err)) +
        ')',
    );
  }
  let endpointHost: string;
  try {
    endpointHost = new URL(params.endpointUrl).host;
  } catch (err) {
    throw new Error(
      params.endpointName +
        ' is not a valid URL: ' +
        JSON.stringify(params.endpointUrl) +
        ' (' +
        (err instanceof Error ? err.message : String(err)) +
        ')',
    );
  }
  if (appHost !== endpointHost) {
    throw new Error(
      'Host mismatch refusing deploy: NEXT_PUBLIC_APP_URL host=' +
        JSON.stringify(appHost) +
        ' but ' +
        params.endpointName +
        ' host=' +
        JSON.stringify(endpointHost) +
        '. This would route container traffic to the wrong control plane. ' +
        'Fix the Vercel env (set ' +
        params.endpointName +
        ' to a URL on host=' +
        appHost +
        ') and redeploy.',
    );
  }
}
