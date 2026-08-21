// Edge-safe admin allowlist helpers.
//
// Admin = the ADMIN_EMAILS env var (comma-separated), NOT a DB field - so the
// check is a pure string comparison with no DB/Node APIs, usable from the edge
// middleware runtime as well as Node server code.
//
// IMPORTANT: this module is INTENTIONALLY dependency-free. Do NOT add imports
// here - especially `next-auth`, `next-auth/jwt` server bits, `@/lib/db`,
// `@/lib/api/auth`, or anything that pulls Prisma/getServerSession. The
// edge-safety contract test (src/__tests__/middleware.test.ts) asserts this file
// stays import-free so it can be bundled into the edge middleware without
// dragging Node-only code along.

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase());
}
