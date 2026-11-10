#!/bin/sh
set -eu
extra=/usr/local/share/ca-certificates/extra
bundle=/certs/bundle.pem
mkdir -p /certs
if [ -d "$extra" ] && ls "$extra"/*.pem >/dev/null 2>&1; then
  cat "$extra"/*.pem > "$bundle"
  export NODE_EXTRA_CA_CERTS="$bundle"
  echo "self-host: loaded extra CA bundle"
fi
echo "self-host: migrating"
npx prisma migrate deploy
echo "self-host: seeding templates"
npx tsx prisma/seed.ts
echo "self-host: starting"
export NODE_ENV=production
exec npx next start -H 0.0.0.0 -p 3000
