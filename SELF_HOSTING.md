# Self-hosting Claws

`CLAWS_PROFILE=self-host` runs the control plane on a machine you control. Hosted billing, the credit pool, Railway, Fly, Vercel cron, Composio, Resend, Sentry, Axiom, and Upstash stay off. A request to one of those modules returns 404 with `HOSTED_ONLY`.

## What you get

- Postgres and the Next.js control plane via `docker compose`
- A Docker provider behind `deployer.ts`. It talks to the engine socket. Nap stops the container and keeps the named volume. Wake starts the same container. `CLAWS_DOCKER_PUBLISH=host` publishes the gateway port. `CLAWS_DOCKER_PUBLISH=proxy` leaves the port unpublished and the control plane dials `CLAWS_DOCKER_PROXY_HOST`
- Telegram `getUpdates` long-polling (`src/lib/channels/telegram-poll.ts`) instead of a public webhook
- Runtime snapshots written under `CLAWS_SNAPSHOT_DIR` as well as Postgres
- One owner account. Open http://localhost:3000 and create your owner account. Later sign-ins use that email and password.

## Install

Requirements: Docker Engine with Compose. Nothing is built on your machine.

```bash
git clone https://github.com/Laxcorp-Research/claws && cd claws
cp .env.example .env
docker compose up -d
```

That pulls `ghcr.io/laxcorp-research/claws:latest`, `ghcr.io/laxcorp-research/openclaw-runtime` at `RUNTIME_IMAGE_TAG` (shipped as `2026.9.4-5`), `postgres:16`, and `redis:7`, then starts them. The runtime pull is a one-shot Compose service, so the image is on the machine before the app accepts a deploy. The app listens on http://localhost:3000 when its healthcheck passes (`GET /api/health`).

Open http://localhost:3000 and create your owner account.

Before you expose the host, change these values in `.env`:

- `CLAWS_NEXTAUTH_SECRET`
- `CLAWS_ENCRYPTION_MASTER_KEY` (64 hex characters)
- `POSTGRES_PASSWORD`
- `CLAWS_METERING_MASTER_SECRET`

`RUNTIME_IMAGE_TAG` is the OpenClaw runtime the control plane boots. The shipped value is `2026.9.4-5`. Compose and the app both read that variable. Paste your model key in settings. A key that starts with `fixture-` is stored without calling the vendor.

`CLAWS_DOCKER_NETWORK` must be the Compose network name (`claws` in the shipped file) so the control plane can reach a container by its Docker DNS name.

## Behind a corporate proxy

Image pull uses Docker's own certificate store. Model calls use the app container. If setup says the network intercepts HTTPS, or `/api/health` reports `outbound.anthropic: "tls_intercepted"`, export the interception root and put the PEM in `./certs`. Compose mounts that directory read-only, and the entrypoint builds `/certs/bundle.pem` for Node.

Windows:

1. Press Win+R, run `certmgr.msc`, and open Trusted Root Certification Authorities, then Certificates.
2. Find the proxy or antivirus root, the issuer named on the browser certificate warning.
3. Right-click it, choose All Tasks, then Export, and select Base-64 encoded X.509 (.CER).
4. Save the file into the repo `certs` folder and rename it so the name ends in `.pem`.
5. Run `docker compose restart`. The app and each new Claw container load `./certs/*.pem`.

macOS:

1. Open Keychain Access and select System or login, then Certificates.
2. Find the proxy or antivirus root certificate.
3. Select it and choose File, then Export Items.
4. If the export is `.cer`, rename it so the name ends in `.pem` and move it into `certs`.
5. Run `docker compose restart`.

Linux:

1. The interception root is usually a file under `/etc/ssl/certs` or `/usr/local/share/ca-certificates`.
2. Copy that file into the repo `certs` folder.
3. The file must be PEM text and start with `-----BEGIN CERTIFICATE-----`.
4. Name it with a `.pem` suffix.
5. Run `docker compose restart`.

`GET /api/health` includes `outbound.anthropic` as `ok`, `tls_intercepted`, or `unreachable` so this shows up before you paste a key.

To put a reverse proxy in front of gateways instead of publishing ports:

```yaml
CLAWS_DOCKER_PUBLISH: proxy
CLAWS_DOCKER_PROXY_HOST: gateway.internal:443
```

The proxy must route that host to `<container-name>:18789` on the `claws` network.

## First run

Open http://localhost:3000 and create your owner account. The password needs at least 12 characters. You land on the store signed in.

1. Install a template (the proof uses Twitter/X Growth Machine, slug `twitter-growth-machine`).
2. Paste model and tool credentials. Values that start with `fixture-` are stored without a live provider call. Real keys are checked the same way as hosted.
3. Deploy. Nap and wake stop and start the container.

## Proof

Contributors build locally. The default compose file has no `build` key.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile fixture build
CLAWS_DOCKER_IMAGE=claws-fixture-gateway:proof docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
node scripts/self-host-proof.mjs
```

The script creates the owner, installs Twitter/X, stores a fixture model key and a fixture Twitter credential, deploys, checks the chat reply, naps, wakes, and confirms `POST /api/dodo-payments/checkout` is 404. The fixture image answers chat with the fixed text `fixture-reply`.

## Real Anthropic key

After the quickstart is up, open http://localhost:3000 and create your owner account. Install Twitter/X Growth Machine, paste your Anthropic key and tool key in settings, and deploy. Do not write the keys into `docker-compose.yml`, `.env`, or any file that gets committed.

`ghcr.io/laxcorp-research/claws` and `ghcr.io/laxcorp-research/openclaw-runtime` are public, so `docker compose pull` does not need a registry login.

To run the contributor proof against the fixture instead, build `docker-compose.dev.yml` and set `CLAWS_DOCKER_IMAGE=claws-fixture-gateway:proof`.

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
