// Migration scripts run via `tsx` (not Next.js), so globalThis.AsyncLocalStorage
// isn't auto-set. @axiomhq/nextjs expects it at module-load time, which causes
// any migration script that transitively imports the logger to crash.
//
// Import this file at the very top of any migration script that imports
// modules dragging in the logger chain (anything in src/lib/openclaw/,
// src/lib/credits/, etc.). Existing scripts that only import @/lib/db
// (prisma) don't need it.
//
// Importing this file has no effect under Next.js runtime (the global is
// already set there).

import { AsyncLocalStorage } from "node:async_hooks"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any
if (!g.AsyncLocalStorage) {
  g.AsyncLocalStorage = AsyncLocalStorage
}
