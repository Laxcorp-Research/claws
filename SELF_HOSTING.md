# Self-hosting Claws

`CLAWS_PROFILE=self-host` runs the control plane on a machine you control. Hosted billing, the credit pool, Railway, Fly, Vercel cron, Composio, Resend, Sentry, Axiom, and Upstash stay off. A request to one of those modules returns 404 with `HOSTED_ONLY`.

## What you get

- Postgres and the Next.js control plane via `docker compose`
- A Docker provider behind `deployer.ts`. It talks to the engine socket. Nap stops the container and keeps the named volume. Wake starts the same container. `CLAWS_DOCKER_PUBLISH=host` publishes the gateway port. `CLAWS_DOCKER_PUBLISH=proxy` leaves the port unpublished and the control plane dials `CLAWS_DOCKER_PROXY_HOST`
- Telegram `getUpdates` long-polling (`src/lib/channels/telegram-poll.ts`) instead of a public webhook
- Runtime snapshots written under `CLAWS_SNAPSHOT_DIR` as well as Postgres
- One owner account, created on the first `POST /api/setup/owner`. Later calls return 409. Sign in with that email and password

## Install

Requirements: Docker Engine with Compose, and a runtime image.

```bash
bash scripts/self-host-install.sh
```

That builds the fixture gateway used by the proof (`claws-fixture-gateway:proof`) and runs `docker compose up -d --build`. The app listens on http://localhost:3000.

Before you expose the host, change these values in `docker-compose.yml`:

- `NEXTAUTH_SECRET`
- `ENCRYPTION_MASTER_KEY` (64 hex characters)
- `POSTGRES_PASSWORD` and the matching `DATABASE_URL`
- `METERING_MASTER_SECRET`

Point `CLAWS_DOCKER_IMAGE` at the OpenClaw runtime image you want to boot. The fixture image only speaks the gateway WebSocket protocol and answers chat with the fixed text `fixture-reply`. It does not call a model vendor. A real runtime image uses the model key you paste in settings.

`CLAWS_DOCKER_NETWORK` must be the Compose network name (`claws` in the shipped file) so the control plane can reach a container by its Docker DNS name.

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

On a machine with Docker:

```bash
bash scripts/self-host-install.sh
node scripts/self-host-proof.mjs
```

The script creates the owner, installs Twitter/X, stores a fixture model key and a fixture Twitter credential, deploys, checks the chat reply, naps, wakes, and confirms `POST /api/dodo-payments/checkout` is 404.

## Real Anthropic key (Docker Desktop on Windows)

This path calls Anthropic. It does not use the fixture image or a `fixture-` key. Docker Desktop must be running with Linux containers. From PowerShell at the repo root:

```powershell
$env:CLAWS_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:latest"
docker pull $env:CLAWS_DOCKER_IMAGE
docker compose up -d --build
$env:CLAWS_OWNER_PASSWORD = "<8-200 characters, this shell only>"
$env:ANTHROPIC_API_KEY = "<your Anthropic key, this shell only>"
$env:TWITTER_API_KEY = "<twitter-api key, this shell only>"
docker compose exec -T -e ANTHROPIC_API_KEY -e TWITTER_API_KEY -e CLAWS_OWNER_PASSWORD app node scripts/self-host-real-anthropic.mjs
```

The runtime image on ghcr.io is public, so `docker pull` does not need a registry login. Do not write the keys into `docker-compose.yml` or a file that gets committed. The script refuses a `fixture-` key and refuses `CLAWS_DOCKER_IMAGE` when it contains `fixture-gateway`. A successful run prints a `chat` receipt whose `replyText` is the model sentence, not `fixture-reply`.

Unset `CLAWS_DOCKER_IMAGE` before the fixture proof. Compose then falls back to `claws-fixture-gateway:proof`.

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
