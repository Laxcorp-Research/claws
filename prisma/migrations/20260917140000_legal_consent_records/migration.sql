-- Legal consent audit trail: signup ToS/Privacy checkbox, financial-template
-- section-8 acknowledgement, autonomous-mode section-8 consent. Additive
-- only. NO foreign keys on purpose: consent evidence must survive workspace
-- and user deletion (same audit-row rule as RailwayCreateLedger).

CREATE TYPE "ConsentKind" AS ENUM ('TOS_PRIVACY', 'FINANCIAL_AUTONOMY_S8', 'AUTONOMOUS_MODE_S8');

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "workspaceId" TEXT,
    "source" TEXT NOT NULL,
    "metadata" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentRecord_userId_kind_idx" ON "ConsentRecord"("userId", "kind");
CREATE INDEX "ConsentRecord_workspaceId_kind_idx" ON "ConsentRecord"("workspaceId", "kind");
