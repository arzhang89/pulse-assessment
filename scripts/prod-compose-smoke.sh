#!/usr/bin/env sh
# Local production Compose validation (no public TLS). Uses a disposable .env.prod.smoke.
set -eu
set -o pipefail 2>/dev/null || true
set +x

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SMOKE_ENV="$ROOT/.env.prod.smoke"

# Shell-exported vars and a local .env override --env-file interpolation.
# Clear known keys so smoke values win for Compose substitution.
unset DATABASE_URL NODE_ENV NUXT_PUBLIC_APP_URL HOST PORT NITRO_HOST NITRO_PORT \
  WORKER_CONCURRENCY WORKER_NOTIFICATION_CONCURRENCY WORKER_POLL_INTERVAL_MS \
  WORKER_LEASE_SECONDS WORKER_SHUTDOWN_GRACE_MS WORKER_DELIVERY_TIMEOUT_MS WORKER_ID \
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DOMAIN ACME_EMAIL 2>/dev/null || true

# Temporarily hide project .env so Compose does not interpolate local-dev values.
MOVED_ENV=""
if [ -f "$ROOT/.env" ]; then
  MOVED_ENV="$ROOT/.env.smoke-bak"
  mv "$ROOT/.env" "$MOVED_ENV"
fi

compose() {
  docker compose -f docker-compose.prod.yml --env-file "$SMOKE_ENV" "$@"
}

cat >"$SMOKE_ENV" <<'EOF'
POSTGRES_USER=pulse_smoke
POSTGRES_PASSWORD=smoke_password_not_for_prod
POSTGRES_DB=pulse
DATABASE_URL=postgresql://pulse_smoke:smoke_password_not_for_prod@db:5432/pulse
NODE_ENV=production
NUXT_PUBLIC_APP_URL=https://pulse.example.com
HOST=0.0.0.0
PORT=3000
NITRO_HOST=0.0.0.0
NITRO_PORT=3000
WORKER_CONCURRENCY=2
WORKER_NOTIFICATION_CONCURRENCY=2
WORKER_POLL_INTERVAL_MS=1000
WORKER_LEASE_SECONDS=60
WORKER_SHUTDOWN_GRACE_MS=5000
WORKER_DELIVERY_TIMEOUT_MS=10000
DOMAIN=pulse.example.com
EOF
chmod 600 "$SMOKE_ENV"

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$SMOKE_ENV"
  if [ -n "$MOVED_ENV" ] && [ -f "$MOVED_ENV" ]; then
    mv "$MOVED_ENV" "$ROOT/.env"
  fi
}
trap cleanup EXIT

echo "Validating Compose config…"
config_out="$(compose config)"
echo "$config_out" | grep -q 'pulse_smoke:smoke_password_not_for_prod@db:5432/pulse'
echo "$config_out" | grep -q 'published: "80"\|published: 80'
echo "$config_out" | grep -q 'published: "443"\|published: 443'
# Postgres/web/worker must not publish host ports.
if echo "$config_out" | grep -E 'published: "?(5432|3000)'; then
  echo "Unexpected published application port"
  exit 1
fi

echo "Building images…"
compose build migrate web worker

echo "Starting database…"
compose up -d db

echo "Running migrations…"
# -T: disable TTY so stdout is captured reliably on older Compose versions.
compose run --rm -T migrate | tee /tmp/pulse-migrate-smoke.log
grep -q migrate_success /tmp/pulse-migrate-smoke.log

echo "Starting web…"
compose up -d web

echo "Waiting for web health…"
i=0
until compose exec -T web \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "Web health check failed"
    compose logs web
    exit 1
  fi
  sleep 2
done

echo "Checking health body is generic…"
health_body="$(compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{process.stdout.write(await r.text())})")"
echo "$health_body" | grep -q '"status":"ok"'
case "$health_body" in
  *[Pp]assword*|*[Cc]onstraint*|*ECONN*|*stack*|*SQL*)
    echo "Health body leaked internals: $health_body"
    exit 1
    ;;
esac

echo "Checking non-root runtime…"
web_user="$(compose exec -T web node -e "process.stdout.write(String(process.getuid()))")"
worker_tmp="$(compose run --rm -T --no-deps --entrypoint node worker -e "process.stdout.write(String(process.getuid()))")"
echo "web uid=$web_user worker uid=$worker_tmp"
if [ "$web_user" = "0" ] || [ "$worker_tmp" = "0" ] || [ -z "$web_user" ] || [ -z "$worker_tmp" ]; then
  echo "Expected non-root UIDs"
  exit 1
fi

echo "Checking read-only root filesystem on web…"
if compose exec -T web sh -c 'touch /app/should-fail 2>/dev/null'; then
  echo "Web root filesystem is writable"
  exit 1
fi

echo "Checking distinct entrypoints…"
# Compose v2.2 lists IDs with -q; repository names follow {project}_{service}.
project="$(basename "$ROOT")"
web_cmd="$(docker image inspect "${project}_web" --format '{{json .Config.Cmd}}')"
worker_cmd="$(docker image inspect "${project}_worker" --format '{{json .Config.Cmd}}')"
migrate_cmd="$(docker image inspect "${project}_migrate" --format '{{json .Config.Cmd}}')"
echo "web=$web_cmd"
echo "worker=$worker_cmd"
echo "migrate=$migrate_cmd"
echo "$web_cmd" | grep -q '.output/server/index.mjs'
echo "$worker_cmd" | grep -q 'dist-worker/worker/src/index.js'
echo "$migrate_cmd" | grep -q 'dist-worker/db/migrate.js'

echo "Smoke OK"
