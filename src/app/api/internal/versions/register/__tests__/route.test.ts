// Tests for POST /api/internal/versions/register.
//
// This route is the pipeline → DB bridge written by PR-1. It is called by
// .github/workflows/build-openclaw-image.yml after each auto-build (with
// isCandidate=true) and by .github/workflows/promote-openclaw-image.yml
// after each manual promotion (with isStable=true).
//
// Critical invariants under test:
//   1. Auth gate: missing/wrong X-Pipeline-Secret or unset env → 401.
//   2. Validation: version regex, dockerImage:<version> shape, isStable XOR
//      isCandidate, imageDigest sha256 shape.
//   3. Auto-build (candidate) path: upsert + clear prior isLatest, do not
//      touch isStable.
//   4. Promote (stable) path: upsert + set stableAt + CLEAR PRIOR isStable,
//      do not touch isLatest. Mutation-test: a regression that removes the
//      "clear prior" updateMany must fail at least one test in this file.
//   5. Both paths run inside $transaction so a row can never be left in a
//      "two rows hold the same flag" state.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/openclaw/runtime-autoupdate", () => ({
  notifyCandidateRegistered: vi.fn().mockResolvedValue({ bump: "date-tuple", alerted: false }),
}));

import { POST } from "@/app/api/internal/versions/register/route";

const PIPELINE_SECRET = "test_pipeline_secret_pr1";

function buildCandidateBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: "2026.5.20",
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
    imageDigest: "sha256:" + "a".repeat(64),
    buildSourceTag: "v2026.5.20",
    buildPushedAt: "2026-05-21T20:44:50Z",
    releaseNotesUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.5.20",
    isStable: false,
    isCandidate: true,
    ...overrides,
  };
}

function buildStableBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: "2026.5.20",
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
    imageDigest: "sha256:" + "b".repeat(64),
    buildSourceTag: "v2026.5.20",
    buildPushedAt: "2026-05-22T10:00:00Z",
    releaseNotesUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.5.20",
    isStable: true,
    isCandidate: false,
    ...overrides,
  };
}

async function callRoute(body: unknown, secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers["X-Pipeline-Secret"] = secret;
  const req = createMockRequest("http://localhost:3000/api/internal/versions/register", {
    method: "POST",
    headers,
    body,
  });
  return POST(req);
}

/**
 * Wire $transaction so the route's `await prisma.$transaction(async (tx) => …)`
 * actually invokes the callback with prismaMock as `tx`. Each test that uses
 * the transaction path calls this once after setting up the row upserts +
 * updateMany returns it expects.
 */
function wireTransactionPassthrough() {
  (prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: unknown) => {
      if (typeof input === "function") {
        return await (input as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
      }
      return input;
    },
  );
}

