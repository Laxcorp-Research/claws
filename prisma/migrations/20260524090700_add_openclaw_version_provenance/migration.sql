-- PR-1: Add provenance fields to OpenClawVersion so version records can carry
-- the immutable image digest and the upstream tag they were built from.
--
-- The image pipeline (.github/workflows/build-openclaw-image.yml +
-- promote-openclaw-image.yml) POSTs to /api/internal/versions/register and
-- writes these fields. Existing rows pre-date the pipeline and have NULL for
-- both - no backfill, both columns are nullable. No indexes (these are
-- audit/provenance fields, not query keys).

-- AlterTable
ALTER TABLE "OpenClawVersion" ADD COLUMN     "imageDigest" TEXT,
ADD COLUMN     "buildSourceTag" TEXT;
