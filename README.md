# Claws

[![CI](https://github.com/Laxcorp-Research/claws/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Laxcorp-Research/claws/actions/workflows/ci.yml)

Claws is an open-source multi-agent platform on OpenClaw — teams of agents with a manager, specialists, and a reviewer, any model via your own key, actions gated by your approval, running on your own machine.

## Quickstart

Requirements: Docker Engine with Compose.

```bash
git clone https://github.com/Laxcorp-Research/claws && cd claws
cp .env.example .env
docker compose up -d
```

The control plane is pulled, not built. Open http://localhost:3000 and create your owner account. Change `CLAWS_NEXTAUTH_SECRET`, `CLAWS_ENCRYPTION_MASTER_KEY` (64 hex characters), `POSTGRES_PASSWORD`, and `CLAWS_METERING_MASTER_SECRET` in `.env` before you expose the host. The rest of the bring-up is in [SELF_HOSTING.md](SELF_HOSTING.md).

## What's included

- 20 templates
- Telegram and webchat
- Files and approvals

## v1.1

- WhatsApp QR
- Template registry
- SMTP

## License

AGPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

`prisma/seed-data/` (templates and skills) is Apache-2.0. See `prisma/seed-data/LICENSE`.

## Security

Report a vulnerability through [GitHub private vulnerability reporting](https://github.com/Laxcorp-Research/claws/security/advisories/new). Do not open a public issue for a live credential. See [SECURITY.md](SECURITY.md).
