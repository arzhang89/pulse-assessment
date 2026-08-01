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

**Decision:** Schedule and claim due monitors in PostgreSQL using short transactions and `FOR UPDATE SKIP LOCKED`. Do not introduce Redis, BullMQ, Kafka, or a separate queue service for Phase 1 (or unless a concrete need appears later).

**Why:** At ~10k monitors on 60s intervals, a leased row model in Postgres is enough and keeps operational surface area small. Lease expiry handles worker crashes without a separate broker. Restart safety and catch-up behavior are expressed in the schema and claim query rather than in queue-broker state.

**Trade-off:** No rich delayed-job tooling. Accepted to keep the system explainable and deployable as web + worker + Postgres on a small VPS.

## One-package repository

**Decision:** Single root `package.json` / `package-lock.json`. The worker is a separate runtime entry point compiled with `tsconfig.worker.json`, not an npm workspace or nested package.

**Why:** Avoids packaging overhead for a small product while still sharing `db/` and `shared/` between processes. Both Docker targets install from the same lockfile and source revision.

## Deliberately limited initial scope

**Decision:** Phase 1 ships only the foundation: app shell, health check with `SELECT 1`, env validation, worker connectivity check, tooling, Docker targets, and docs. No auth, domain schema, scheduling, notifications, or status page yet.

**Why:** A small, verifiable base reduces risk and keeps each later commit meaningful (schema, auth, monitors, worker loop, webhooks). Documented gaps such as production-grade retention, partitioning, backups, and distributed rate limiting remain out of scope for the assessment time box.
