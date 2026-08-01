CREATE TYPE "public"."check_outcome" AS ENUM('UP', 'DOWN');--> statement-breakpoint
CREATE TYPE "public"."monitor_status" AS ENUM('UNKNOWN', 'UP', 'DOWN');--> statement-breakpoint
CREATE TYPE "public"."notification_event_type" AS ENUM('DOWN', 'RECOVERED');--> statement-breakpoint
CREATE TYPE "public"."notification_outbox_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "check_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"monitor_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"outcome" "check_outcome" NOT NULL,
	"response_ms" integer,
	"status_code" integer,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "check_results_monitor_scheduled_for_uidx" UNIQUE("monitor_id","scheduled_for"),
	CONSTRAINT "check_results_response_ms_nonneg" CHECK ("check_results"."response_ms" is null or "check_results"."response_ms" >= 0),
	CONSTRAINT "check_results_status_code_http" CHECK ("check_results"."status_code" is null or ("check_results"."status_code" between 100 and 599))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"status" "monitor_status" DEFAULT 'UNKNOWN' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_successes" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_response_ms" integer,
	"last_status_code" integer,
	"last_error_code" text,
	"last_error_message" text,
	"next_check_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitors_name_nonblank" CHECK (length(trim("monitors"."name")) > 0),
	CONSTRAINT "monitors_interval_preset" CHECK ("monitors"."interval_seconds" in (60, 300, 900, 1800, 3600)),
	CONSTRAINT "monitors_timeout_bounds" CHECK ("monitors"."timeout_ms" between 1000 and 30000),
	CONSTRAINT "monitors_failures_nonneg" CHECK ("monitors"."consecutive_failures" >= 0),
	CONSTRAINT "monitors_successes_nonneg" CHECK ("monitors"."consecutive_successes" >= 0),
	CONSTRAINT "monitors_last_response_ms_nonneg" CHECK ("monitors"."last_response_ms" is null or "monitors"."last_response_ms" >= 0),
	CONSTRAINT "monitors_last_status_code_http" CHECK ("monitors"."last_status_code" is null or ("monitors"."last_status_code" between 100 and 599)),
	CONSTRAINT "monitors_lease_pair" CHECK (("monitors"."lease_owner" is null and "monitors"."lease_expires_at" is null) or ("monitors"."lease_owner" is not null and "monitors"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"destination_url" text NOT NULL,
	"event_type" "notification_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "notification_outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_incident_event_uidx" UNIQUE("incident_id","event_type"),
	CONSTRAINT "notification_outbox_attempts_nonneg" CHECK ("notification_outbox"."attempts" >= 0),
	CONSTRAINT "notification_outbox_lease_pair" CHECK (("notification_outbox"."lease_owner" is null and "notification_outbox"."lease_expires_at" is null) or ("notification_outbox"."lease_owner" is not null and "notification_outbox"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"webhook_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status_page_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_page_slug_unique" UNIQUE("status_page_slug"),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(trim("users"."email")))
);
--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_monitor_checked_at_idx" ON "check_results" USING btree ("monitor_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_open_per_monitor_uidx" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "monitors_user_id_idx" ON "monitors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "monitors_due_claim_idx" ON "monitors" USING btree ("next_check_at") WHERE "monitors"."enabled" = true;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_available_at_idx" ON "notification_outbox" USING btree ("available_at") WHERE "notification_outbox"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");