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

## Monitor scheduling and URL changes

**Decision:** `next_check_at = now + random(0..min(30s, interval))` via a shared helper. URL changes reset live status/counters/lease and schedule a fresh check, but keep historical `check_results`.

**Why:** A monitor represents a logical service whose endpoint may change over time. History stays attached. Create-time URL validation covers scheme and credentials only — DNS/IP SSRF pinning belongs with the outbound checker.

**Tenant isolation:** Every monitor query includes `user_id = authenticatedUserId`. Missing, malformed, and other-tenant IDs all return the same `404 NOT_FOUND`.

## Worker claiming and leases

**Decision:** Claim due monitors with a CTE + `UPDATE … RETURNING`, `FOR UPDATE SKIP LOCKED`, and `make_interval(secs => $leaseSeconds)`. Claim batch size is free concurrency capacity. Lease acquire does not bump `updated_at`. The original `next_check_at` is returned as `scheduledFor` and remains the stale-work guard until persistence succeeds.

**Shutdown:** stop claiming → wait for in-flight work → on grace expiry abort remaining checks via `AbortSignal` → do not clear their leases (they expire naturally).

## SSRF-safe checks

**Decision:** Every outbound request resolves DNS and validates the full address set against an explicit forbidden-range policy (`ipaddr.js`, including IPv4-mapped forms). One approved address is pinned for that attempt via a custom `lookup` (`agent: false`); the HTTP client does not independently re-resolve during the request. Future attempts may receive different DNS results, and each attempt validates those results again. The original hostname is retained for Host / TLS SNI / certificate verification. Literal IP URLs connect directly without forcing IP SNI. One deadline starts before DNS and covers DNS + TCP + TLS + response headers; the body is not buffered.

## Atomic persistence and outbox

**Decision:** After each check, open a short transaction, lock the monitor, require `lease_owner = workerId` and `next_check_at = scheduledFor`, insert `check_results` with `ON CONFLICT (monitor_id, scheduled_for) DO NOTHING`, then apply the pure state machine, cadence, incidents, and outbox rows before clearing the lease.

**Cadence:** `candidate = scheduledFor + interval`; if `candidate > finishedAt` use `candidate`, else `finishedAt + interval`.

**Stale work:** URL/interval/disable/re-enable clear the lease pair (and reschedule except disable). Name/isPublic edits do not. Stale or duplicate results must not mutate status/history/incidents/`next_check_at` (duplicates may clear an owned lease only).

**Outbox payload:** versioned JSON without the monitor URL. `eventId` is generated before insert and equals the outbox primary key. `destination_url` snapshots the webhook URL when settings are enabled.

## Webhook notification settings

**Decision:** One `notification_settings` row per user, managed via `GET`/`PUT /api/notification-settings`. Settings changes affect **future** outbox creation only. Existing pending outbox rows keep their snapshotted `destination_url` and remain deliverable.

**Clearing:** `enabled=false` with `webhookUrl=null` deletes the settings row. `enabled=false` with a valid URL keeps the URL for later re-enable. `enabled=true` requires a non-null URL. Create-time URL validation is scheme/credentials only; delivery SSRF enforcement belongs with the outbound transport.

## Webhook delivery (at-least-once)

**Decision:** A second in-process worker loop claims `notification_outbox` rows (`FOR UPDATE SKIP LOCKED`), POSTs the snapshotted JSON payload via the shared SSRF-safe transport, then finalizes under a lease-owner + PENDING guard.

**Semantics:** Delivery is at-least-once. Receivers should deduplicate on `payload.eventId` (equals outbox PK). Payload is never mutated across retries. No webhook signing in this assessment.

**Classification:** Success = HTTP 200–299. Retryable = DNS/connect/TLS/timeout, 408/425/429, 5xx. Terminal = 3xx (no redirects), other 4xx, forbidden/invalid destination. Max attempts = 8; delays 30s → 2m → 10m → 1h (capped).

## Public status pages

**Decision:** Unauthenticated `/status/:slug` and `GET /api/public/status/:slug` expose only enabled + public monitors for a user's `status_page_slug`. Unknown slug → 404; known slug with zero public monitors → empty 200. No application-level caching. Public DTO excludes URL, errors, status codes, history, incidents, and account identifiers.

## Deliberately limited scope so far

**Decision:** Webhook signing, email notifications, multiple destinations, charts, retention/partitioning, and production deploy hardening remain later. Deploy is the next phase.

**Why:** Core product behavior (settings, delivery, history, public status) is complete and explainable within the assessment timebox.
