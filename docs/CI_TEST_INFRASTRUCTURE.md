# CI Test Infrastructure

## Pull-request and push CI

The E2E job (`e2e-tests` in `.github/workflows/ci.yml`) does not use repository
secrets. GitHub Actions starts service containers for that job:

- **Postgres:** `postgres:16` on `localhost:5432`, database `claws`, user and
  password `claws`. `DATABASE_URL` and `DIRECT_URL` both point at it.
- **Redis:** `redis:7` on `localhost:6379`.
- **Upstash-compatible HTTP:** `hiett/serverless-redis-http` on
  `127.0.0.1:8079`, token `ci-redis-token`, connected to the Redis service.
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` point at it.

The job runs on `ubuntu-24.04` because Playwright has no Chromium build for
the Ubuntu 26 image that `ubuntu-latest` currently is. A pull request from a
fork runs this same job.

### Schema prep

Before Playwright runs, CI resets that local database and replays the
committed migration chain:

```bash
npx prisma migrate reset --force
```

`migrate reset` drops and recreates the schema, applies every committed
migration, then runs the configured seed. A broken migration or a
reset-unsafe seed fails the job.

## Neon keep-alive

`.github/workflows/neon-e2e-keepalive.yml` is a scheduled workflow from the
hosted setup. It is not part of pull-request CI. The public repository does
not configure `TEST_DATABASE_URL` or `TEST_DIRECT_URL` for the E2E job.
