# Contributing — Engineering Process

This document captures engineering-process learnings that have repeatedly proven
load-bearing on this codebase. They live here (not just in chat transcripts or
one-off contract docs) so future work doesn't re-discover them the hard way.

## Audit discipline (Phase A)

**Principle: read-only investigation before code, contract-first.** Before
changing a non-trivial code path, do a Phase A audit — gather the actual current
state (schema relations, call sites, external versions, live config) and write
down what the change assumes. Only then write code.

### The include-relations rule

When auditing any code path with a Prisma `include:` or `select:`, **enumerate
every relation it pulls and verify each against the change's assumptions.**
Missing a relation in the audit means downstream predictions about behavior may
be wrong — even if the change itself works correctly.

**Concrete failure example (PR-8a/C WIRE-TEST E3 prediction error):** the audit
checked the `Workspace` and `CreditAccount` relations but did not query
`UserApiKey` for the workspace owner. The resulting prediction — that
`expected.key_fp` would be `null` under a `USER_OWN_KEY` override — was wrong,
because a pre-existing April-1 BYOK key existed in the database. The test still
passed (drift *was* detected), but for a different reason than predicted. A
correct prediction needs every relation that feeds the derivation, not just the
obvious ones.

### Verify external reality, don't trust memory

External dependency versions, API shapes, and schema relations drift. **Verify
them against current state before relying on them** — don't trust memory or
stale documentation.

**Concrete success example (PR-B Node 24 actions audit):** the proposed action
target versions were listed from memory. Each was then verified via
`gh api repos/<owner>/<repo>/releases/latest` rather than trusting the list —
which caught that `actions/checkout` and `actions/setup-node` had moved to v6
(not v5), `docker/setup-buildx-action` to v4, and `docker/build-push-action` to
v7. The in-memory version list was stale; the verification step is what made the
migration decision correct.

**Generalizable rule:** external dependency versions, API shapes, schema
relations — verify against current state, don't trust memory or stale docs.

## Halt-between-substeps

When working on a multi-PR arc, **each sub-PR halts for review before the next
begins.**

- Avoids compounding bugs across sub-PRs (a wrong assumption in sub-PR A doesn't
  silently propagate into B, C, D).
- Avoids re-doing downstream work if an early sub-PR needs revision.

## Fix on discovery, no parking

When investigating one issue, **related findings should be addressed in the same
context** rather than filed for "later."

- Filing follow-ups or recommending separate fixes can become a drift error —
  the "later" PR never gets the same context and the issue lingers.
- **Exception:** genuine scope creep beyond the immediate context (e.g. a
  load-bearing major dependency bump surfaced mid-audit) *does* get filed as its
  own PR. The judgment call is whether the fix shares the current context and is
  small/understood, vs. needing its own dedicated thinking.

## Mutation testing for protected invariants

Each protected invariant gets **at least one mutation test**:

1. Apply the mutation (break the invariant in the source).
2. Run the relevant test.
3. Confirm it **fails** (the test actually guards the invariant).
4. Revert the mutation.

When sub-PRs build on each other, **re-run earlier mutations against the final
tree** at the end of the arc — this catches *silent weakening*, where a later
change inadvertently makes an earlier guard vacuous (the mutation no longer fails
a test that used to catch it).

## Rule 20 — `next build` before pushing route changes

Any PR that touches `**/route.ts` (App Router handlers) or changes the set of
exported HTTP methods / path segments under `src/app/api/**` **must** run a
local `next build` (or `npm run build`) and paste the success line into the PR
body before push.

Why: Vitest and `tsc --noEmit` do not exercise Next's route-module graph,
dynamic segment validation, or the production bundler. Several past regressions
(missing exports, illegal client imports into route handlers, broken
`params: Promise<>` signatures under Next 16) only failed at `next build` or on
the Vercel build — after the unit suite was already green.

Minimum gate for such PRs:

1. Relevant unit / Playwright suite green.
2. `npx tsc --noEmit` (or the repo's typecheck script) green.
3. `npm run build` green — paste the final `✓ Compiled successfully` (or
   equivalent) line in the PR description.
4. Linter diagnostics clean on every file in the diff.

## Rule 38 - main is promote-only

The only legal pull request targeting `main` is the promote PR, whose head
branch is `staging`. Feature work opens against `staging`. `.github/workflows/lane-gate.yml`
fails any other `pull_request` to `main`.

**Repo branch-protection note:** after this workflow exists on `main` (it
arrives via promote, same as every other change), add the check
`PRs to main must come from staging` as a required status check on `main`.
Do not allow administrators to bypass it for routine merges. Direct pushes
to `main` stay blocked.

**Incident #509:** `gh pr create` without `--base staging` defaulted to
`main` and merged Quant overlay `69c0dd3`. That skip meant
`promote-to-production.yml` never ran. Confirm it carried **no** Prisma
migration:

```
$ git diff --name-only 69c0dd3^1 69c0dd3 -- prisma/migrations/
# (empty)
$ git log -1 --format=%P 69c0dd3
f30bc3b4aa1089dc8005c47207a52d24f7e754f4 99286cdee86428005c341f8610c16a71880df589
```

First parent is previous `main` (`f30bc3b`). The path filter listed nothing
under `prisma/migrations/`. Never again: always `gh pr create --base staging`.
