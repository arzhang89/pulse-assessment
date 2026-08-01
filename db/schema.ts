// Domain tables (users, sessions, monitors, checks, incidents, outbox, ...)
// are defined in the schema-design phase, once the state-machine and
// leasing design from the architecture review is implemented. This file
// intentionally declares no tables yet — it exists so `db/client.ts` and
// `drizzle.config.ts` have a valid schema module to point at, and so
// `drizzle-kit generate` has somewhere to look once real tables land.
export {}
