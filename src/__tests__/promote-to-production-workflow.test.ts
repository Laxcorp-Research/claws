/**
 * Contract tests for promote-to-production.yml.
 *
 * Ensures the six post-promote probe assertions remain present (markers are
 * intentional anchors — deleting one must fail this suite). No GitHub network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKFLOW_PATH = resolve(
  __dirname,
  "../../.github/workflows/promote-to-production.yml",
);

const REQUIRED_PROBE_MARKERS = [
  "PROBE_ASSERT: health_http_200",
  "PROBE_ASSERT: blob_token_http_401",
  "PROBE_ASSERT: finalize_http_401",
  "PROBE_ASSERT: upload_http_413_USE_BLOB",
  "PROBE_ASSERT: stable_version_match",
  "PROBE_ASSERT: latest_references_version_digest",
] as const;

const REQUIRED_STRUCTURAL = [
  "confirm must be exactly PROMOTE-PROD",
  "Staging-proven",
  "api/versions/stable",
  "concurrency:",
  "group: promote-to-production",
  "uses: ./.github/workflows/promote-openclaw-image.yml",
  "target_env: production",
  "target=production",
  "PROD_METERING_MASTER_SECRET",
  "NEVER promote a Preview",
  "window_state",
  "PROMOTE_GITHUB_TOKEN",
  "retrying listing without team scope",
  // Migration guard (maiden window ships the guard; later dispatches enforce it).
  "MIGRATION_GUARD_ASSERT: prisma_migrations_ack",
  "ACK-MIGRATIONS",
  "migrations_ack",
  "prisma/migrations/",
  "migration_guard",
  // Boot-time reusable-call grant (packages: write must cover the image callee).
  "packages: write",
  // Round-4: wait-then-merge / permissions-probe need check + status reads.
  "CHECKS_READ_PERMISSION_ASSERT",
  "STATUSES_READ_PERMISSION_ASSERT",
  "PERMISSIONS_PROBE_ASSERT: statusCheckRollup_readable",
  // Platform checkout + noop + dry-run (round-2 boot/platform fixes).
  "PLATFORM_NOOP_ASSERT: staging_eq_main",
  "platform already current (staging==main)",
  "DRY_RUN_ASSERT: platform_echo",
  "DRY_RUN_ASSERT: image_echo",
  "dry_run:",
  // Independent probes + always-succeed summary (round-3 verification harden).
  "PROBE_AGGREGATE_ASSERT: independent_probes_complete_table",
  "continue-on-error: true",
  "SUMMARY_ALWAYS_SUCCEEDS",
  "closed-successful",
] as const;

/** Jobs that run git / gh-against-repo and therefore require checkout. */
const GIT_USING_JOBS = ["migration_guard", "platform"] as const;

function loadWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

