# Pulse

Pulse is a multi-tenant uptime-monitoring service. Signed-in users manage HTTP/HTTPS monitors, view current status and recent check history, receive webhooks on confirmed downtime and recovery, and publish selected monitors on a public status page.

## Implemented features

- Signup, login, logout with server-side sessions (HttpOnly cookies; scrypt password hashes)
- Tenant-scoped monitor CRUD and dashboard
- Durable worker claiming (`FOR UPDATE SKIP LOCKED` leases)
- SSRF-safe outbound HTTP/HTTPS checks (IP policy + DNS pin)
- Atomic check persistence with incident and notification outbox lifecycle
- Webhook notification settings (one destination per user)
- At-least-once webhook delivery (`payload.eventId` = outbox primary key)
- Recent authenticated check history
- Public unauthenticated status pages (`/status/:slug`)
- Production Compose stack: Caddy (TLS) + web + worker + migrate + PostgreSQL

## Architecture

```text
                  Internet
                     |
                     v
              +-------------+
              |    Caddy    |  :80 / :443 only (TLS terminate)
              +------+------+
                     |
                     v
              +-------------+       +-------------+
              |     web     |------>|  PostgreSQL |
              | Nitro :3000 |       |     db      |
              +-------------+       +------+------+
                                           ^
              +-------------+              |
              |   worker    |--------------+
              | claim/check |  (no published ports)
              +-------------+

              +-------------+
              |   migrate   |  one-shot drizzle-orm migrator
              +-------------+
```

Local development keeps `docker-compose.yml` (Postgres on host port `5544`). Production uses `docker-compose.prod.yml` on a private Compose network; only Caddy publishes host ports.

## Prerequisites

- Node.js `>=22.18.0` (`.nvmrc` pins `22.23.0`)
- npm 10+
- Docker and Docker Compose 2.2+

## Local development

```bash
cp .env.example .env
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

One claim-check-persist batch:

```bash
npm run worker:once
```

Compose can also run the worker alongside Postgres:

```bash
docker compose up -d db worker
```

Open `http://localhost:3000/signup`.

State-changing API calls (including curl) must send a matching `Origin` header:

```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"email":"you@example.com","password":"password123"}'
```

### Test database

Integration and HTTP tests use a separate `pulse_test` database on the same Postgres instance.

```bash
npm run db:test:setup
npm run db:migrate:test
```

`TEST_DATABASE_URL` must point at a database named exactly `pulse_test`. Tests refuse to run against any other database name.

## Scripts

| Script                     | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `npm run dev`              | Start the Nuxt app                                |
| `npm run build`            | Build the Nuxt app                                |
| `npm run typecheck`        | Typecheck Nuxt app and worker                     |
| `npm run lint`             | ESLint with `--max-warnings=0`                    |
| `npm run format:check`     | Prettier check                                    |
| `npm run test:unit`        | Unit tests                                        |
| `npm run test:integration` | Serial DB/worker integration tests                |
| `npm run test:http`        | Serial Nuxt HTTP API tests (`pulse_test`)         |
| `npm run test`             | Unit + integration + HTTP                         |
| `npm run db:test:setup`    | Idempotent create of `pulse_test`                 |
| `npm run db:migrate`       | Migrate development database (drizzle-kit)        |
| `npm run db:migrate:app`   | Migrate via production migrator (`db/migrate.ts`) |
| `npm run db:migrate:test`  | Migrate `pulse_test`                              |
| `npm run worker:start`     | Continuous claim-check-persist + delivery worker  |
| `npm run worker:once`      | One claim-check-persist batch, then exit          |
| `npm run worker:build`     | Compile worker + migrator to `dist-worker/`       |

## Production topology

Services in `docker-compose.prod.yml`:

| Service   | Role                                    | Host ports |
| --------- | --------------------------------------- | ---------- |
| `caddy`   | Reverse proxy + automatic TLS           | 80, 443    |
| `web`     | Nitro (`node .output/server/index.mjs`) | none       |
| `worker`  | Compiled worker process                 | none       |
| `migrate` | One-shot production migrator            | none       |
| `db`      | PostgreSQL 16                           | none       |

Hardening on `web` and `worker`:

- run as unprivileged `node` user
- `read_only: true` with `tmpfs: /tmp`
- `security_opt: no-new-privileges:true`
- json-file log rotation (`max-size: 10m`, `max-file: 3`)

Web health check uses Node itself against `http://127.0.0.1:3000/api/health` (generic JSON only; no SQL/stack leakage).

### Caddy / DNS prerequisites

- DNS A/AAAA for `DOMAIN` points at the VPS
- inbound TCP 80 and 443 are open
- `DOMAIN` is set in the server env file
- optional ACME contact email can be configured in the Caddyfile if desired

Caddy obtains and renews certificates, redirects HTTP to HTTPS, reverse-proxies to `web:3000`, and persists data under Compose volumes for `/data` and `/config`. PostgreSQL and the worker are not exposed through Caddy.

