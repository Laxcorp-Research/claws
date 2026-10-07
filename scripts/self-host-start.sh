#!/bin/sh
set -eu
echo "self-host: migrating"
npx prisma migrate deploy
echo "self-host: seeding templates"
npx tsx prisma/seed.ts
echo "self-host: starting"
export NODE_ENV=production
exec npx next start -H 0.0.0.0 -p 3000
