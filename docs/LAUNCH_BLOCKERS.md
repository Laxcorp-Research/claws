# Launch Blockers

Single source of truth for items blocking Phase 1 soft launch and Phase 2 public launch.

## Phase 1 soft launch blockers

### Resolved by PR2.9
- [x] ~~[#70](https://github.com/Laxcorp-Research/claws/issues/70) Composio API-key broker path for Typefully/Jotform/Toggl~~ — **resolved** by PR2.9. BYOK now ships for 9 toolkits (typefully, jotform, toggl + shopify, lever, metaads, pipedrive, webflow, follow_up_boss). Twitter and docusign remain `comingSoon: true` (OAuth-only on Composio); tracked in `docs/COMPOSIO_RUNTIME_CONTRACT.md` "Custom OAuth toolkits (operator tracker)".

### Security
- [ ] [#72](https://github.com/Laxcorp-Research/claws/issues/72) Dependency security advisories (1 critical, 3 high)
  - ~~`fast-uri` (2 high)~~ — **FIXED** in PR2.8a-fix1-deps via override `^3.1.2`
  - ~~`sanitize-html` (critical, 1 GHSA)~~ — **FIXED** (fix-sanitize-html-cve); no longer present in `npm audit` as of the 2026-06-11 re-audit, not in the allowlist.
  - ~~`protobufjs` (high, 7 GHSAs)~~ — **FIXED** by the 2026-06-11 re-audit (GH #72): upstream backported fixes to the 7.x line (the original "fix only in 8.x major" assessment is obsolete); in-range lockfile bump `7.5.5 → 7.6.3` via `@grpc/proto-loader@^7.5.5` cleared all seven GHSAs; entries removed from `audit-ci.json`.
  - `next` (13 GHSAs: 7 high, 6 low/moderate). **Upstream fixes now exist** (advisory ranges close at `16.2.5`; we run `16.2.3`). The bump `16.2.3 → ≤16.2.7` is deliberately its own dedicated PR with full E2E/Playwright per the standing #72 policy — framework bumps don't ride a chore. Allowlisted until that PR lands; renewed 2026-06-11, expiry 2026-07-15. Gate note: the gate fails only on high/critical, so the 7 high entries are the load-bearing allowlist lines.
  - `hono` (1 high) + `nodemailer` (1 high) — surfaced 2026-06-20 (post-PR-2 staging audit). **Upstream fixes exist** (hono `4.12.25`, nodemailer `9.0.1`) but both are **unreachable in this app**: `hono` is transitive via `prisma > @prisma/dev` (the Prisma CLI dev server, not the app runtime) and its CORS advisory needs hono's CORS middleware; `nodemailer` is **not imported anywhere in `src`** (the app sends mail via Resend) and its advisory requires `nodemailer.sendMail({raw|attachment})` on untrusted input. The real fix is a version bump — nodemailer `9.0.1` is a **major** on an otherwise-unused dep — deferred to Dependabot / a working-registry environment (local npm is TLS-cert-blocked here, so the lockfile can't be regenerated). Allowlisted pending that bump; re-audit 2026-07-15.

**audit-ci forcing function:** every GHSA in `audit-ci.json`'s `allowlist` must be removed or re-justified by **2026-07-15** (renewed from 2026-06-15 by the 2026-06-11 re-audit). CI will fail on any new high/critical advisory not in the allowlist, so new upstream advisories during the window force re-triage.

**Per-GHSA rationale** (paired with the entries in `audit-ci.json`; the `next` entries are all fixed upstream in `16.2.5`, pending the dedicated Next-bump PR; the `hono`/`nodemailer` entries are unreachable transitive advisories pending a dependency bump):

| GHSA | Package | What it is | 2026-06-11 status |
|---|---|---|---|
| GHSA-8h8q-6873-q5fj | `next` | DoS with Server Components | high; fix in 16.2.5; awaiting Next PR |
| GHSA-26hh-7cqf-hhc6 | `next` | Middleware/proxy bypass via segment-prefetch routes (incomplete-fix follow-up) | high; fix in 16.2.5; awaiting Next PR |
| GHSA-3g8h-86w9-wvmq | `next` | Middleware/proxy redirects cache-poisoning | low (below gate threshold); fix in 16.2.5 |
| GHSA-ffhc-5mcf-pf4q | `next` | XSS in App Router CSP nonces | moderate (below gate threshold); fix in 16.2.5 |
| GHSA-vfv6-92ff-j949 | `next` | Cache poisoning via RSC cache-busting collisions | low (below gate threshold); fix in 16.2.5 |
| GHSA-gx5p-jg67-6x7h | `next` | XSS in `beforeInteractive` scripts | moderate (below gate threshold); fix in 16.2.5 |
| GHSA-mg66-mrh9-m8jx | `next` | DoS via connection exhaustion in Cache Components | high; fix in 16.2.5; awaiting Next PR |
| GHSA-h64f-5h5j-jqjh | `next` | DoS in Image Optimization API | moderate (below gate threshold); fix in 16.2.5 |
| GHSA-c4j6-fc7j-m34r | `next` | SSRF in WebSocket upgrades | high; fix in 16.2.5; awaiting Next PR |
| GHSA-492v-c6pp-mqqv | `next` | Middleware/proxy bypass via dynamic route param injection | high; fix in 16.2.5; awaiting Next PR |
| GHSA-wfc6-r584-vfw7 | `next` | Cache poisoning in RSC responses | moderate (below gate threshold); fix in 16.2.5 |
| GHSA-267c-6grr-h53f | `next` | Middleware/proxy bypass via segment-prefetch routes (original) | high; fix in 16.2.5; awaiting Next PR |
| GHSA-36qx-fr4f-26g5 | `next` | Middleware/proxy bypass in Pages Router i18n | high; fix in 16.2.5; awaiting Next PR |
| GHSA-88fw-hqm2-52qc | `hono` | CORS middleware reflects any Origin with credentials when `origin` defaults to wildcard | high; transitive via prisma>@prisma/dev, unused in app; fix hono≥4.12.25; allowlisted pending bump |
| GHSA-p6gq-j5cr-w38f | `nodemailer` | `raw` message option bypasses disableFileAccess/disableUrlAccess (arbitrary file read + SSRF) | high; nodemailer unused (app uses Resend); fix nodemailer≥9.0.1 (major); allowlisted pending bump |

Removed by the 2026-06-11 re-audit (in-range `protobufjs 7.5.5 → 7.6.3` bump cleared them; kept for the audit trail): GHSA-66ff-xgx4-vchm, GHSA-2pr8-phx7-x9h3, GHSA-fx83-v9x8-x52w, GHSA-75px-5xx7-5xc7, GHSA-jvwf-75h9-cwgg, GHSA-685m-2w69-288q, GHSA-q6x5-8v7m-xcrf.

### Infrastructure / CI
- [#73](https://github.com/Laxcorp-Research/claws/issues/73) CI E2E test Neon branch unreachable — NOT launch-blocking, listed for visibility

### Legal (not yet detailed — placeholder)
- [ ] Terms of Service (Dubai IFZA jurisdiction)
- [ ] Privacy Policy
- [ ] Refund policy

### Financial (not yet detailed — placeholder)
- [ ] Dodo live mode real $1 transaction test
- [ ] Sales tax setup

### Compliance (not yet detailed — placeholder)
- [ ] Per regulated Claw review (Medical/Law/Real Estate/Quant/B2B/Recruiter)

### GTM / Operational (not yet detailed — placeholder)
- [ ] Landing page
- [ ] support@buildclaws.ai routing

## Phase 2 public launch blockers

Inherited from Phase 1 + additional polish items (see master tracker).

---

This doc updates as items move through PRs. When an issue resolves, strike it through and link to the resolving PR/commit.
