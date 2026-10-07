# Contributing

## License

By contributing you agree that your contribution is licensed under AGPL-3.0-only, except changes under `prisma/seed-data/`, which are Apache-2.0. See [NOTICE](NOTICE).

## Pull requests

- One concern per pull request.
- Fork pull requests do not receive CI secrets. The lint, typecheck, and unit-test lane still runs. Do not add `pull_request_target`.
- Add a regression test for a bug fix. The test name states the scenario.
- Do not commit secrets, `.env` files, or audit scratch (`audit-tmp`, personal machine paths).

## Local

```bash
npm ci
npx prisma generate
npx vitest run
```

Copy `.env.example` to `.env.local` and fill only the values you need. Hosted billing, Railway, and the credit pool are optional for a UI-only checkout.

Internal engineering notes live in `docs/`. They are not a substitute for this file.
