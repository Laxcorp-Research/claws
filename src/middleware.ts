import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * The published runtime PUTs to `${apiUrl}/?pathname=...`, so the path always
 * has a trailing slash. Next would 308 that to the slash-less route and a
 * redirected PUT can drop the gzip body. Rewrite it in place.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/internal/state/blob-put/") {
    const url = new URL(request.url)
    url.pathname = "/api/internal/state/blob-put"
    return NextResponse.rewrite(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: "/api/internal/state/:path*",
}
