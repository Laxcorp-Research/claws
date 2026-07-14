/**
 * SECRET MANIFEST contract: every secrets.* reference in .github/workflows
 * must appear in docs/GITHUB_ACTIONS_SECRETS_MANIFEST.json (and vice versa).
 * GITHUB_TOKEN is excluded (platform-provided).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../..");
const WORKFLOWS_DIR = join(ROOT, ".github/workflows");
const MANIFEST_PATH = join(ROOT, "docs/GITHUB_ACTIONS_SECRETS_MANIFEST.json");

type Manifest = {
  secrets: Array<{ name: string; purpose: string; whereCreated: string }>;
};

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

function workflowSecretNames(): Set<string> {
  const names = new Set<string>();
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"));
  const re = /secrets\.([A-Z][A-Z0-9_]*)/g;
  for (const file of files) {
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] === "GITHUB_TOKEN") continue;
      names.add(m[1]);
    }
  }
  return names;
}

describe("GitHub Actions secrets manifest", () => {
  it("manifest entries have name, purpose, whereCreated", () => {
    const manifest = loadManifest();
    expect(manifest.secrets.length).toBeGreaterThan(0);
    for (const row of manifest.secrets) {
      expect(row.name, "name").toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(row.purpose.trim().length, row.name).toBeGreaterThan(8);
      expect(row.whereCreated.trim().length, row.name).toBeGreaterThan(8);
    }
  });

  it("workflow secrets.* set equals manifest set", () => {
    const fromWorkflows = workflowSecretNames();
    const fromManifest = new Set(loadManifest().secrets.map((s) => s.name));
    const missingInManifest = [...fromWorkflows].filter((n) => !fromManifest.has(n));
    const extraInManifest = [...fromManifest].filter((n) => !fromWorkflows.has(n));
    expect(
      missingInManifest,
      `secrets referenced in workflows but missing from manifest: ${missingInManifest.join(", ")}`,
    ).toEqual([]);
    expect(
      extraInManifest,
      `manifest lists secrets not referenced in any workflow: ${extraInManifest.join(", ")}`,
    ).toEqual([]);
  });

  it("MUTATION: renaming a workflow secrets.* reference fails set equality", () => {
    const fromWorkflows = workflowSecretNames();
    expect(fromWorkflows.has("PROD_METERING_MASTER_SECRET")).toBe(true);
    // Simulate a drifted YAML rename without updating the manifest.
    const mutated = new Set(
      [...fromWorkflows].map((n) =>
        n === "PROD_METERING_MASTER_SECRET" ? "METERING_MASTER_SECRET_WRONG" : n,
      ),
    );
    const fromManifest = new Set(loadManifest().secrets.map((s) => s.name));
    const missingInManifest = [...mutated].filter((n) => !fromManifest.has(n));
    expect(missingInManifest).toContain("METERING_MASTER_SECRET_WRONG");
    expect(fromManifest.has("PROD_METERING_MASTER_SECRET")).toBe(true);
  });
});
