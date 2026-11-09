/** Paths that must answer before an owner exists. Everything else redirects. */
export function ownerGateAllows(pathname: string): boolean {
  if (pathname === "/setup/owner" || pathname.startsWith("/setup/owner/")) return true
  if (pathname === "/api/setup/owner" || pathname.startsWith("/api/setup/owner/")) return true
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) return true
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true
  return false
}
