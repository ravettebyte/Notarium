import { pgTable, text, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const records = pgTable('notarium_records', {
  kind: text('kind').notNull(),
  id: text('id').notNull(),
  value: jsonb('value').notNull(),
}, table => [primaryKey({ columns: [table.kind, table.id] })]);