### Production environment

Copy `.env.production.example` to a server-local file (for example `/etc/pulse/.env`):

- do **not** commit the real file
- mode `600`
- strong unique `POSTGRES_PASSWORD`
- `DATABASE_URL` must use Compose hostname `db`
- URL-encode reserved characters in the password
- `NUXT_PUBLIC_APP_URL` must be the real public HTTPS origin (trusted Origin, Secure cookies)

`NUXT_PUBLIC_APP_URL` is read at process start from `process.env` via `shared/env.ts` (not baked into a frozen Nuxt runtimeConfig value). Dashboard public-page links use `window.location.origin` in the browser.

Pass the env file explicitly so a leftover local `.env` cannot override production interpolation:

```bash
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env …
```

### Build and deployment

Exact sequence:

```bash
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env config
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env build
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env up -d db
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env run --rm -T migrate
docker compose -f docker-compose.prod.yml --env-file /etc/pulse/.env up -d caddy web worker
```

Web and worker do **not** auto-migrate. Migrations run only through the `migrate` service (`drizzle-orm/node-postgres/migrator` + compiled `db/migrate.ts`). drizzle-kit is not installed in the migrate image.

Local production Compose smoke (no public TLS):

```bash
./scripts/prod-compose-smoke.sh
```

### Image targets

| Target    | Entrypoint                             |
| --------- | -------------------------------------- |
| `web`     | `node .output/server/index.mjs`        |
| `worker`  | `node dist-worker/worker/src/index.js` |
| `migrate` | `node dist-worker/db/migrate.js`       |

### Worker operation

- Continuous: Compose `worker` service (`restart: unless-stopped`)
- One-shot locally: `npm run worker:once`
- Graceful SIGTERM/SIGINT: stop claiming → drain in-flight → abort after grace; leases expire naturally
- No HTTP health server; rely on process supervision and structured logs

## Authentication and tenant isolation

- Sessions: HttpOnly, SameSite=Lax, Path `/`, Max-Age = session TTL; `Secure` when `NODE_ENV=production`
- Mutations require `Origin` exactly equal to `new URL(NUXT_PUBLIC_APP_URL).origin`
- Every monitor query filters by authenticated `user_id`; missing/other-tenant IDs return the same `404 NOT_FOUND`

## Webhooks

- Delivery is **at-least-once**
- Receivers should deduplicate on `payload.eventId` (equals outbox primary key)
- Payload never includes the monitor URL
- Successful HTTP 2xx marks the outbox row `SENT`
- Retryable failures re-queue with bounded backoff; terminal failures stop retrying

## Public status pages

- Works while logged out at `/status/:slug`
- Shows only enabled + public monitors
- Private and disabled monitors are omitted
- Response excludes monitor URL, email, internal IDs, errors, status codes, webhooks, and lease data

## SSRF protection

Outbound monitor checks and webhook POSTs share the same policy:

- reject localhost, private IPv4, IPv6 loopback/ULA, and credential-containing URLs
- resolve DNS, validate every address, pin one approved address for the attempt
- no test-only private-address bypass

## Scaling

- 10,000 monitors at a 60-second interval is about **167 checks per second**
- required concurrency depends on average request duration
- PostgreSQL `SKIP LOCKED` supports multiple worker replicas
- per-request timeouts isolate slow targets
- `check_results` growth eventually requires retention or partitioning

## Known limitations

- no webhook signing
- no email notifications
- one webhook destination per user
- no charts or retention/partitioning tooling
- open signup (no invite gate)
- expired session row cleanup is deferred

## Live application

Production has been validated locally with Compose. Remote VPS deployment requires an explicitly authorized host, SSH access, domain, DNS readiness, deployment directory, and open inbound 80/443. Until those are provided, there is no live public URL.

### Open signup

Anyone who can reach the app can create an account at `/signup`. There is no invite or admin approval step in this assessment build.

## Acceptance checklist

Use only user-controlled public HTTPS targets. Do not weaken SSRF protection for testing.

- [ ] Signup / Secure+HttpOnly+SameSite=Lax cookie / logout / login
- [ ] Create monitor → worker claims → UNKNOWN becomes UP → history shows
- [ ] Two consecutive failures open one incident and deliver one DOWN event
- [ ] Continued failures create no extra incident/event
- [ ] Two successes resolve the incident and deliver one RECOVERED event
- [ ] Webhook `eventId` matches outbox ID; payload has no monitor URL; 2xx → SENT
- [ ] Public status works logged out; private/disabled omitted; no sensitive leaks
- [ ] Worker restart reclaims expired work without duplicate schedule slots
- [ ] Localhost / private IPv4 / IPv6 loopback-ULA / credential URLs rejected
- [ ] Production API errors expose no stack, SQL text, or constraint names

Do not commit temporary receiver URLs, credentials, tokens, or sensitive screenshots.

## Design notes

See [DECISIONS.md](./DECISIONS.md).
