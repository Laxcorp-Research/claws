# Database Migration Workflow

## Creating a new migration (development)

1. Make changes to `prisma/schema.prisma`
2. Run: `npm run db:migrate:dev` -- creates migration file + applies to dev DB
3. Commit the generated migration file in `prisma/migrations/`
4. Merge PR to `staging`. Vercel auto-applies the migration as part of the
   deploy: `buildCommand` in `vercel.json` is `npm run build:deploy`, which is
   `prisma generate && prisma migrate deploy && next build`. If
   `prisma migrate deploy` fails, the entire build fails and the deploy is
   aborted (fail-fast - a broken migration blocks the code deploy rather than
   landing code that references columns the DB does not have).
5. Verify on staging via deploy logs (the "Applying migration" line in
   `build:deploy` output) or
   `dotenv -e .env.staging -- npx prisma migrate status`.
6. PR `staging` to `main`. Merge. Vercel auto-applies the migration on the
   prod deploy the same way. **Each PR to main that includes a migration
   will mutate the prod schema as soon as Vercel finishes building.** Plan
   the merge timing accordingly.

### Auto-apply tradeoff

This couples migration timing to deploy timing. Implications:

- You cannot deploy code without applying any pending migrations.
- You cannot apply a migration without deploying code.
- A bad migration aborts the Vercel build - the previous deploy keeps
  serving traffic, but the DB is unchanged. That's the safer failure mode.
- A migration that succeeds but a code build that fails (rare - `next build`
  after `migrate deploy`) leaves DB ahead of code. The previous code deploy
  still serves traffic and is still compatible with the new schema only if
  the migration was additive + nullable (the standard rule per "Rules"
  below). If a destructive migration succeeded and the build failed, you
  have a real problem - recover via Neon PITR or a forward-only fix.

For risky multi-stage migrations (column rename, type change), split into
N additive PRs so each migration step lands in lockstep with a code
deploy that tolerates both old and new schema.

## PR preview deploys mutate the staging Neon DB pre-merge

Vercel's **preview** deployment for a PR runs `prisma migrate deploy` (via
`build:deploy`) against the **shared staging Neon branch** - *before* the PR is
merged. The migration therefore hits staging Neon as soon as the preview build
runs, not when the PR lands.

- **Additive nullable column** (the standard case): benign. The preview's
  `prisma migrate deploy` applies the migration to staging Neon; staging then has
  the column ahead of `main`, but the column is null-tolerant so existing code is
  unaffected.
- **Destructive migration** (drop column, rename table, change column type, drop
  index): the migration hits staging Neon when the PR's **preview** deploy runs.
  **Reverting the PR does NOT revert the migration** - staging Neon is now in a
  state ahead of `main`, possibly incompatible with the code `main` is serving.

### Mitigation for destructive migrations

- Manually verify on a local Neon branch (or a throwaway branch) **before**
  opening the PR.
- If a PR carrying a destructive migration must be reverted, plan to also write a
  **forward-migration** to restore the staging state - a git revert of the PR
  will not undo the schema change already applied to staging Neon.
- For high-risk migrations, consider giving the feature branch **its own Neon
  branch** instead of letting the preview deploy mutate shared staging.

**Discovered during the PR-8a/C staging deploy (2026-06):** staging Neon's
`_prisma_migrations.finished_at` for the new column *predated* the staging-branch
push, because the PR's preview deploy had already run the migration against shared
staging Neon. The column was additive + nullable, so it was benign in that case -
but the pattern is a known gotcha for any future destructive migration.

### Manual migrate (escape hatch)

The `npm run migrate:staging` / `npm run migrate:production` scripts still
exist (`package.json:26-27`) for cases where you need to apply a migration
without redeploying code - e.g. retrying after a transient Neon failure
during the Vercel build, or applying a hotfix migration ahead of the
matching code deploy.

## DIRECT_URL - why migrations bypass pgbouncer

`prisma migrate deploy` uses `DIRECT_URL` (direct Neon endpoint), not
`DATABASE_URL` (pooled endpoint through pgbouncer). The selection is
declared in **`prisma.config.ts` only** - Prisma 7 removed both
schema-level `url`/`directUrl` declarations (validate fails with P1012
if you add them back) AND the dedicated `directUrl` field in
`prisma.config.ts`. The entire `directUrl` concept is gone in favour of
driver adapters at runtime. See <https://pris.ly/d/config-datasource>.

The new pattern is to make `datasource.url` an explicit fallback chain:

```ts
// prisma.config.ts
datasource: {
  url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
},
```

When `DIRECT_URL` is set (Vercel preview + production both have it), the
CLI uses it for migrations. When `DIRECT_URL` is unset (local dev
pointed at a local Postgres, or any environment that hasn't configured
both), it falls back to `DATABASE_URL` with no error.

> If you tried to keep using Prisma 6's `directUrl =` syntax in the
> schema, `prisma validate` returns P1012:
> `The datasource property 'directUrl' is no longer supported in schema
> files.` Same story for the `datasource.directUrl` field in
> `prisma.config.ts` - its TypeScript type doesn't include it.