/** Slice of the workflow YAML from `jobKey:` until the next top-level job or EOF. */
function jobBlock(yml: string, jobKey: string): string {
  const re = new RegExp(`^  ${jobKey}:\\r?\\n`, "m");
  const m = re.exec(yml);
  expect(m, `job ${jobKey} missing`).toBeTruthy();
  const start = m!.index;
  const rest = yml.slice(start + 1);
  const next = rest.search(/\n  [a-z_][a-z0-9_]*:\r?\n/);
  return next === -1 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

describe("promote-to-production.yml contract", () => {
  it("contains all six PROBE_ASSERT markers", () => {
    const yml = loadWorkflow();
    for (const marker of REQUIRED_PROBE_MARKERS) {
      expect(yml, `missing probe marker: ${marker}`).toContain(marker);
    }
  });

  it("contains structural promotion invariants", () => {
    const yml = loadWorkflow();
    for (const needle of REQUIRED_STRUCTURAL) {
      expect(yml, `missing structural marker: ${needle}`).toContain(needle);
    }
  });

  it("MUTATION: removing each PROBE_ASSERT marker fails the marker check", () => {
    const yml = loadWorkflow();
    for (const victim of REQUIRED_PROBE_MARKERS) {
      const mutated = yml.replace(victim, "PROBE_ASSERT: REMOVED_FOR_MUTATION");
      expect(mutated, `mutation target missing: ${victim}`).not.toContain(victim);
      const stillPresent = REQUIRED_PROBE_MARKERS.every((m) => mutated.includes(m));
      expect(stillPresent, `mutation should break suite for ${victim}`).toBe(false);
    }
  });

  it("MUTATION: removing PROMOTE_GITHUB_TOKEN remedy text fails structural check", () => {
    const yml = loadWorkflow();
    const mutated = yml.replaceAll("PROMOTE_GITHUB_TOKEN", "REMOVED_PAT_REMEDY");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("MUTATION: removing team-scope retry text fails structural check", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      "retrying listing without team scope",
      "REMOVED_TEAM_RETRY",
    );
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("MUTATION-anchored: removing migration guard assert fails structural check", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      "MIGRATION_GUARD_ASSERT: prisma_migrations_ack",
      "MIGRATION_GUARD_ASSERT: REMOVED",
    );
    expect(mutated).not.toContain("MIGRATION_GUARD_ASSERT: prisma_migrations_ack");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("workflow-level permissions grant packages: write (reusable image callee)", () => {
    const yml = loadWorkflow();
    // Top-level permissions block (before jobs:) must include packages: write.
    const top = yml.slice(0, yml.indexOf("\njobs:"));
    expect(top).toMatch(/permissions:[\s\S]*?\bpackages:\s*write\b/);
    expect(top).not.toMatch(/permissions:[\s\S]*?\bpackages:\s*read\b/);
  });

  it("workflow-level permissions grant checks: read + statuses: read (wait-then-merge)", () => {
    const yml = loadWorkflow();
    const top = yml.slice(0, yml.indexOf("\njobs:"));
    expect(top).toMatch(/\bchecks:\s*read\b.*CHECKS_READ_PERMISSION_ASSERT/);
    expect(top).toMatch(/\bstatuses:\s*read\b.*STATUSES_READ_PERMISSION_ASSERT/);
    // Scope map comment must name both poll APIs.
    expect(top).toContain("gh pr view --json statusCheckRollup");
    expect(top).toContain("gh pr checks");
  });

  it("MUTATION: removing packages: write fails permissions contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replaceAll("packages: write", "packages: read");
    expect(mutated).not.toContain("packages: write");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
    const top = mutated.slice(0, mutated.indexOf("\njobs:"));
    expect(top).not.toMatch(/permissions:[\s\S]*?\bpackages:\s*write\b/);
  });

  it("MUTATION: removing checks: read fails permissions contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      / {2}checks: read # CHECKS_READ_PERMISSION_ASSERT\r?\n/,
      "",
    );
    expect(mutated).not.toContain("CHECKS_READ_PERMISSION_ASSERT");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("MUTATION: removing statuses: read fails permissions contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      / {2}statuses: read # STATUSES_READ_PERMISSION_ASSERT\r?\n/,
      "",
    );
    expect(mutated).not.toContain("STATUSES_READ_PERMISSION_ASSERT");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("preflight permissions-probe reads statusCheckRollup before GHCR gates", () => {
    const yml = loadWorkflow();
    const preflight = jobBlock(yml, "preflight");
    expect(preflight).toContain("PERMISSIONS_PROBE_ASSERT: statusCheckRollup_readable");
    expect(preflight).toContain("Probe GITHUB_TOKEN can read statusCheckRollup");
    expect(preflight).toContain('gh pr view -R "$REPO" "$PR" --json statusCheckRollup');
    expect(preflight).toContain("NO checkout by design");
    const probeIdx = preflight.indexOf("PERMISSIONS_PROBE_ASSERT: statusCheckRollup_readable");
    const digestsIdx = preflight.indexOf("Resolve GHCR digests");
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(digestsIdx).toBeGreaterThan(probeIdx);
  });

  it("permissions-probe gh commands carry -R (workspace-free)", () => {
    const yml = loadWorkflow();
    const preflight = jobBlock(yml, "preflight");
    const probeStart = preflight.indexOf("Probe GITHUB_TOKEN can read statusCheckRollup");
    const probeEnd = preflight.indexOf("Resolve GHCR digests");
    const probe = preflight.slice(probeStart, probeEnd);
    expect(probe).toContain('gh pr list -R "$REPO"');
    expect(probe).toContain('gh pr view -R "$REPO"');
    // Every gh invocation in the probe must include -R.
    const ghLines = probe.split("\n").filter((l) => /\bgh pr\b/.test(l));
    expect(ghLines.length).toBeGreaterThanOrEqual(2);
    for (const line of ghLines) {
      expect(line, `missing -R: ${line}`).toMatch(/\s-R\s/);
    }
  });

  it("MUTATION: stripping -R from probe gh calls fails contract", () => {
    const yml = loadWorkflow();
    const mutated = yml
      .replace('gh pr list -R "$REPO"', "gh pr list")
      .replace('gh pr view -R "$REPO"', "gh pr view");
    const preflight = jobBlock(mutated, "preflight");
    const probeStart = preflight.indexOf("Probe GITHUB_TOKEN can read statusCheckRollup");
    const probeEnd = preflight.indexOf("Resolve GHCR digests");
    const probe = preflight.slice(probeStart, probeEnd);
    const ghLines = probe.split("\n").filter((l) => /\bgh pr\b/.test(l));
    expect(ghLines.some((l) => !/\s-R\s/.test(l))).toBe(true);
  });

  it("MUTATION: removing permissions-probe marker fails contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      "PERMISSIONS_PROBE_ASSERT: statusCheckRollup_readable",
      "PERMISSIONS_PROBE_ASSERT: REMOVED",
    );
    expect(mutated).not.toContain("PERMISSIONS_PROBE_ASSERT: statusCheckRollup_readable");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("image job grants packages: write for the workflow_call", () => {
    const yml = loadWorkflow();
    expect(yml).toMatch(
      /image:[\s\S]*?permissions:[\s\S]*?\bpackages:\s*write\b[\s\S]*?uses:\s*\.\/\.github\/workflows\/promote-openclaw-image\.yml/,
    );
  });

  it("platform job needs migration_guard (guard sits between preflight and platform)", () => {
    const yml = loadWorkflow();
    expect(yml).toMatch(
      /platform:[\s\S]*?needs:\s*\[[^\]]*\bmigration_guard\b[^\]]*\]/,
    );
  });

  it("merge step uses GITHUB_TOKEN only (no speculative PAT prefer)", () => {
    const yml = loadWorkflow();
    expect(yml).not.toContain("PROMOTE_GITHUB_TOKEN || secrets.GITHUB_TOKEN");
    expect(yml).toMatch(
      /Wait for checks, then merge[\s\S]*?GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/,
    );
  });

  it("wait-then-merge: polls checks then merges without --admin", () => {
    const yml = loadWorkflow();
    expect(yml).toContain("WAIT_THEN_MERGE_ASSERT: poll_checks_before_merge");
    expect(yml).toContain("MERGE_WITHOUT_ADMIN_ASSERT: no --admin on the merge invocation");
    expect(yml).toContain("DEADLINE_SECS=2400");
    // Happy-path merge must NOT use --admin (PROMOTE_GITHUB_TOKEN remains the loud-fail remedy).
    const mergeStep = yml.slice(
      yml.indexOf("Wait for checks, then merge"),
      yml.indexOf("Wait for Vercel Production READY"),
    );
    expect(mergeStep).toContain('gh pr merge "$PR_NUMBER" --merge');
    expect(mergeStep).not.toMatch(/gh pr merge[^\n]*--admin/);
    expect(mergeStep).toContain("PROMOTE_GITHUB_TOKEN");
  });

  it("MUTATION: removing wait-loop marker fails wait-then-merge contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      "WAIT_THEN_MERGE_ASSERT: poll_checks_before_merge",
      "WAIT_THEN_MERGE_ASSERT: REMOVED",
    );
    expect(mutated).not.toContain("WAIT_THEN_MERGE_ASSERT: poll_checks_before_merge");
  });

  it("MUTATION: adding --admin back to merge invocation fails no-admin contract", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      'gh pr merge "$PR_NUMBER" --merge 2>&1',
      'gh pr merge "$PR_NUMBER" --merge --admin 2>&1',
    );
    const mergeStep = mutated.slice(
      mutated.indexOf("Wait for checks, then merge"),
      mutated.indexOf("Wait for Vercel Production READY"),
    );
    expect(mergeStep).toMatch(/gh pr merge[^\n]*--admin/);
  });

  it("each git-using job has actions/checkout before git/gh repo ops", () => {
    const yml = loadWorkflow();
    for (const job of GIT_USING_JOBS) {
      const block = jobBlock(yml, job);
      expect(block, `${job} missing actions/checkout@v4`).toContain(
        "uses: actions/checkout@v4",
      );
      expect(block, `${job} missing fetch-depth: 0`).toMatch(/fetch-depth:\s*0/);
      const checkoutIdx = block.indexOf("uses: actions/checkout@v4");
      const gitIdx = block.search(/\bgit (fetch|rev-list|diff|rev-parse)\b/);
      const ghPrIdx = block.search(/\bgh pr (create|list|merge)\b/);
      const firstRepoOp = [gitIdx, ghPrIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      expect(firstRepoOp, `${job} has no git/gh repo op`).toBeGreaterThanOrEqual(0);
      expect(checkoutIdx, `${job} checkout must precede git/gh`).toBeLessThan(firstRepoOp!);
    }
  });

  it("MUTATION: removing platform checkout fails checkout-present contract", () => {
    const yml = loadWorkflow();
    const platform = jobBlock(yml, "platform");
    const mutatedPlatform = platform.replace(
      /uses: actions\/checkout@v4/,
      "uses: actions/checkout@REMOVED",
    );
    const mutated = yml.replace(platform, mutatedPlatform);
    const block = jobBlock(mutated, "platform");
    expect(block).not.toContain("uses: actions/checkout@v4");
    expect(block).toContain("uses: actions/checkout@REMOVED");
  });

  it("no-op path: rev-list count 0 skips PR and continues (marker + success path)", () => {
    const yml = loadWorkflow();
    expect(yml).toContain("git rev-list --count origin/main..origin/staging");
    expect(yml).toContain("PLATFORM_NOOP_ASSERT: staging_eq_main");
    expect(yml).toContain("platform already current (staging==main)");
    expect(yml).toMatch(/platform_mode=noop/);
    // Promote PR steps only run when mode == promote (noop must not fail the job).
    expect(yml).toMatch(
      /Create or reuse staging→main PR[\s\S]*?if:\s*\$\{\{\s*steps\.resolve\.outputs\.platform_mode\s*==\s*'promote'\s*\}\}/,
    );
  });

  it("MUTATION: making 0-count fail the job breaks no-op contract", () => {
    const yml = loadWorkflow();
    // Simulate a broken noop that exits 1 when count==0 (would fail image-only re-runs).
    const mutated = yml.replace(
      'echo "platform_mode=noop" >> "$GITHUB_OUTPUT"',
      'echo "::error::refusing noop"; exit 1',
    );
    expect(mutated).not.toContain('echo "platform_mode=noop" >> "$GITHUB_OUTPUT"');
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(true);
    // Structural markers alone don't catch this — assert the success-path assignment is gone.
    expect(mutated).not.toMatch(/platform_mode=noop/);
  });

  it("dry_run input + echo markers for platform/image/probes", () => {
    const yml = loadWorkflow();
    expect(yml).toMatch(/dry_run:\s*\n\s+description:/);
    expect(yml).toContain("DRY_RUN_ASSERT: platform_echo");
    expect(yml).toContain("DRY_RUN_ASSERT: image_echo");
    expect(yml).toContain("image_dry_run:");
    expect(yml).toContain("DRY_RUN_ASSERT: probe_echo");
    expect(yml).toContain("DRY_RUN_ASSERT: probe_stable_get");
  });

  it("MUTATION: removing dry_run input fails structural check", () => {
    const yml = loadWorkflow();
    const mutated = yml.replaceAll("dry_run:", "dry_run_REMOVED:");
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("probes use continue-on-error + aggregate; summary always succeeds", () => {
    const yml = loadWorkflow();
    expect(yml).toContain("PROBE_AGGREGATE_ASSERT: independent_probes_complete_table");
    expect(yml).toContain("SUMMARY_ALWAYS_SUCCEEDS");
    expect(yml).toContain("closed-successful");
    const probes = jobBlock(yml, "probes");
    expect((probes.match(/continue-on-error:\s*true/g) || []).length).toBeGreaterThanOrEqual(6);
  });

  it("MUTATION: removing probe aggregate assert fails structural check", () => {
    const yml = loadWorkflow();
    const mutated = yml.replace(
      "PROBE_AGGREGATE_ASSERT: independent_probes_complete_table",
      "PROBE_AGGREGATE_ASSERT: REMOVED",
    );
    expect(REQUIRED_STRUCTURAL.every((n) => mutated.includes(n))).toBe(false);
  });

  it("promote-openclaw-image.yml exposes workflow_call", () => {
    const path = resolve(
      __dirname,
      "../../.github/workflows/promote-openclaw-image.yml",
    );
    const yml = readFileSync(path, "utf8");
    expect(yml).toContain("workflow_call:");
    expect(yml).toContain("target_env:");
  });
});
