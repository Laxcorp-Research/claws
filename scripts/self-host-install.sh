#!/usr/bin/env bash
# Bring up a local Claws control plane. Replace the secrets in
# docker-compose.yml before exposing the host. See SELF_HOSTING.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

docker build -t claws-fixture-gateway:proof -f docker/fixture-gateway/Dockerfile docker/fixture-gateway
docker compose up -d --build
echo "Claws is starting on http://localhost:3000"
echo "Create the owner: POST /api/setup/owner  (first request only)"
echo "Proof: node scripts/self-host-proof.mjs"
