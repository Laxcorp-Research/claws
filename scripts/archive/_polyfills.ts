// tsx helper for archive scripts that import the logger chain.
// @axiomhq/nextjs expects globalThis.AsyncLocalStorage at module-load.
//
// Import this file at the very top of any archive script that imports
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
