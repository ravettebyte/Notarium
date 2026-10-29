CREATE TABLE "backup_jobs" (
	"id" text PRIMARY KEY,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
