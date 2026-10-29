import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';

export const accounts = pgTable('notarium_accounts', {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  authKey: text('auth_key').notNull().unique(),
  name: text().notNull(),
  role: text().notNull(),
  profile: jsonb().notNull().default({}),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at'),
});

// The existing editor saves its related collections as one atomic document.
export const classroom = pgTable('notarium_classroom', {
  id: text().primaryKey(),
  data: jsonb().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const loginAttempts = pgTable('notarium_login_attempts', {
  id: text().primaryKey(),
  count: integer().notNull().default(0),
  resetAt: timestamp('reset_at').notNull(),
});
