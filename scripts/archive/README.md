# Archived one-shot scripts

These scripts are retained for operational history and must not be treated as
active production tooling:

- `backfill-next-heartbeat-at.ts`
- `backfill-superseded-deployments.ts`
- `reprovision-wire-test.ts`
- `verify-marketplace-fts.ts`
- `pr2.8a-probe.mjs`
- `pr2.8a-seed-slug-audit.mjs`
- `pr2.8a-wizard-parity-trace.mjs`

Their retained tests live in `__tests__/`. The
`cmr3fo19r000404jlze8o7dm8` fixture is a KEEP permanent canary; never delete or
mutate its data as part of cleanup work.
