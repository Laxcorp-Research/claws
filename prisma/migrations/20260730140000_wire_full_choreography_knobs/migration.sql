-- WIRE-FULL PR-1: choreography knobs + edge contextNote.
-- Wave ACK required on promote (ACK-MIGRATIONS).

CREATE TYPE "DeliveryMode" AS ENUM ('APPROVAL_REQUIRED', 'AUTO_PROCEED');

ALTER TABLE "Workspace"
  ADD COLUMN "maxRevisionRounds" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "deliveryMode" "DeliveryMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED';

ALTER TABLE "AgentConnection"
  ADD COLUMN "contextNote" TEXT;
