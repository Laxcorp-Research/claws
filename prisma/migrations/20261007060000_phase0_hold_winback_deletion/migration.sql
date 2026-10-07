-- Phase 0: on_hold cap clock, day-7 win-back stamp, account-deletion grace.
-- IF NOT EXISTS: production columns were added out of band on 2026-10-07
-- so win-back stamps could land before this migration deployed.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionOnHoldAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialWinbackSentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
