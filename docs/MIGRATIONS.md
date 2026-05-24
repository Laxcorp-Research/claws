# Database Migration Workflow

## Creating a new migration (development)

1. Make changes to `prisma/schema.prisma`
2. Run: `npm run db:migrate:dev` -- creates migration file + applies to dev DB
3. Commit the generated migration file in `prisma/migrations/`
4. Merge PR to `staging`. Vercel auto-applies the migration as part of the
   deploy: `buildCommand` in `vercel.json` is `npm run build:deploy`, which is
   `prisma generate && prisma migrate deploy && next build`. If
   `prisma migrate deploy` fails, the entire build fails and the deploy is
   aborted (fail-fast — a broken migration blocks the code deploy rather than
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
- A bad migration aborts the Vercel build — the previous deploy keeps
  serving traffic, but the DB is unchanged. That's the safer failure mode.
- A migration that succeeds but a code build that fails (rare — `next build`
  after `migrate deploy`) leaves DB ahead of code. The previous code deploy
  still serves traffic and is still compatible with the new schema only if
  the migration was additive + nullable (the standard rule per "Rules"
  below). If a destructive migration succeeded and the build failed, you
  have a real problem — recover via Neon PITR or a forward-only fix.

For risky multi-stage migrations (column rename, type change), split into
N additive PRs so each migration step lands in lockstep with a code
deploy that tolerates both old and new schema.

### Manual migrate (escape hatch)

The `npm run migrate:staging` / `npm run migrate:production` scripts still
exist (`package.json:26-27`) for cases where you need to apply a migration
without redeploying code — e.g. retrying after a transient Neon failure
during the Vercel build, or applying a hotfix migration ahead of the
matching code deploy.

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
