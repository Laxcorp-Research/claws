import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" });
}

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    // PR-2d: Prisma 7 removed the dedicated `directUrl` field — the
    // entire concept is gone in favour of driver adapters at runtime.
    // The new way to make `prisma migrate deploy` bypass pgbouncer is
    // to set `url` here to DIRECT_URL when it's available, falling back
    // to DATABASE_URL otherwise.
    //
    // Why: pgbouncer's transaction pooling holds Postgres sessions
    // across short client lifetimes. When Vercel kills a build mid-
    // migration, the session holding Prisma's advisory lock
    // (SELECT pg_advisory_lock(72707369)) sticks around in the pool
    // until something terminates it — and the next migration attempt
    // hangs for 10s with P1002 "Timed out trying to acquire advisory
    // lock". This bit PR-2b + PR-3 before this guard landed. Bypassing
    // pgbouncer means the lock disappears when the migrate process dies.
    //
    // Runtime app traffic is unaffected: every PrismaClient instance is
    // built via PrismaPg({ connectionString: process.env.DATABASE_URL })
    // in src/lib/db.ts (and elsewhere) — that path is independent of
    // anything here. Only the Prisma CLI consults this config.
    //
    // Fallback semantics: when DIRECT_URL is unset (local dev that
    // points at a local Postgres, or any environment that hasn't
    // configured both), we fall back to DATABASE_URL with no error.
    // See docs/MIGRATIONS.md for the full why + how to derive the
    // direct URL from a pooled Neon URL.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
