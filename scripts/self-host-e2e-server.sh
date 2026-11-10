#!/bin/sh
# CI only. Runs the branch's Next server on the claws network so app to
# runtime dials the container name, the same path compose uses.
set -eu
docker rm -f claws-self-host-e2e >/dev/null 2>&1 || true
exec docker run --rm --name claws-self-host-e2e \
  --network claws \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:3001:3001 \
  -v "$PWD":/work \
  -w /work \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DATABASE_URL=postgresql://claws:claws@host.docker.internal:5432/claws \
  -e DIRECT_URL=postgresql://claws:claws@host.docker.internal:5432/claws \
  -e UPSTASH_REDIS_REST_URL=http://host.docker.internal:8079 \
  -e UPSTASH_REDIS_REST_TOKEN \
  -e CLAWS_PROFILE \
  -e E2E_TEST_MODE \
  -e RUNTIME_IMAGE_TAG \
  -e CLAWS_DOCKER_NETWORK \
  -e CLAWS_DOCKER_PUBLISH \
  -e ENCRYPTION_MASTER_KEY \
  -e ENCRYPTION_KEY_VERSION \
  -e NEXTAUTH_SECRET \
  -e NEXTAUTH_URL \
  -e ADMIN_EMAILS \
  node:20-bookworm \
  bash -lc "npx tsx prisma/seed.ts && npx next build && exec npx next start --port 3001 --hostname 0.0.0.0"
