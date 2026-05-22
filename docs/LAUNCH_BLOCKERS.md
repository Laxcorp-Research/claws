# Launch Blockers

Single source of truth for items blocking Phase 1 soft launch and Phase 2 public launch.

## Phase 1 soft launch blockers

### Resolved by PR2.9
- [x] ~~[#70](https://github.com/Laxcorp-Research/claws/issues/70) Composio API-key broker path for Typefully/Jotform/Toggl~~ — **resolved** by PR2.9. BYOK now ships for 9 toolkits (typefully, jotform, toggl + shopify, lever, metaads, pipedrive, webflow, follow_up_boss). Twitter and docusign remain `comingSoon: true` (OAuth-only on Composio); tracked in `docs/COMPOSIO_RUNTIME_CONTRACT.md` "Custom OAuth toolkits (operator tracker)".

### Security
- [ ] [#72](https://github.com/Laxcorp-Research/claws/issues/72) Dependency security advisories (1 critical, 3 high)
  - ~~`fast-uri` (2 high)~~ — **FIXED** in PR2.8a-fix1-deps via override `^3.1.2`
  - `sanitize-html` (critical, 1 GHSA). Upstream no patch (latest `2.17.3` is vulnerable). Allowlisted with 2026-06-15 expiry in `audit-ci.json`.
  - `protobufjs` (high, 7 GHSAs). Upstream fix only in 8.x major; transitive via `@grpc/proto-loader` (compat unverified). Allowlisted, same expiry.
  - `next` (high, 13 GHSAs). Upstream no patch (latest 16.2.4 in advisory range `9.3.4-canary.0 - 16.3.0-canary.5`). Multi-day major-bump audit deferred to its own PR. Allowlisted, same expiry.

**audit-ci forcing function:** every GHSA in `audit-ci.json`'s `allowlist` must be removed or re-justified by **2026-06-15**. CI will fail on any new high/critical advisory not in the allowlist, so new upstream advisories during the window force re-triage.

**Per-GHSA rationale** (paired with the entries in `audit-ci.json`):

| GHSA | Package | What it is |
|---|---|---|
| GHSA-rpr9-rxv7-x643 | `sanitize-html` | XSS via `xmp` raw-text passthrough (critical). No upstream patch as of 2026-05-18. Exposure surface activates when community marketplace ships (Phase 1+); only seeded skills under our control pass through this code path today. |
| GHSA-8h8q-6873-q5fj | `next` | DoS with Server Components |
| GHSA-26hh-7cqf-hhc6 | `next` | Middleware/proxy bypass via segment-prefetch routes (incomplete-fix follow-up) |
| GHSA-3g8h-86w9-wvmq | `next` | Middleware/proxy redirects cache-poisoning |
| GHSA-ffhc-5mcf-pf4q | `next` | XSS in App Router CSP nonces |
| GHSA-vfv6-92ff-j949 | `next` | Cache poisoning via RSC cache-busting collisions |
| GHSA-gx5p-jg67-6x7h | `next` | XSS in `beforeInteractive` scripts |
| GHSA-mg66-mrh9-m8jx | `next` | DoS via connection exhaustion in Cache Components |
| GHSA-h64f-5h5j-jqjh | `next` | DoS in Image Optimization API |
| GHSA-c4j6-fc7j-m34r | `next` | SSRF in WebSocket upgrades |
| GHSA-492v-c6pp-mqqv | `next` | Middleware/proxy bypass via dynamic route param injection |
| GHSA-wfc6-r584-vfw7 | `next` | Cache poisoning in RSC responses |
| GHSA-267c-6grr-h53f | `next` | Middleware/proxy bypass via segment-prefetch routes (original) |
| GHSA-36qx-fr4f-26g5 | `next` | Middleware/proxy bypass in Pages Router i18n |
| GHSA-66ff-xgx4-vchm | `protobufjs` | Code injection through bytes field defaults |
| GHSA-2pr8-phx7-x9h3 | `protobufjs` | DoS from crafted field names in generated code |
| GHSA-fx83-v9x8-x52w | `protobufjs` | Prototype injection in generated message constructors |
| GHSA-75px-5xx7-5xc7 | `protobufjs` | Code-gen gadget after prototype pollution |
| GHSA-jvwf-75h9-cwgg | `protobufjs` | Process-wide DoS through unsafe option paths |
| GHSA-685m-2w69-288q | `protobufjs` | DoS through unbounded protobuf recursion |
| GHSA-q6x5-8v7m-xcrf | `protobufjs` | Overlong UTF-8 decoding |

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
