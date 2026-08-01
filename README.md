# Pulse

Pulse is a small multi-tenant uptime-monitoring service. Signed-in users can manage HTTP/HTTPS monitors, see current status and recent history, receive webhooks on confirmed downtime and recovery, and publish selected monitors on a public status page.

## Current state

- Nuxt 4 app with signup, login, logout, and a monitor dashboard
- Server-side session authentication (HttpOnly cookies; scrypt password hashes)
- Tenant-scoped monitor CRUD API
- PostgreSQL schema with ownership, scheduling, incident, and outbox invariants
- Pure monitor status state machine
- Durable worker claiming (`FOR UPDATE SKIP LOCKED` leases)
- SSRF-safe outbound HTTP/HTTPS checks (IP policy + pinned connect)
- Atomic check persistence with incident/outbox lifecycle
- Authenticated webhook notification settings (one destination per user)
- At-least-once webhook delivery from the notification outbox
- Authenticated recent check history on the dashboard
- Idempotent `pulse_test` database setup and serial API/HTTP tests

Not implemented yet:

- public status page UI
- charts / retention tooling

## Prerequisites

- Node.js `>=22.18.0` (`.nvmrc` pins `22.23.0`)
- npm 10+
- Docker and Docker Compose 2.2+

## Environment setup

```bash
cp .env.example .env
```

| Variable                          | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                    | App/worker PostgreSQL URL (`pulse`)               |
| `TEST_DATABASE_URL`               | Integration/HTTP test DB (must be `pulse_test`)   |
| `NODE_ENV`                        | `development`, `production`, or `test`            |
| `NUXT_PUBLIC_APP_URL`             | Public origin (trusted Origin for mutations)      |
| `WORKER_CONCURRENCY`              | Max in-flight checks (default `20`)               |
| `WORKER_NOTIFICATION_CONCURRENCY` | Max in-flight webhook deliveries (default `10`)   |
| `WORKER_POLL_INTERVAL_MS`         | Claim loop sleep (default `1000`)                 |
| `WORKER_LEASE_SECONDS`            | Lease TTL; must exceed work+margin (default `60`) |
| `WORKER_DELIVERY_TIMEOUT_MS`      | Webhook POST timeout (default `10000`)            |
| `WORKER_SHUTDOWN_GRACE_MS`        | In-flight grace before abort (default `60000`)    |
| `WORKER_ID`                       | Optional stable worker identity                   |

## Local run

```bash
npm install
docker compose up -d db
npm run db:test:setup
npm run db:migrate
npm run db:migrate:test
npm run dev
```

In another terminal:

```bash
npm run worker:start
```

Or run a single claim-check-persist batch:

```bash
npm run worker:once
```

Compose can also run the continuously restarting worker alongside Postgres:

```bash
docker compose up -d db worker
```

Open `http://localhost:3000/signup`.

State-changing API calls (including curl) must send a matching `Origin` header, for example:

```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"email":"you@example.com","password":"password123"}'
```

## Scripts

| Script                     | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `npm run dev`              | Start the Nuxt app                        |
| `npm run build`            | Build the Nuxt app                        |
| `npm run typecheck`        | Typecheck Nuxt app and worker             |
| `npm run lint`             | ESLint                                    |
| `npm run format:check`     | Prettier check                            |
| `npm run test:unit`        | Unit tests                                |
| `npm run test:integration` | Serial DB/worker integration tests        |
| `npm run test:http`        | Serial Nuxt HTTP API tests (`pulse_test`) |
| `npm run test`             | Unit + integration + HTTP                 |
| `npm run db:test:setup`    | Idempotent create of `pulse_test`         |
| `npm run db:migrate`       | Migrate development database              |
| `npm run db:migrate:test`  | Migrate `pulse_test`                      |
| `npm run worker:start`     | Continuous claim-check-persist worker     |
| `npm run worker:once`      | One claim-check-persist batch, then exit  |

## Architecture notes

See [DECISIONS.md](./DECISIONS.md).
