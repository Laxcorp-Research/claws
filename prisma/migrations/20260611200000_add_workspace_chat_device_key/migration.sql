-- PR-9/A-vercel: encrypted Ed25519 device identity for the dashboard chat
-- send endpoint.
--
-- Purely additive + nullable, no backfill (the key is generated LAZILY on a
-- workspace's first chat send ? NULL means "never chatted"). Value is an
-- AES-256-GCM blob (same encryption.ts pipeline as Workspace.gatewayToken)
-- containing {deviceId, publicKeyRawB64u, privateKeyPem}. Remote gateway
-- clients without a device identity get their requested scopes CLEARED by
-- OpenClaw (docs/OPENCLAW_GATEWAY_PROTOCOL.md section 3), so the send
-- endpoint must present one. Reversible (DROP COLUMN). No index ? the
-- column is only ever read via the workspace primary key.
-- See src/app/api/workspaces/[id]/chat/route.ts and
-- src/lib/openclaw/device-identity.ts.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "chatDeviceKeyEncrypted" TEXT;
