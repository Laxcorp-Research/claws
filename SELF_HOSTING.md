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
