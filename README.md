# Pulse

Pulse is a small multi-tenant uptime-monitoring service. Signed-in users can manage HTTP/HTTPS monitors, see current status and recent history, receive webhooks on confirmed downtime and recovery, and publish selected monitors on a public status page.

## Current state

- Nuxt 4 app with signup, login, logout, and a monitor dashboard
- Server-side session authentication (HttpOnly cookies; scrypt password hashes)
- Tenant-scoped monitor CRUD API
- PostgreSQL schema with ownership, scheduling, incident, and outbox invariants
- Pure monitor status state machine
- Idempotent `pulse_test` database setup and serial API/HTTP tests

Not implemented yet:

- worker scheduling / leasing loop
- outbound HTTP checks and SSRF-safe fetch
- incident processing and webhook delivery
- public status page UI

## Prerequisites

- Node.js `>=22.18.0` (`.nvmrc` pins `22.23.0`)
- npm 10+
- Docker and Docker Compose 2.2+

## Environment setup

```bash
cp .env.example .env
```

| Variable              | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `DATABASE_URL`        | App/worker PostgreSQL URL (`pulse`)             |
| `TEST_DATABASE_URL`   | Integration/HTTP test DB (must be `pulse_test`) |
| `NODE_ENV`            | `development`, `production`, or `test`          |
| `NUXT_PUBLIC_APP_URL` | Public origin (trusted Origin for mutations)    |

## Local run

```bash
npm install
docker compose up -d db
npm run db:test:setup
npm run db:migrate
npm run db:migrate:test
npm run dev
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
| `npm run test:integration` | Serial DB constraint tests (`pulse_test`) |
| `npm run test:http`        | Serial Nuxt HTTP API tests (`pulse_test`) |
| `npm run test`             | Unit + integration + HTTP                 |
| `npm run db:test:setup`    | Idempotent create of `pulse_test`         |
| `npm run db:migrate`       | Migrate development database              |
| `npm run db:migrate:test`  | Migrate `pulse_test`                      |
| `npm run worker:start`     | One-shot worker DB connectivity check     |

## Architecture notes

See [DECISIONS.md](./DECISIONS.md).
