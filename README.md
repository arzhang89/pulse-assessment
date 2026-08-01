# Pulse

Pulse is a small multi-tenant uptime-monitoring service. Signed-in users can manage HTTP/HTTPS monitors, see current status and recent history, receive webhooks on confirmed downtime and recovery, and publish selected monitors on a public status page.

## Current state

Foundation plus the core domain schema:

- Nuxt 4 app, Nitro health check, separate worker entry point
- PostgreSQL schema with ownership, scheduling, incident, and outbox invariants
- Idempotent `pulse_test` database setup for serial integration tests

Not implemented yet:

- authentication and sessions
- monitor CRUD
- worker scheduling / leasing loop
- outbound HTTP checks and SSRF-safe fetch
- webhook delivery
- public status page UI

## Prerequisites

- Node.js `>=22.18.0` (`.nvmrc` pins `22.23.0`; Docker images use the same patch)
- npm 10+
- Docker and Docker Compose 2.2+ (for local PostgreSQL and image builds)

## Environment setup

```bash
cp .env.example .env
```

| Variable              | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `DATABASE_URL`        | App/worker PostgreSQL URL (`pulse`)            |
| `TEST_DATABASE_URL`   | Integration-test DB URL (must be `pulse_test`) |
| `NODE_ENV`            | `development`, `production`, or `test`         |
| `NUXT_PUBLIC_APP_URL` | Public base URL of the app                     |

## Local run

```bash
npm install
docker compose up -d db
npm run db:test:setup
npm run db:migrate
npm run db:migrate:test
npm run dev
```

Worker connectivity check:

```bash
npm run worker:start
```

## Database

```bash
npm run db:test:setup      # create pulse_test if missing (idempotent)
npm run db:generate        # generate migrations from db/schema.ts
npm run db:migrate         # apply to DATABASE_URL (pulse)
npm run db:migrate:test    # apply to TEST_DATABASE_URL (pulse_test)
```

## Scripts

| Script                     | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Start the Nuxt app                       |
| `npm run build`            | Build the Nuxt app                       |
| `npm run typecheck`        | Typecheck Nuxt app and worker            |
| `npm run lint`             | ESLint                                   |
| `npm run format`           | Prettier write                           |
| `npm run format:check`     | Prettier check                           |
| `npm run test:unit`        | Unit tests (no database)                 |
| `npm run test:integration` | Serial schema tests against `pulse_test` |
| `npm run test`             | Unit then integration                    |
| `npm run db:test:setup`    | Idempotent create of `pulse_test`        |
| `npm run db:generate`      | Generate Drizzle migrations              |
| `npm run db:migrate`       | Migrate development database             |
| `npm run db:migrate:test`  | Migrate `pulse_test`                     |
| `npm run worker:start`     | One-shot worker DB connectivity check    |
| `npm run worker:build`     | Compile the worker to `dist-worker/`     |

## Verification

```bash
npm ci
docker compose up -d db
npm run db:test:setup
npm run db:migrate
npm run db:migrate:test
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run worker:start
```

Health (`GET /api/health`) when the database is reachable:

```json
{ "status": "ok", "database": "up" }
```

When unavailable (HTTP 503):

```json
{ "status": "unavailable", "database": "down" }
```

## Architecture notes

See [DECISIONS.md](./DECISIONS.md) for significant design choices and deliberate non-goals.
