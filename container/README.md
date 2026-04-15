# Claws Container Files

These files are baked into the custom OpenClaw Docker image at build time.

## Files

- **process-manager.mjs** — Container entrypoint. Manages the credit proxy and OpenClaw gateway as child processes. Handles signal forwarding, proxy auto-restart, and graceful shutdown.
- **credit-proxy.mjs** — HTTP proxy on port 3789 (localhost only). Intercepts Anthropic API calls for credit users, meters usage, reports in batches to the platform.

## How it works

When `CLAWS_CREDIT_MODE=true`:
1. process-manager starts credit-proxy on port 3789
2. process-manager waits for proxy health check
3. process-manager starts OpenClaw gateway
4. OpenClaw uses `ANTHROPIC_BASE_URL=http://localhost:3789` (set by deployer)
5. All API calls route through proxy → metered → forwarded to real Anthropic

When `CLAWS_CREDIT_MODE=false` (own-key users):
1. process-manager skips credit-proxy entirely
2. process-manager starts OpenClaw gateway directly
3. OpenClaw calls Anthropic directly using user's own key

## Building

These files are copied into the Docker image via the Dockerfile:

```dockerfile
COPY container/process-manager.mjs /usr/local/bin/process-manager.mjs
COPY container/credit-proxy.mjs /usr/local/bin/credit-proxy.mjs
CMD ["node", "/usr/local/bin/process-manager.mjs"]
```

## Environment Variables (credit mode)

| Variable | Description |
|----------|-------------|
| CLAWS_CREDIT_MODE | `true` to enable proxy, `false` to skip |
| CLAWS_WORKSPACE_ID | Workspace ID for usage attribution |
| CLAWS_USER_ID | User ID for credit balance lookups |
| CLAWS_METERING_ENDPOINT | Platform metering API URL |
| CLAWS_METERING_SECRET | Auth secret for metering API |
| ANTHROPIC_API_KEY | Platform master key (used by proxy to call Anthropic) |
| ANTHROPIC_BASE_URL | Set to `http://localhost:3789` by deployer |
