import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

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
];

function isProtectedPath(pathname: string): boolean {
  return protectedPaths.some((p) => pathname.startsWith(p));
}

function isExcludedFromCors(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/dodo-payments/webhook")
  );
}

function getMatchingOrigin(requestOrigin: string | null): string {
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return "";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    return response;
  }

  if (isProtectedPath(pathname)) {
    const token = await getToken({ req: request });
    if (!token) {
      const signInUrl = new URL("/auth/signin", request.url);
      signInUrl.searchParams.set("callbackUrl", request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/my-claws/:path*",
    "/setup/:path*",
    "/builder/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
};
