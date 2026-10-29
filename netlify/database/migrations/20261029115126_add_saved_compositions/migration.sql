CREATE TABLE "compositions" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_id_users_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE;