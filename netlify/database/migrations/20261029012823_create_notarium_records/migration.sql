CREATE TABLE "notarium_records" (
	"kind" text,
	"id" text,
	"value" jsonb NOT NULL,
	CONSTRAINT "notarium_records_pkey" PRIMARY KEY("kind","id")
);
