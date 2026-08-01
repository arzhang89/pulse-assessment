# Decision log

Significant design choices for Pulse, recorded as they are made. Extended in later phases.

## Nuxt 4 / Nitro

**Decision:** Use Nuxt 4 (Vue) with Nitro server routes for the web API.

**Why:** One TypeScript codebase covers the UI and the authenticated HTTP API without introducing a separate backend framework. Nitro keeps server routes colocated and deployable as a Node server, which fits a small VPS deployment.

**Trade-off:** Less isolation between frontend and API than a fully separate service. Acceptable for this scope and interview-explainable size.

## Separate worker process

**Decision:** Run checks from a standalone Node.js worker entry point (`worker/src`), not from Nitro tasks, browsers, or an in-process background loop inside the web server.

**Why:** Outbound HTTP checks must not compete with request handling. A separate process can be scaled and restarted independently, and it makes the "checks run without a browser" requirement explicit.

**Trade-off:** Two runtime images to build and operate. Mitigated by a single repository, shared modules (`db/`, `shared/`), and one multi-stage Dockerfile with `web` and `worker` targets.

## PostgreSQL with Drizzle ORM

**Decision:** PostgreSQL as the system of record; Drizzle ORM + Drizzle Kit for typed access and migrations; `node-postgres` (`pg`) as the driver.

**Why:** Relational data fits tenants, monitors, check history, incidents, and an outbox cleanly. Drizzle stays close to SQL (important for leasing with `FOR UPDATE SKIP LOCKED`) without the weight of a heavier ORM.

## PostgreSQL-native scheduling instead of Redis / BullMQ

**Decision:** Schedule and claim due monitors in PostgreSQL using short transactions and `FOR UPDATE SKIP LOCKED`. Do not introduce Redis, BullMQ, Kafka, or a separate queue service unless a concrete need appears later.

**Why:** At ~10k monitors on 60s intervals, a leased row model in Postgres is enough and keeps operational surface area small. Lease expiry handles worker crashes without a separate broker.

**Trade-off:** No rich delayed-job tooling. Accepted to keep the system explainable and deployable as web + worker + Postgres on a small VPS.

## One-package repository

**Decision:** Single root `package.json` / `package-lock.json`. The worker is a separate runtime entry point compiled with `tsconfig.worker.json`, not an npm workspace or nested package.

## Domain schema invariants

**Decision:** Enforce ownership and idempotency in PostgreSQL: unique normalized emails, unique schedule slots, one open incident per monitor (partial unique index), one DOWN/RECOVERED outbox row per incident, lease-pair CHECKs, and bounded monitor intervals/timeouts.

**Email normalization:** `CHECK (email = lower(trim(email)))` plus a UNIQUE constraint. No `citext`. Application code still normalizes on write; the CHECK rejects mixed-case or padded values that slip through.

**Due-monitor index:** partial index on `next_check_at WHERE enabled = true`. Lease expiry is intentionally not indexed — after the due-time filter, residual lease checks are cheap, and indexing lease columns would churn on every claim/release.

**Outbox ownership:** `notification_outbox → incident → monitor → user`. No independent `user_id` / `monitor_id` FKs on the outbox. `destination_url` snapshots the webhook URL at event creation so later settings changes cannot redirect retries. Deleting a monitor cascades through incidents and removes pending outbox rows — intentional for this scope (pending notifications about deleted resources are discarded).

## Test database

**Decision:** Use a separate `pulse_test` database on the same local Postgres instance, created by an idempotent `npm run db:test:setup` that connects to the `postgres` maintenance DB and issues `CREATE DATABASE` only when absent.

**Why:** Docker entrypoint init scripts do not re-run on an already-initialized volume. A dedicated DB keeps destructive constraint tests away from development data. Integration tests run serially and refuse to proceed unless `current_database()` is exactly `pulse_test`.

**Trade-off:** Requires `TEST_DATABASE_URL` and an explicit setup step. Avoids Testcontainers and schema `search_path` complexity.

## Monitor status transitions

**Decision:** Keep status transitions in a pure module (`shared/monitor-status.ts`) with named thresholds (`FAILURES_TO_CONFIRM_DOWN = 2`, `SUCCESSES_TO_CONFIRM_RECOVERY = 2`) and saturating counters.

**Why:** Flapping must not spam notifications. Two consecutive failures confirm DOWN (`OPEN_INCIDENT`); two consecutive successes from DOWN confirm recovery (`RESOLVE_INCIDENT`). UNKNOWN → UP on first success creates no notification. Counters cap at the threshold so stored state never drifts to unbounded values. The function returns new data and never mutates its input; database I/O stays outside this module.

## Session authentication

**Decision:** Server-side sessions with HttpOnly cookies; only SHA-256(token) stored in PostgreSQL. Passwords hashed with Node `crypto.scrypt` (async) in a versioned self-describing format (`scrypt$v=1$N=...`).

**Why:** Avoids JWTs and native Argon2/bcrypt bindings in Alpine Docker. scrypt parameters are encoded in the stored string for future upgrades. Login always performs a verify (dummy hash when the email is unknown) before returning `INVALID_CREDENTIALS`.

**CSRF:** State-changing routes require an exact `Origin` match to `NUXT_PUBLIC_APP_URL.origin`. Missing Origin is rejected. SameSite=Lax is defense-in-depth, not sufficient alone. No permissive CORS. Secure cookies only in production.

**Sessions:** 14-day TTL; multiple concurrent sessions allowed; logout is idempotent. Expired-session row cleanup is deferred.

## Deliberately limited scope so far

**Decision:** Monitor CRUD UI, worker claiming loops, outbound HTTP checks, webhook delivery, and status-page UI remain later slices (monitor API may land before the dashboard).

**Why:** Deliver auth and tenant boundaries before background checking and notifications.
