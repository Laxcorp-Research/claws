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
] as const;

function loadWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
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

  it("platform job needs migration_guard (guard sits between preflight and platform)", () => {
    const yml = loadWorkflow();
    expect(yml).toMatch(
      /platform:[\s\S]*?needs:\s*\[[^\]]*\bmigration_guard\b[^\]]*\]/,
    );
  });

  it("merge step uses GITHUB_TOKEN only (no speculative PAT prefer)", () => {
    const yml = loadWorkflow();
    expect(yml).not.toContain("PROMOTE_GITHUB_TOKEN || secrets.GITHUB_TOKEN");
    expect(yml).toMatch(/Merge PR[\s\S]*?GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
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
