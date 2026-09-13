# Vendored OpenClaw sanitizer (test fixture)

These files are **read-only vendored copies** of OpenClaw runtime source,
used by `src/lib/openclaw/__tests__/sanitizer-contract.test.ts` to validate
that our generator's output (`openclaw.json` + `skills.entries[...].env` +
SKILL.md frontmatter with `primaryEnv` / `requires.env`) passes the real
runtime's tier-1 + tier-2 env-var sanitizer without triggering the
`"Blocked skill env overrides for <slug>"` WARN.

Testing against a vendored copy (instead of importing the runtime as an
npm dep) because the OpenClaw runtime is not published as a package -
it ships only as the container image. The dist `plugin-sdk/` inside the
image is container-internal, not a public surface.

---

## Provenance

| Field | Value |
|---|---|
| Runtime image | `ghcr.io/laxcorp-research/openclaw-runtime:latest` |
| Image digest | `sha256:9e1af63c16d44066a3d2c66332b3842dd40a17bcaab6a6bada9fd2a172dd9301` |
| Vendored on | 2026-04-19 (PR #3a) |
| Rootfs extract path used | `C:\temp\openclaw-rootfs\` |

## Files and their upstream source

| File here | Upstream source |
|---|---|
| `sanitize-env-vars.ts` | `src/agents/sandbox/sanitize-env-vars.ts` (verbatim) |
| `host-env-security.ts` | `src/infra/host-env-security.ts` (reconstructed from `dist/host-env-security-CJMD0__Z.js`; source TS not in extract) |
| `skill-env-sanitizer.ts` | `src/agents/skills/env-overrides.ts` (partial - `sanitizeSkillEnvOverrides` + `isAlwaysBlockedSkillEnvKey` only; outer apply/revert/logger machinery elided) |

Each vendored file has a leading comment pointing back here.

## Re-sync process (when the OpenClaw image digest changes)

The runtime image is updated periodically by the OpenClaw team. When the
digest pinned in `docs/COMPOSIO_RUNTIME_CONTRACT.md` or an OpenClaw version
in `prisma.openClawVersion` changes, the sanitizer logic may have
changed too. Re-sync steps:

1. **Pull the new image rootfs.** Existing process per `docs/COMPOSIO_RUNTIME_CONTRACT.md` §"Provenance": `docker create --name tmp <new-digest>`, `docker export tmp | tar -xf -` into `C:\temp\openclaw-rootfs-<digest-prefix>\`.

2. **Diff the three source files against the vendored copies:**
   ```
   diff C:\temp\openclaw-rootfs-<new>\src\agents\sandbox\sanitize-env-vars.ts src\test\fixtures\openclaw-sanitizer\sanitize-env-vars.ts
   diff C:\temp\openclaw-rootfs-<new>\src\agents\skills\env-overrides.ts        src\test\fixtures\openclaw-sanitizer\skill-env-sanitizer.ts
   # host-env-security: diff the JS bundle ...\dist\host-env-security-*.js and re-reconstruct TS.
   ```

3. **If changes are purely additive/compatible** (new blocked patterns, new allowed keys that don't affect the decision for our own emitted env vars): port them verbatim into the vendored files, update this README's `Vendored on` date + digest, run the contract test, commit.

4. **If changes are breaking** (different decision for inputs our generator could emit): that's a behavior change. Update our generator emission accordingly, update both the vendored copy and the test expectations in one PR. Commit message must state "resynced vendored sanitizer from <old-digest> -> <new-digest>" and link the diff summary.

5. **Never skip re-sync when bumping the OpenClaw image version.** Stale vendored files = test passes against old logic but prod runtime blocks env vars at real deploy time. There is no automation catching this today; the bump-reviewer is responsible.

## What the vendored sanitizer does NOT cover

This vendor includes only the env-override decision (tier-1 block
patterns + tier-2 allowlist merge). It intentionally skips:

- `applySkillEnvOverrides` / `applySkillEnvOverridesFromSnapshot` - the
  functions that actually mutate `process.env` and return a reverter.
  They wrap `sanitizeSkillEnvOverrides`; the wrap logic is runtime-
  specific. Our generator doesn't need to test it.
- `resolveSkillConfig` / `resolveSkillKey` - config-graph navigation.
  The contract test constructs synthetic inputs directly.
- The `log.warn('Blocked skill env overrides for ...')` call itself.
  The contract test asserts on `result.blocked.length > 0` (i.e. the
  condition that triggers the WARN), not the log output.

If the test contract evolves to require testing the apply/revert or the
WARN log capture, add those functions here and document in this file.
