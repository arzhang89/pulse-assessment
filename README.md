# Pulse

Pulse is a small multi-tenant uptime-monitoring service. Signed-in users can manage HTTP/HTTPS monitors, see current status and recent history, receive webhooks on confirmed downtime and recovery, and publish selected monitors on a public status page.

## Current state (Phase 1)

Phase 1 is foundation only. It establishes a runnable Nuxt 4 app, a separate Node.js worker entry point, PostgreSQL connectivity via Drizzle, environment validation, lint/format/test tooling, and Docker images for the web and worker targets.

Not implemented yet:

- authentication and sessions
- monitor CRUD
- domain schema / migrations
- scheduling, leasing, and HTTP checks
- webhook notifications
- public status page

## Prerequisites

- Node.js `>=22.18.0` (`.nvmrc` pins `22.23.0`; Docker images use the same patch)
- npm 10+
- Docker and Docker Compose 2.2+ (for local PostgreSQL and image builds)

## Environment setup

```bash
cp .env.example .env
```

Required variables (validated at startup by both the web app and the worker):

| Variable              | Purpose                                |
| --------------------- | -------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string           |
| `NODE_ENV`            | `development`, `production`, or `test` |
| `NUXT_PUBLIC_APP_URL` | Public base URL of the app             |

`.env.example` matches `docker-compose.yml` (Postgres on host port `5544`).

## Local run

```bash
npm install
docker compose up -d db
npm run dev
```

In a second terminal, verify the worker can reach PostgreSQL:

```bash
npm run worker:start
```

## Scripts

| Script                 | Purpose                                     |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Start the Nuxt app                          |
| `npm run build`        | Build the Nuxt app                          |
| `npm run typecheck`    | Typecheck Nuxt app and worker               |
| `npm run lint`         | ESLint                                      |
| `npm run format`       | Prettier write                              |
| `npm run format:check` | Prettier check                              |
| `npm run test`         | Vitest (env parser unit tests)              |
| `npm run db:generate`  | Generate Drizzle migrations (no schema yet) |
| `npm run db:migrate`   | Apply Drizzle migrations                    |
| `npm run worker:start` | One-shot worker DB connectivity check       |
| `npm run worker:build` | Compile the worker to `dist-worker/`        |

## Verification

```bash
npm install
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
docker compose up -d db
# No real migration exists yet — skip db:migrate until the domain-schema phase.
curl http://localhost:3000/api/health   # with `npm run dev` running
npm run worker:start
docker build --target web -t pulse-web .
docker build --target worker -t pulse-worker .
```

Healthy database response from `/api/health`:

```json
{ "status": "ok" }
```

Unavailable database response (HTTP 503, no internal details):

```json
{ "status": "unavailable" }
```

## Architecture notes

See [DECISIONS.md](./DECISIONS.md) for the significant design choices and deliberate non-goals.