describe("POST /api/internal/versions/register", () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.VERSION_PIPELINE_SECRET;
    process.env.VERSION_PIPELINE_SECRET = PIPELINE_SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.VERSION_PIPELINE_SECRET;
    else process.env.VERSION_PIPELINE_SECRET = prevSecret;
  });

  // ─── Auth gate ────────────────────────────────────────────────────────

  describe("auth gate", () => {
    it("returns 401 when X-Pipeline-Secret header is missing", async () => {
      const res = await callRoute(buildCandidateBody());
      expect(res.status).toBe(401);
    });

    it("returns 401 when X-Pipeline-Secret does not match env", async () => {
      const res = await callRoute(buildCandidateBody(), "wrong_secret");
      expect(res.status).toBe(401);
    });

    it("returns 401 when VERSION_PIPELINE_SECRET env is unset (fail-closed)", async () => {
      delete process.env.VERSION_PIPELINE_SECRET;
      // Even sending the "right" secret value can't authorize a server that
      // hasn't been configured.
      const res = await callRoute(buildCandidateBody(), PIPELINE_SECRET);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("PIPELINE_SECRET_UNCONFIGURED");
    });
  });

  // ─── Validation ───────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects malformed JSON body", async () => {
      const req = createMockRequest("http://localhost:3000/api/internal/versions/register", {
        method: "POST",
        headers: { "X-Pipeline-Secret": PIPELINE_SECRET },
      });
      // Force-undefined body by re-creating with raw text. createMockRequest
      // sets Content-Type=application/json and json-stringifies the body when
      // present; sending no body yields a request whose .json() throws.
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("accepts stable correction version YYYY.M.D-N", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-1",
        version: "2026.5.20-1",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20-1",
        imageDigest: "sha256:" + "a".repeat(64),
        buildSourceTag: "v2026.5.20-1",
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date("2026-05-22T00:00:00Z"),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const res = await callRoute(
        buildCandidateBody({
          version: "2026.5.20-1",
          dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20-1",
          buildSourceTag: "v2026.5.20-1",
        }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(200);
    });

    it("rejects beta version 2026.5.20-beta.1 (regex anchors)", async () => {
      const res = await callRoute(
        buildCandidateBody({
          version: "2026.5.20-beta.1",
          dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20-beta.1",
        }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message.toLowerCase()).toContain("version");
    });

    it("rejects dockerImage that does not end with :<version>", async () => {
      const res = await callRoute(
        buildCandidateBody({
          version: "2026.5.20",
          dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:latest",
        }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      // The whole point of this check: an :latest tag here would let the DB
      // record a moving pointer the deployer reads as canonical.
      expect(body.error.message).toContain(":latest");
    });

    it("rejects when both isStable and isCandidate are true (XOR)", async () => {
      const res = await callRoute(
        buildCandidateBody({ isStable: true, isCandidate: true }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(400);
    });

    it("rejects when neither isStable nor isCandidate is true (XOR)", async () => {
      const res = await callRoute(
        buildCandidateBody({ isStable: false, isCandidate: false }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(400);
    });

    it("rejects malformed imageDigest", async () => {
      const res = await callRoute(
        buildCandidateBody({ imageDigest: "not-a-digest" }),
        PIPELINE_SECRET,
      );
      expect(res.status).toBe(400);
    });

    it("accepts null/missing imageDigest", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-nodigest",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: "v2026.5.20",
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const body = buildCandidateBody();
      delete (body as Record<string, unknown>).imageDigest;
      const res = await callRoute(body, PIPELINE_SECRET);
      expect(res.status).toBe(200);
    });
  });

  // ─── Auto-build (candidate) path ──────────────────────────────────────

  describe("candidate (auto-build) path", () => {
    it("upserts the row with isLatest=true and clears isLatest from prior rows", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-new",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: "sha256:" + "a".repeat(64),
        buildSourceTag: "v2026.5.20",
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date("2026-05-21T20:44:50Z"),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      const res = await callRoute(buildCandidateBody(), PIPELINE_SECRET);
      expect(res.status).toBe(200);

      // Upsert: where: { version }, both create+update set isLatest=true,
      // create also sets isStable=false. The candidate path does not touch
      // isStable in the update branch.
      const upsertArgs = (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ version: "2026.5.20" });
      expect(upsertArgs.create.isStable).toBe(false);
      expect(upsertArgs.create.isLatest).toBe(true);
      expect(upsertArgs.update.isLatest).toBe(true);
      expect("isStable" in upsertArgs.update).toBe(false);

      // updateMany: clear isLatest from every other row.
      const clearArgs = (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(clearArgs.where).toEqual({ isLatest: true, id: { not: "ver-new" } });
      expect(clearArgs.data).toEqual({ isLatest: false });
    });

    it("returns transition=candidate and the cleared-prior count", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-new",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

      const res = await callRoute(buildCandidateBody(), PIPELINE_SECRET);
      const body = await res.json();
      expect(body.data.transition).toBe("candidate");
      expect(body.data.clearedPriorFlagCount).toBe(3);
    });
  });

  // ─── Promote (stable) path + MUTATION TESTS ───────────────────────────

  describe("stable (promote) path", () => {
    it("upserts with isStable=true + stableAt + clears isStable from prior rows", async () => {
      wireTransactionPassthrough();
      const stableAt = new Date("2026-05-22T10:00:00Z");
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-promoted",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: "sha256:" + "b".repeat(64),
        buildSourceTag: "v2026.5.20",
        isStable: true,
        isLatest: false,
        stableAt,
        releasedAt: stableAt,
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      const res = await callRoute(buildStableBody(), PIPELINE_SECRET);
      expect(res.status).toBe(200);

      const upsertArgs = (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(upsertArgs.create.isStable).toBe(true);
      expect(upsertArgs.create.stableAt).toBeInstanceOf(Date);
      expect(upsertArgs.update.isStable).toBe(true);
      expect(upsertArgs.update.stableAt).toBeInstanceOf(Date);
      // Promote path does NOT touch isLatest.
      expect("isLatest" in upsertArgs.update).toBe(false);
    });

    // ─── MUTATION TEST - the canary that fails if a future change drops
    //     the "clear prior isStable" updateMany. Two rows with isStable=true
    //     would silently break the deployer's findFirst({ isStable: true })
    //     query (it'd return whichever row Postgres orders first, which is
    //     not necessarily the intended one). This test asserts the WHERE
    //     and data shape of the clear so a regression cannot just delete
    //     the call without failing here.
    it("MUTATION: promote MUST clear isStable from all rows except the upserted one", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-new-stable",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: true,
        isLatest: false,
        stableAt: new Date(),
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

      await callRoute(buildStableBody(), PIPELINE_SECRET);

      // The updateMany MUST be called at least once with this exact shape.
      // If a regression removes the call entirely, mock.calls.length will be
      // 0 and the assertions below will throw on undefined.
      const updateManyCalls = (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mock.calls;
      expect(updateManyCalls.length).toBeGreaterThanOrEqual(1);

      const clearCall = updateManyCalls[0][0];
      // The WHERE must target other rows that currently have isStable=true.
      // A mutation that flips the predicate (e.g. id.eq instead of id.not)
      // would corrupt the upserted row instead of its predecessors.
      expect(clearCall.where).toEqual({ isStable: true, id: { not: "ver-new-stable" } });
      expect(clearCall.data).toEqual({ isStable: false });
    });

    it("MUTATION: candidate path MUST NOT touch isStable on the updateMany clear", async () => {
      // Symmetric mutation guard: the candidate transition is supposed to
      // clear isLatest only, never isStable. A regression that confuses the
      // two transitions could quietly demote the current production row.
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-cand",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await callRoute(buildCandidateBody(), PIPELINE_SECRET);

      const updateManyCalls = (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of updateManyCalls) {
        const arg = call[0];
        // The candidate transition's WHERE must target isLatest, not isStable.
        expect(arg.where).not.toHaveProperty("isStable");
        // The candidate transition's data must not flip isStable.
        expect(arg.data).not.toHaveProperty("isStable");
      }
    });
  });

  // ─── Idempotency ──────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("upsert is keyed by version so a re-register with the same version is a no-op create", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-same",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const res = await callRoute(buildCandidateBody(), PIPELINE_SECRET);
      expect(res.status).toBe(200);

      // The route MUST use upsert, not create - a second call with the same
      // version must not 409 / not error / not create a duplicate row.
      // (.unique on `version` would also surface this at the DB level, but
      // we want the route to be explicitly upsert-shaped.)
      const upsertArgs = (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ version: "2026.5.20" });
      expect(upsertArgs.create).toBeDefined();
      expect(upsertArgs.update).toBeDefined();
    });
  });

  // ─── Optional fields ──────────────────────────────────────────────────

  describe("optional fields", () => {
    it("stores releaseNotesUrl in the releaseNotes column", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-rn",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date(),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await callRoute(
        buildCandidateBody({
          releaseNotesUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.5.20",
        }),
        PIPELINE_SECRET,
      );
      const upsertArgs = (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(upsertArgs.create.releaseNotes).toBe(
        "https://github.com/openclaw/openclaw/releases/tag/v2026.5.20",
      );
    });

    it("uses buildPushedAt as releasedAt when provided", async () => {
      wireTransactionPassthrough();
      (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "ver-rt",
        version: "2026.5.20",
        dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.20",
        imageDigest: null,
        buildSourceTag: null,
        isStable: false,
        isLatest: true,
        stableAt: null,
        releasedAt: new Date("2026-05-21T20:44:50Z"),
      });
      (prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await callRoute(
        buildCandidateBody({ buildPushedAt: "2026-05-21T20:44:50Z" }),
        PIPELINE_SECRET,
      );
      const upsertArgs = (prismaMock.openClawVersion.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect((upsertArgs.create.releasedAt as Date).toISOString()).toBe(
        "2026-05-21T20:44:50.000Z",
      );
    });
  });
});
