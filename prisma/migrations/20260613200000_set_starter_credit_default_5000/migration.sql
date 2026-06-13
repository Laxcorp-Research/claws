-- fix(credits): set CreditAccount starter-credit column defaults to 5000c ($50).
--
-- Locked product decision: $50 one-time signup credit (was $25/2500c default).
-- Single source of truth is STARTER_CREDIT_CENTS in src/lib/credits/constants.ts;
-- grantStarterCredits always writes balanceCents/initialGrantCents EXPLICITLY, so
-- this @default is only a safety net for direct inserts that omit the columns.
--
-- FORWARD-ONLY / NON-DESTRUCTIVE: changing a column DEFAULT affects ONLY future
-- INSERTs that omit the column. It does NOT touch existing rows. Existing
-- CreditAccounts (staging: one 2500c real grant + one 500c WIRE-TEST fixture;
-- production: none) keep their stored balances. No backfill, no re-grant.
-- Reversible: re-run with DEFAULT 2500.
--
-- SQL form matches `prisma migrate diff ... --script` output for a default change.

-- AlterTable
ALTER TABLE "CreditAccount" ALTER COLUMN "initialGrantCents" SET DEFAULT 5000,
ALTER COLUMN "balanceCents" SET DEFAULT 5000;
