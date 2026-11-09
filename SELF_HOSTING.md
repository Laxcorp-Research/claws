# Self-hosting Claws

`CLAWS_PROFILE=self-host` runs the control plane on a machine you control. Hosted billing, the credit pool, Railway, Fly, Vercel cron, Composio, Resend, Sentry, Axiom, and Upstash stay off. A request to one of those modules returns 404 with `HOSTED_ONLY`.

## What you get

- Postgres and the Next.js control plane via `docker compose`
- A Docker provider behind `deployer.ts`. It talks to the engine socket. Nap stops the container and keeps the named volume. Wake starts the same container. `CLAWS_DOCKER_PUBLISH=host` publishes the gateway port. `CLAWS_DOCKER_PUBLISH=proxy` leaves the port unpublished and the control plane dials `CLAWS_DOCKER_PROXY_HOST`
- Telegram `getUpdates` long-polling (`src/lib/channels/telegram-poll.ts`) instead of a public webhook
- Runtime snapshots written under `CLAWS_SNAPSHOT_DIR` as well as Postgres
- One owner account, created on the first `POST /api/setup/owner`. Later calls return 409. Sign in with that email and password

## Install

Requirements: Docker Engine with Compose. Nothing is built on your machine.

```bash
git clone https://github.com/Laxcorp-Research/claws && cd claws
cp .env.example .env
docker compose up -d
```

That pulls `ghcr.io/laxcorp-research/claws:latest`, `ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-18`, `postgres:16`, and `redis:7`, then starts them. The app listens on http://localhost:3000 when its healthcheck passes (`GET /api/health`).

Before you expose the host, change these values in `.env`:

- `CLAWS_NEXTAUTH_SECRET`
- `CLAWS_ENCRYPTION_MASTER_KEY` (64 hex characters)
- `POSTGRES_PASSWORD`
- `CLAWS_METERING_MASTER_SECRET`

`CLAWS_DOCKER_IMAGE` is the OpenClaw runtime the control plane boots. The shipped value is the stable tag `2026.5.22-18`. Paste your model key in settings. A key that starts with `fixture-` is stored without calling the vendor.

`CLAWS_DOCKER_NETWORK` must be the Compose network name (`claws` in the shipped file) so the control plane can reach a container by its Docker DNS name.

## Behind a corporate proxy

The quickstart only pulls images, so the registry certificate that matters is the one Docker uses, not a toolchain inside an image build. In Docker Desktop, set the HTTP proxy and install your corporate CA under Settings → Resources → Proxies and Settings → Docker Engine (or the Desktop certificate store), then run `docker compose pull` again.

To put a reverse proxy in front of gateways instead of publishing ports:

```yaml
CLAWS_DOCKER_PUBLISH: proxy
CLAWS_DOCKER_PROXY_HOST: gateway.internal:443
```

The proxy must route that host to `<container-name>:18789` on the `claws` network.

## First run

1. `POST /api/setup/owner` with `{ "email", "password", "name" }`. Password is 8–200 characters. This works once.
2. Sign in at `/auth/signin` with that email and password.
3. Install a template (the proof uses Twitter/X Growth Machine, slug `twitter-growth-machine`).
4. Paste model and tool credentials. Values that start with `fixture-` are stored without a live provider call. Real keys are checked the same way as hosted.
5. Deploy. Nap and wake stop and start the container.

## Proof

Contributors build locally. The default compose file has no `build` key.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile fixture build
CLAWS_DOCKER_IMAGE=claws-fixture-gateway:proof docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
node scripts/self-host-proof.mjs
```

The script creates the owner, installs Twitter/X, stores a fixture model key and a fixture Twitter credential, deploys, checks the chat reply, naps, wakes, and confirms `POST /api/dodo-payments/checkout` is 404. The fixture image answers chat with the fixed text `fixture-reply`.

## Real Anthropic key (Docker Desktop on Windows)

This path calls Anthropic. Docker Desktop must be running with Linux containers. From PowerShell at the repo root, after the quickstart is up:

```powershell
$env:CLAWS_OWNER_PASSWORD = "<8-200 characters, this shell only>"
$env:ANTHROPIC_API_KEY = "<your Anthropic key, this shell only>"
$env:TWITTER_API_KEY = "<twitter-api key, this shell only>"
docker compose exec -T -e ANTHROPIC_API_KEY -e TWITTER_API_KEY -e CLAWS_OWNER_PASSWORD app node scripts/self-host-real-anthropic.mjs
```

`ghcr.io/laxcorp-research/claws` and `ghcr.io/laxcorp-research/openclaw-runtime` are public, so `docker compose pull` does not need a registry login. Do not write the keys into `docker-compose.yml`, `.env`, or any file that gets committed. The script refuses a `fixture-` key and refuses `CLAWS_DOCKER_IMAGE` when it contains `fixture-gateway`. A successful run prints a `chat` receipt whose `replyText` is the model sentence, not `fixture-reply`.

To run that proof against the fixture instead, build `docker-compose.dev.yml` and set `CLAWS_DOCKER_IMAGE=claws-fixture-gateway:proof`.

Telegram polling is covered by unit tests. Start a poller in a self-host process with `runTelegramLongPoll` from `src/lib/channels/telegram-poll.ts` when you have a bot token. Do not set a webhook.

## Hosted-only

These stay unavailable while `CLAWS_PROFILE=self-host`:

- Dodo Payments checkout, webhooks, and creator payouts
- The shared credit pool, metering, and credit-proxy
- Railway governor and the service pool
- Fly Machines
- Vercel cron fan-out and the GHCR promote register
- Composio broker routes (OAuth and BYOK). Direct API-key tools still save
- Resend, Sentry, Axiom, Upstash
