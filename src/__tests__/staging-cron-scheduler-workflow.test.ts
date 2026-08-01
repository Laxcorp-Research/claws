/**
 * Contract tests for staging-cron-scheduler.yml.
 *
 * Routes listed in the workflow must match vercel.json crons exactly
 * (mutation: remove a route → fail). No GitHub network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const WORKFLOW_PATH = resolve(ROOT, ".github/workflows/staging-cron-scheduler.yml");
const VERCEL_JSON_PATH = resolve(ROOT, "vercel.json");

type VercelCron = { path: string; schedule: string };

function loadWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

function loadVercelCrons(): VercelCron[] {
  const raw = JSON.parse(readFileSync(VERCEL_JSON_PATH, "utf8")) as {
    crons: VercelCron[];
  };
  return raw.crons;
}

/** Extract quoted /api/... paths from the workflow (STAGING_CRON_ROUTES_ASSERT region). */
function extractWorkflowRoutes(yml: string): string[] {
  const matches = yml.matchAll(/"(\/api\/[^"]+)"/g);
  const paths = [...matches].map((m) => m[1]);
  return [...new Set(paths)].sort();
}

describe("staging-cron-scheduler.yml contract", () => {
  it("lists every vercel.json cron path exactly once in the workflow", () => {
    const yml = loadWorkflow();
    const vercelPaths = loadVercelCrons()
      .map((c) => c.path)
      .sort();
    const workflowPaths = extractWorkflowRoutes(yml);

    expect(workflowPaths, "workflow routes vs vercel.json").toEqual(vercelPaths);
    // Anchor so a casual delete of the assert comment still trips reviews.
    expect(yml).toContain("STAGING_CRON_ROUTES_ASSERT");
  });

  it("MUTATION: removing any vercel.json route from the workflow fails the equality check", () => {
    const yml = loadWorkflow();
    const vercelPaths = loadVercelCrons().map((c) => c.path);
    expect(vercelPaths.length).toBeGreaterThan(0);

    for (const victim of vercelPaths) {
      const mutated = yml.replaceAll(`"${victim}"`, `"${victim}-REMOVED"`);
      const mutatedRoutes = extractWorkflowRoutes(mutated);
      expect(
        mutatedRoutes,
        `mutation should drop ${victim}`,
      ).not.toEqual([...vercelPaths].sort());
      expect(mutatedRoutes.includes(victim)).toBe(false);
    }
  });

  it("documents hibernation */5 accepted delta and concurrency guard", () => {
    const yml = loadWorkflow();
    expect(yml).toContain("group: staging-cron-scheduler");
    expect(yml).toContain("cancel-in-progress: false");
    expect(yml).toContain("STAGING_CRON_SECRET");
    expect(yml).toContain("staging.app.buildclaws.ai");
    // Hibernation: vercel every-minute is not reproducible on Actions.
    expect(yml).toMatch(/hibernation[\s\S]*\*\/5/);
    expect(yml).toContain("accepted delta");
  });

  it("mirrors vercel.json schedule expressions where Actions can (quotes for operators)", () => {
    const crons = loadVercelCrons();
    const byPath = Object.fromEntries(crons.map((c) => [c.path, c.schedule]));

    expect(byPath["/api/admin/payouts/release"]).toBe("0 0 * * *");
    expect(byPath["/api/cron/reconcile-credit-balances"]).toBe("*/5 * * * *");
    expect(byPath["/api/cron/reconcile-container-env"]).toBe("*/5 * * * *");
    expect(byPath["/api/cron/aggregate-credit-usage"]).toBe("0 2 * * *");
    expect(byPath["/api/cron/credit-pool-monitor"]).toBe("0 * * * *");
    expect(byPath["/api/cron/hibernation"]).toBe("* * * * *");
    expect(byPath["/api/cron/health-monitor"]).toBe("*/2 * * * *");
    expect(byPath["/api/cron/connection-health"]).toBe("0 * * * *");
    expect(byPath["/api/cron/enforce-trial-expiry"]).toBe("0 * * * *");
    expect(byPath["/api/cron/daily-digest"]).toBe("0 6 * * *");

    const yml = loadWorkflow();
    expect(yml).toContain('cron: "0 0 * * *"');
    expect(yml).toContain('cron: "*/5 * * * *"');
    expect(yml).toContain('cron: "0 2 * * *"');
    expect(yml).toContain('cron: "0 * * * *"');
    // daily-digest UTC-06 schedule lives in staging-daily-digest.yml only.
    const scheduleCrons = [...yml.matchAll(/^\s+- cron: "([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(scheduleCrons).not.toContain("0 6 * * *");
  });
});
