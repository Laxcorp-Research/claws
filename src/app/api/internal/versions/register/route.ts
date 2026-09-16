// PR-1: Image-pipeline → version-record bridge.
//
// Called by .github/workflows/build-openclaw-image.yml (auto-build path,
// isCandidate=true) and .github/workflows/promote-openclaw-image.yml
// (promote path, isStable=true) after each successful image push.
//
// Auth: shared X-Pipeline-Secret header against VERSION_PIPELINE_SECRET env.
// Same convention as /api/internal/state/upload (X-Metering-Secret).
//
// Flag policy (Option A - see PR-1 audit report):
//   - isCandidate=true  → set isLatest=true on this row, clear from all others.
//                         Do NOT touch isStable. (Existing semantics from
//                         admin/versions/create/route.ts.)
//   - isStable=true     → set isStable=true and stableAt=now() on this row,
//                         clear isStable from all others. Do NOT touch isLatest.
//                         (Existing semantics from admin/versions/[id]/promote/
//                         route.ts.)
//   - Both flags TRUE or both FALSE → 400. Each register call describes
//                         exactly one of the two state transitions.
//
// dockerImage must end with ":<version>" - never a moving pointer. The
// deployer reads OpenClawVersion.dockerImage for the current isStable row,
// so an `:latest`-tagged record here would silently un-pin every future
// deploy to whatever `:latest` happens to resolve to. Reject explicitly.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api/response";
import { log } from "@/lib/logger";
import { notifyCandidateRegistered } from "@/lib/openclaw/runtime-autoupdate";
import { deriveRuntimeContract } from "@/lib/openclaw/runtime-contract";

// Stable releases: 2026.5.20 (the common case).
// Stable corrections (upstream convention from openclaw/openclaw RELEASING.md):
// 2026.5.20-1, 2026.5.20-2. We accept both; we reject any pre-release suffix
// (beta.N / alpha.N / rc.N) because the auto-build pipeline filters them out
// at the GitHub Releases API step (prerelease==false) and a beta arriving here
// would mean something upstream of us is broken.
const VERSION_RE = /^\d{4}\.\d+\.\d+(-\d+)?$/;

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

interface RegisterBody {
  version?: unknown;
  dockerImage?: unknown;
  imageDigest?: unknown;
  isStable?: unknown;
  isCandidate?: unknown;
  buildSourceTag?: unknown;
  buildPushedAt?: unknown;
  releaseNotesUrl?: unknown;
}

