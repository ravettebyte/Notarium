CREATE TABLE "notarium_accounts" (
	"id" text PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"last_seen_at" text
);
--> statement-breakpoint
CREATE TABLE "notarium_classroom" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notarium_login_attempts" (
	"id" text PRIMARY KEY,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL
);
