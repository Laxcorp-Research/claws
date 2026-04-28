# Database Migration Workflow

## Creating a new migration (development)

1. Make changes to `prisma/schema.prisma`
2. Run: `npm run db:migrate:dev` -- creates migration file + applies to dev DB
3. Commit the generated migration file in `prisma/migrations/`
4. Merge PR to `staging`. Vercel deploy does NOT auto-run migrations (changed
   in commit e94932f — Vercel's `buildCommand` in `vercel.json` is `npm run build`,
   which is `prisma generate && next build` without `migrate deploy`).
   Run the migration manually after the deploy lands:
   `npm run migrate:staging`
5. Verify on staging (query DB directly or run `dotenv -e .env.staging -- npx prisma migrate status`)
6. PR `staging` to `main`. Merge. Again, Vercel does NOT auto-run migrations.
   Run the migration manually after the prod deploy lands:
   `npm run migrate:production`

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
