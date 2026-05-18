# Launch Blockers

Single source of truth for items blocking Phase 1 soft launch and Phase 2 public launch.

## Phase 1 soft launch blockers

### Security
- [ ] [#72](https://github.com/Laxcorp-Research/claws/issues/72) Dependency security advisories (1 critical, 3 high)
  - sanitize-html (critical — XSS in marketplace skill rendering)
  - protobufjs (high)
  - fast-uri (high)
  - next (high — multi-day audit, separate major-version PR)

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
