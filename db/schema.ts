import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const monitorStatusEnum = pgEnum('monitor_status', ['UNKNOWN', 'UP', 'DOWN'])
export const checkOutcomeEnum = pgEnum('check_outcome', ['UP', 'DOWN'])
export const notificationEventTypeEnum = pgEnum('notification_event_type', ['DOWN', 'RECOVERED'])
export const notificationOutboxStatusEnum = pgEnum('notification_outbox_status', [
  'PENDING',
  'SENT',
  'FAILED',
])

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    statusPageSlug: text('status_page_slug').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Reject mixed-case or whitespace-padded emails at the database boundary.
    // Application code still normalizes on write; this CHECK closes the race.
    check('users_email_normalized', sql`${table.email} = lower(trim(${table.email}))`),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only the hash is stored — raw session tokens never persist.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    intervalSeconds: integer('interval_seconds').notNull(),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    enabled: boolean('enabled').notNull().default(true),
    isPublic: boolean('is_public').notNull().default(false),
    status: monitorStatusEnum('status').notNull().default('UNKNOWN'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    consecutiveSuccesses: integer('consecutive_successes').notNull().default(0),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastResponseMs: integer('last_response_ms'),
    lastStatusCode: integer('last_status_code'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('monitors_user_id_idx').on(table.userId),
    // Claim path: enabled monitors ordered by due time. Lease expiry is a
    // residual filter on the small due set — indexing it would churn on every
    // lease take/release for little benefit at ~10k monitors.
    index('monitors_due_claim_idx')
      .on(table.nextCheckAt)
      .where(sql`${table.enabled} = true`),
    check('monitors_name_nonblank', sql`length(trim(${table.name})) > 0`),
    check('monitors_interval_preset', sql`${table.intervalSeconds} in (60, 300, 900, 1800, 3600)`),
    check('monitors_timeout_bounds', sql`${table.timeoutMs} between 1000 and 30000`),
    check('monitors_failures_nonneg', sql`${table.consecutiveFailures} >= 0`),
    check('monitors_successes_nonneg', sql`${table.consecutiveSuccesses} >= 0`),
    check(
      'monitors_last_response_ms_nonneg',
      sql`${table.lastResponseMs} is null or ${table.lastResponseMs} >= 0`,
    ),
    check(
      'monitors_last_status_code_http',
      sql`${table.lastStatusCode} is null or (${table.lastStatusCode} between 100 and 599)`,
    ),
    check(
      'monitors_lease_pair',
      sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
)

export const checkResults = pgTable(
  'check_results',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    outcome: checkOutcomeEnum('outcome').notNull(),
    responseMs: integer('response_ms'),
    statusCode: integer('status_code'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (table) => [
    // Idempotency: one stored result per monitor schedule slot.
    unique('check_results_monitor_scheduled_for_uidx').on(table.monitorId, table.scheduledFor),
    index('check_results_monitor_checked_at_idx').on(table.monitorId, table.checkedAt.desc()),
    check(
      'check_results_response_ms_nonneg',
      sql`${table.responseMs} is null or ${table.responseMs} >= 0`,
    ),
    check(
      'check_results_status_code_http',
      sql`${table.statusCode} is null or (${table.statusCode} between 100 and 599)`,
    ),
  ],
)

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one open incident per monitor (notification lifecycle boundary).
    uniqueIndex('incidents_one_open_per_monitor_uidx')
      .on(table.monitorId)
      .where(sql`${table.resolvedAt} is null`),
  ],
)

export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Ownership path: outbox → incident → monitor → user.
 * destination_url snapshots the webhook URL at event creation so later
 * settings changes cannot redirect an in-flight retry.
 * Deleting a monitor cascades through incidents and removes pending outbox rows.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    destinationUrl: text('destination_url').notNull(),
    eventType: notificationEventTypeEnum('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: notificationOutboxStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One DOWN and one RECOVERED event per incident.
    unique('notification_outbox_incident_event_uidx').on(table.incidentId, table.eventType),
    index('notification_outbox_pending_available_at_idx')
      .on(table.availableAt)
      .where(sql`${table.status} = 'PENDING'`),
    check('notification_outbox_attempts_nonneg', sql`${table.attempts} >= 0`),
    check(
      'notification_outbox_lease_pair',
      sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
)
