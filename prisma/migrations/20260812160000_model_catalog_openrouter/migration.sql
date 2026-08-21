-- OpenRouter arc: dynamic model registry (OPENROUTER already in ApiProvider enum - no enum migrate).

CREATE TABLE IF NOT EXISTS "ModelCatalogEntry" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contextLength" INTEGER,
    "pricingSnippet" TEXT,
    "costPer1kEst" DOUBLE PRECISION,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "rawMeta" JSONB,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelCatalogEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModelCatalogEntry_modelId_key" ON "ModelCatalogEntry"("modelId");
CREATE INDEX IF NOT EXISTS "ModelCatalogEntry_provider_idx" ON "ModelCatalogEntry"("provider");
CREATE INDEX IF NOT EXISTS "ModelCatalogEntry_isPinned_isActive_idx" ON "ModelCatalogEntry"("isPinned", "isActive");
CREATE INDEX IF NOT EXISTS "ModelCatalogEntry_displayName_idx" ON "ModelCatalogEntry"("displayName");
