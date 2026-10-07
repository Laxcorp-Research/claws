# Claws

Open multi-agent platform. Bring any model. Run it on your infrastructure.

Claws is a control plane for teams of AI agents: a visual builder, a marketplace of templates and skills, and a runtime that talks to Telegram, WhatsApp, and other channels. The hosted product at [buildclaws.ai](https://buildclaws.ai) adds billing, a shared credit pool, and managed containers. The code in this repository is what you run yourself.

## What is in this repo

- Next.js control plane (builder, settings, marketplace, crons)
- Prisma schema and template/skill seed data
- The container contract the runtime image is expected to honor

## What stays hosted-only

These modules assume Laxcorp's accounts and are not part of a self-host bring-up. Gate them with `CLAWS_PROFILE=self-host` when that profile lands (Phase A is sized, not built):

- Dodo Payments checkout, webhooks, and creator payouts
- The shared credit pool, metering master secret, and credit-proxy
- Railway project governor and the retired service-pool refill
- Fly Machines (track cancelled; flags are ignored)
- Vercel cron fan-out and the GitHub Actions image-promote pipeline
- Composio broker, Resend, Sentry, Axiom, Upstash as configured for the hosted app

Self-host Phase A (not in this tree yet): a local Docker provider behind `deployer.ts` (socket, stop/start, volumes, ports and a reverse proxy), Telegram long-polling and WhatsApp QR without a public URL, snapshots on disk, SMTP, a first-run owner account, and a registry-mode marketplace (index JSON, publish by pull request).

## License

AGPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

`prisma/seed-data/` (templates and skills) is Apache-2.0. See `prisma/seed-data/LICENSE`.

## Security

See [SECURITY.md](SECURITY.md). Do not open a public issue for a live credential.
