ALTER TABLE "ToolConnection"
ADD COLUMN "lastConnectionCheckAt" TIMESTAMP(3),
ADD COLUMN "lastConnectionCheckResult" TEXT;
