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
| Upstream tag | `v2026.9.4` |
| Source | https://github.com/openclaw/openclaw/tree/v2026.9.4 |
| Vendored on | 2026-09-12 (RUNTIME 9.4 overlay port) |
| Previous vendor | 2026-04-19 (image digest `sha256:9e1af63c16d44066a3d2c66332b3842dd40a17bcaab6a6bada9fd2a172dd9301`) |

## Files and their upstream source

| File here | Upstream source @ v2026.9.4 |
|---|---|
| `sanitize-env-vars.ts` | `src/agents/sandbox/sanitize-env-vars.ts` (decision functions only; live plugin secret inventory omitted) |
| `host-env-security.ts` + `host-env-security-policy.json` | `src/infra/host-env-security.ts` + `src/infra/host-env-security-policy.json` (`isDangerousHostEnvVarName` + `isDangerousHostEnvOverrideVarName`) |
| `skill-env-sanitizer.ts` | `src/skills/runtime/env-overrides.ts` (partial - `sanitizeSkillEnvOverrides` + `isAlwaysBlockedSkillEnvKey` only). **Path moved** from `src/agents/skills/env-overrides.ts` (404 on 9.4). |

Each vendored file has a leading comment pointing back here.

## Re-sync process (when the OpenClaw pin changes)

1. Clone `https://github.com/openclaw/openclaw` at the candidate **unsuffixed** `upstream_tag`.
2. Diff the three source files against the vendored copies.
3. Port additive blocked patterns / override keys verbatim; update this README's tag + date; run `sanitizer-contract.test.ts`.
4. Breaking decision changes must update generator emit in the same PR.
5. Never skip re-sync when bumping the OpenClaw image version.

## What the vendored sanitizer does NOT cover

- `applySkillEnvOverrides` / snapshot apply/revert (mutates `process.env`).
- `getCurrentPluginMetadataSnapshot` / `listKnownSecretEnvVarNames` (live plugin inventory). Pattern list is the 9.4 source of truth for generator emit.
- Config-graph navigation (`resolveSkillConfig`).
- The runtime WARN log string itself - contract test asserts `result.blocked`.
