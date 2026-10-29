ALTER TABLE "notarium_accounts" ADD COLUMN "auth_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notarium_accounts" ADD CONSTRAINT "notarium_accounts_auth_key_key" UNIQUE("auth_key");