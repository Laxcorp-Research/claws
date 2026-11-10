import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { apiRateLimit, authRateLimit } from "./lib/rate-limit";
import { getAdminEmails, isAdminEmail } from "./lib/admin-emails";
import { isAllowedDuringOnboarding } from "./lib/auth/post-auth-path";
import { denyHostedOnly, isSelfHost } from "./lib/profile";
import { ownerGateAllows } from "./lib/auth/owner-gate-path";
import { consumeCredentialAttempt } from "./lib/auth/credential-lockout";

const allowedOrigins = [
  "https://app.buildclaws.ai",
  "https://staging.app.buildclaws.ai",
  "https://buildclaws.ai",
];

if (process.env.NODE_ENV === "development") {
  allowedOrigins.push("http://localhost:3000");
}

const protectedPaths = [
  "/my-claws",
  "/setup",
  "/builder",
  "/dashboard",
  "/settings",
  "/onboarding",
  "/publish",
  "/admin",
];

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/setup/owner" || pathname.startsWith("/setup/owner/")) return false
  return protectedPaths.some((p) => pathname.startsWith(p));
}

function isExcludedFromCors(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/dodo-payments/webhook") ||
    pathname.startsWith("/api/webhooks/telegram/") ||
    pathname.startsWith("/api/axiom")
  );
}

function isWebhook(pathname: string): boolean {
  return (
    pathname.startsWith("/api/dodo-payments/webhook") ||
    pathname.startsWith("/api/webhooks/telegram/")
  );
}

function getMatchingOrigin(requestOrigin: string | null): string {
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return "";
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

const isDev = process.env.NODE_ENV === "development";

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.githubusercontent.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' https://*.sentry.io https://*.axiom.co https://vercel.live https://*.vercel-insights.com https://api.anthropic.com https://checkout.dodopayments.com https://backend.composio.dev https://*.composio.dev${isDev ? " http://localhost:* ws://localhost:*" : ""}`,
  "frame-src https://checkout.dodopayments.com https://*.composio.dev https://vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
];

const cspHeader = cspDirectives.join("; ");

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
}

function rateLimitResponse(
  message: string,
  remaining: number,
  reset: number
): NextResponse {
  return new NextResponse(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Remaining": remaining.toString(),
      "X-RateLimit-Reset": reset.toString(),
      "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
    },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostedOnly = denyHostedOnly(pathname);
  if (hostedOnly) {
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: {
          code: "HOSTED_ONLY",
          message: `${hostedOnly.moduleName} is not available when CLAWS_PROFILE=self-host`,
        },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  if (isSelfHost() && (pathname === "/pricing" || pathname.startsWith("/pricing/"))) {
    return NextResponse.redirect(new URL("/store", request.url))
  }

  if (isSelfHost() && !ownerGateAllows(pathname)) {
    const { selfHostNeedsOwner } = await import("@/lib/auth/owner-gate");
    if (await selfHostNeedsOwner()) {
      return NextResponse.redirect(new URL("/setup/owner", request.url));
    }
  }

  if (
    process.env.E2E_TEST_MODE !== "true" &&
    request.method === "POST" &&
    pathname.startsWith("/api/auth/callback/credentials")
  ) {
    const gate = await consumeCredentialAttempt(getClientIp(request));
    if (gate === "locked") {
      return rateLimitResponse(
        "Too many sign-in attempts. Please try again later.",
        0,
        Date.now() + 15 * 60 * 1000,
      );
    }
  }

  /** CI E2E uses fake Upstash URLs; self-host does not use Upstash. */
  const skipRateLimitForE2e = process.env.E2E_TEST_MODE === "true" || isSelfHost();

  // --- CORS for API routes (except auth and webhooks) ---
  if (pathname.startsWith("/api/") && !isExcludedFromCors(pathname)) {
    const origin = request.headers.get("origin");
    const matchedOrigin = getMatchingOrigin(origin);

    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": matchedOrigin,
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Rate limit authenticated API routes (skip webhooks and axiom proxy)
    if (
      !skipRateLimitForE2e &&
      !isWebhook(pathname) &&
      !pathname.startsWith("/api/axiom")
    ) {
      try {
        const token = await getToken({ req: request });
        const identifier = token?.sub || getClientIp(request);
        const { success, remaining, reset } =
          await apiRateLimit.limit(identifier);
        if (!success) {
          return rateLimitResponse(
            "Rate limit exceeded. Please slow down.",
            remaining,
            reset
          );
        }
      } catch {
        // Redis unavailable - fail open
      }
    }

    const response = NextResponse.next();
    if (matchedOrigin) {
      response.headers.set("Access-Control-Allow-Origin", matchedOrigin);
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
    }
    return addSecurityHeaders(response);
  }

  // --- Auth route rate limiting (POST only - sign-in attempts) ---
  if (
    !skipRateLimitForE2e &&
    pathname.startsWith("/api/auth") &&
    request.method === "POST" &&
    !isWebhook(pathname)
  ) {
    try {
      const ip = getClientIp(request);
      const { success, remaining, reset } = await authRateLimit.limit(ip);
      if (!success) {
        return rateLimitResponse(
          "Too many sign-in attempts. Please try again later.",
          remaining,
          reset
        );
      }
    } catch {
      // Redis unavailable - fail open
    }
  }

  // --- Webhook passthrough (no rate limiting, no CORS) ---
  if (isWebhook(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // --- Auth protection for page routes ---
  if (isProtectedPath(pathname)) {
    const token = await getToken({ req: request });
    if (!token) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", request.url);
      return NextResponse.redirect(signInUrl);
    }

    // Self-host skips the hosted first-run. Install lands on /setup/.../step/1.
    if (isSelfHost()) {
      if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
        return NextResponse.redirect(new URL("/store", request.url));
      }
    } else if (
      token.onboardingCompleted !== true &&
      !isAllowedDuringOnboarding(pathname)
    ) {
      // Batch B: first sign-in → /onboarding until User.onboardingCompleted
      // (JWT also sets true when user already has workspaces). Settings allowed
      // so "Add API key" CTA works during onboarding.
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }

    // #133: server-side admin authorization at the edge. Admin is the
    // ADMIN_EMAILS env var (not a DB field), so we can enforce here without a
    // DB call - a non-admin never receives the admin route HTML.
    if (pathname.startsWith("/admin")) {
      const configuredAdmins = getAdminEmails();
      if (configuredAdmins.length === 0) {
        // Fail-SAFE on CONFIG: an env wipe must not brick the whole admin
        // surface for every admin. Degrade to pre-#133 behavior (route loads;
        // the API's requireAdmin 403s still protect every operation) and log
        // loudly so the misconfig is visible.
        console.warn(
          "ADMIN_EMAILS unset - edge admin enforcement DISABLED, falling back to API requireAdmin",
        );
      } else {
        const email = typeof token.email === "string" ? token.email : "";
        if (!email || !isAdminEmail(email)) {
          // Fail-CLOSED on the USER: rewrite (not redirect) to the styled
          // not-found for information-hiding - the URL stays /admin/* and the
          // response reveals nothing about /admin existing.
          return addSecurityHeaders(
            NextResponse.rewrite(new URL("/_not-found", request.url)),
          );
        }
      }
    }
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