### Why bypass pgbouncer for migrations?

pgbouncer's transaction pooling holds Postgres sessions across short
client lifetimes. When Vercel kills a build mid-migration (timeout,
deploy cancel, OOM), the session that held Prisma's advisory lock
(`SELECT pg_advisory_lock(72707369)`) sticks around in the pool until
something terminates it. The next migration attempt sees a held lock,
waits 10s, fails with `P1002 Timed out trying to acquire postgres
advisory lock`. We hit this twice - once on PR-2b validation, again on
PR-3's BOM-fix deploy. Bypassing pgbouncer means the lock is released
when the migration client disconnects (or is killed) - no pool-level
sticky state.

### Runtime app traffic is unaffected

Every `PrismaClient` instance in the codebase is instantiated via
`new PrismaPg({ connectionString: process.env.DATABASE_URL })` - the
driver adapter is fed the pooled URL explicitly. The schema's `url` and
`directUrl` declarations do not change runtime behavior. Only the
Prisma CLI (`migrate`, `db push`, `db pull`) consults them.

### `.env.local` recommendation for devs

If you run migrations against a remote DB from your machine (e.g.
`npm run migrate:staging` to retry a failed Vercel deploy), set
`DIRECT_URL` in `.env.local` too - otherwise you'll hit the same
lock-strand risk against staging or prod. Derive it from the existing
`DATABASE_URL` by stripping the `-pooler` infix from the Neon host:

```
DATABASE_URL=postgresql://...@ep-X-pooler.c-6.us-east-1.aws.neon.tech/...
DIRECT_URL=postgresql://...@ep-X.c-6.us-east-1.aws.neon.tech/...
```

Or copy the "Direct connection" string from the Neon dashboard for your
branch.

If you only run migrations against a local Postgres, `DIRECT_URL` is
not needed - Prisma falls back to `DATABASE_URL`.

## Authoring migrations on Windows - the UTF-8 BOM gotcha

PowerShell's `Set-Content -Encoding utf8` writes a UTF-8 byte-order
mark (`EF BB BF`) as the first 3 bytes of the file. PostgreSQL rejects
that mark at parse position 0, BEFORE any DDL runs:

```
ERROR: syntax error at or near "<U+FEFF>"
Position: 0
```

This bit PR-3's initial Vercel deploy. The migration row was left in
an unfinished state (`finished_at=null`, `rolled_back_at=null`),
blocking every subsequent deploy until `prisma migrate resolve
--rolled-back <name>` cleared it.

### Remedy when authoring on Windows

Write SQL via `WriteAllBytes` with `UTF8Encoding($false)`:

```powershell
$sql = @"
ALTER TABLE "Workspace" ADD COLUMN "foo" INTEGER NOT NULL DEFAULT 0;
"@
[System.IO.File]::WriteAllBytes(
  "prisma/migrations/<TIMESTAMP>_<name>/migration.sql",
  [System.Text.UTF8Encoding]::new($false).GetBytes($sql)
)
```

Or just use `npm run db:migrate:dev` and let Prisma generate the file -
Prisma writes BOM-free files.

### Verifying a file is BOM-free

```powershell
$bytes = [System.IO.File]::ReadAllBytes("prisma/migrations/<TIMESTAMP>_<name>/migration.sql")
"{0:X2} {1:X2} {2:X2}" -f $bytes[0], $bytes[1], $bytes[2]
# Expect: starts with "-- " (2D 2D 20) or any other ASCII char.
# Bad:    EF BB BF (the BOM).
```

### CI guard

`.github/workflows/ci.yml` has a `Guard against UTF-8 BOM in migration
SQL files` step in the `quality` job that runs before npm install. If
any `prisma/migrations/**/*.sql` starts with `EF BB BF`, the step
fails with a GitHub annotation pointing at the offending file. This
means a BOM'd migration cannot reach `main` - it's blocked at PR.

To interpret a failure: open the file, fix the encoding using the
PowerShell remedy above, commit, push. The check re-runs and goes
green.

## Rules

- NEVER use `prisma db push` in staging or production (it can drop data)
- NEVER delete a column directly -- add new, migrate data, delete old (2 migrations)
- NEVER rename a column directly -- add new, copy data, update code, delete old
- Always test migrations on staging before merging to main
- Migration files are append-only -- never edit a migration that has been applied

## Checking migration status

```bash
# Against local DB
npm run db:migrate:status

# Against staging DB
dotenv -e .env.staging -- npx prisma migrate status
```

## Rolling back

Prisma doesn't support automatic rollback. Options:
1. Write a new migration that reverses the change
2. Use Neon PITR (Point-in-Time Recovery) to restore DB to pre-migration state
3. Revert the code deployment in Vercel (instant, one click)

## Emergency: Schema out of sync

If `prisma migrate deploy` fails because the DB has changes not in migrations:
```bash
npx prisma migrate resolve --applied MIGRATION_NAME
```
This marks a migration as applied without running it.