export async function POST(req: NextRequest) {
  // ─── Auth ─────────────────────────────────────────────────────────────
  const expected = process.env.VERSION_PIPELINE_SECRET;
  if (!expected) {
    // Fail-closed: an unset env var must not collapse into "any header passes"
    // (req.headers.get returns null, and null !== undefined would 401 by
    // accident; we still want this loud so deploy-misconfig surfaces).
    log.error("VERSION_PIPELINE_SECRET not configured; rejecting register call");
    return apiError("PIPELINE_SECRET_UNCONFIGURED", "Pipeline secret not configured on this deployment", 401);
  }
  if (req.headers.get("X-Pipeline-Secret") !== expected) {
    return apiError("UNAUTHORIZED", "Invalid pipeline secret", 401);
  }

  // ─── Parse + validate ─────────────────────────────────────────────────
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return apiError("VALIDATION_ERROR", "Request body must be JSON", 400);
  }

  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!VERSION_RE.test(version)) {
    return apiError(
      "VALIDATION_ERROR",
      `version must match ${VERSION_RE.source} (e.g. "2026.5.20" or "2026.5.20-1")`,
      400,
    );
  }

  const dockerImage = typeof body.dockerImage === "string" ? body.dockerImage.trim() : "";
  if (!dockerImage) {
    return apiError("VALIDATION_ERROR", "dockerImage is required", 400);
  }
  // Reject moving pointers - see header comment.
  if (!dockerImage.endsWith(`:${version}`)) {
    return apiError(
      "VALIDATION_ERROR",
      `dockerImage must end with ":${version}" (not a moving pointer like :latest or :candidate)`,
      400,
    );
  }

  if (typeof body.isStable !== "boolean" || typeof body.isCandidate !== "boolean") {
    return apiError("VALIDATION_ERROR", "isStable and isCandidate must be booleans", 400);
  }
  // XOR: exactly one of the two transitions per call.
  if (body.isStable === body.isCandidate) {
    return apiError(
      "VALIDATION_ERROR",
      "Exactly one of isStable / isCandidate must be true (each register call describes one transition)",
      400,
    );
  }

  let imageDigest: string | null = null;
  if (body.imageDigest != null) {
    if (typeof body.imageDigest !== "string" || !DIGEST_RE.test(body.imageDigest)) {
      return apiError("VALIDATION_ERROR", `imageDigest must match ${DIGEST_RE.source}`, 400);
    }
    imageDigest = body.imageDigest;
  }

  const buildSourceTag =
    typeof body.buildSourceTag === "string" && body.buildSourceTag.trim()
      ? body.buildSourceTag.trim()
      : null;

  let releasedAt: Date;
  if (body.buildPushedAt != null) {
    if (typeof body.buildPushedAt !== "string") {
      return apiError("VALIDATION_ERROR", "buildPushedAt must be an ISO datetime string", 400);
    }
    const parsed = new Date(body.buildPushedAt);
    if (Number.isNaN(parsed.getTime())) {
      return apiError("VALIDATION_ERROR", "buildPushedAt is not a valid ISO datetime", 400);
    }
    releasedAt = parsed;
  } else {
    releasedAt = new Date();
  }

  const releaseNotes =
    typeof body.releaseNotesUrl === "string" && body.releaseNotesUrl.trim()
      ? body.releaseNotesUrl.trim()
      : null;

  // Version-keyed emission contract - a property of the OpenClawVersion row.
  // VERSION_RE already passed, so derivation cannot throw here.
  const runtimeContract = deriveRuntimeContract(version);

  // ─── Apply transition transactionally ─────────────────────────────────
  // Both branches use the same pattern: upsert by version, then atomically
  // clear the relevant flag from all other rows. Wrapped in $transaction so
  // a row can never be left in a state where two rows hold the same flag.

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (body.isStable) {
        const upserted = await tx.openClawVersion.upsert({
          where: { version },
          create: {
            version,
            dockerImage,
            imageDigest,
            buildSourceTag,
            releaseNotes,
            isStable: true,
            isLatest: false,
            stableAt: new Date(),
            releasedAt,
            runtimeContract,
          },
          update: {
            dockerImage,
            imageDigest,
            buildSourceTag,
            releaseNotes,
            isStable: true,
            stableAt: new Date(),
            runtimeContract,
            // releasedAt is set on create; do not move it on idempotent re-register
          },
        });
        const cleared = await tx.openClawVersion.updateMany({
          where: { isStable: true, id: { not: upserted.id } },
          data: { isStable: false },
        });
        return { row: upserted, transition: "promote" as const, clearedCount: cleared.count };
      } else {
        // isCandidate path
        const upserted = await tx.openClawVersion.upsert({
          where: { version },
          create: {
            version,
            dockerImage,
            imageDigest,
            buildSourceTag,
            releaseNotes,
            isStable: false,
            isLatest: true,
            releasedAt,
            runtimeContract,
          },
          update: {
            dockerImage,
            imageDigest,
            buildSourceTag,
            releaseNotes,
            isLatest: true,
            runtimeContract,
          },
        });
        const cleared = await tx.openClawVersion.updateMany({
          where: { isLatest: true, id: { not: upserted.id } },
          data: { isLatest: false },
        });
        return { row: upserted, transition: "candidate" as const, clearedCount: cleared.count };
      }
    });

    log.info("OpenClawVersion register", {
      version: result.row.version,
      transition: result.transition,
      dockerImage: result.row.dockerImage,
      imageDigest: result.row.imageDigest,
      buildSourceTag: result.row.buildSourceTag,
      runtimeContract: result.row.runtimeContract,
      clearedPriorFlagCount: result.clearedCount,
    });

    if (result.transition === "candidate") {
      await notifyCandidateRegistered({
        id: result.row.id,
        version: result.row.version,
        buildSourceTag: result.row.buildSourceTag,
      }).catch((err) => {
        log.warn("runtime-autoupdate: candidate alert failed", {
          version: result.row.version,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return apiSuccess({
      id: result.row.id,
      version: result.row.version,
      dockerImage: result.row.dockerImage,
      imageDigest: result.row.imageDigest,
      buildSourceTag: result.row.buildSourceTag,
      isStable: result.row.isStable,
      isLatest: result.row.isLatest,
      stableAt: result.row.stableAt,
      releasedAt: result.row.releasedAt,
      runtimeContract: result.row.runtimeContract,
      transition: result.transition,
      clearedPriorFlagCount: result.clearedCount,
    });
  } catch (err) {
    log.error("OpenClawVersion register failed", {
      version,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("INTERNAL_ERROR", "Failed to register version", 500);
  }
}
