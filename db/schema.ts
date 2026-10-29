import { pgTable, text, jsonb, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
  id: text().primaryKey(), email: text().notNull().unique(), username: text().notNull().unique(),
  name: text().notNull(), role: text().notNull(), isAdmin: boolean('is_admin').notNull().default(false),
  profile: jsonb().notNull().default({}), createdAt: text('created_at').notNull(), lastSeenAt: text('last_seen_at'),
});
export const settings = pgTable('settings', { id: text().primaryKey(), data: jsonb().notNull() });
export const blocks = pgTable('blocks', { id: text().primaryKey(), data: jsonb().notNull() });
export const exerciseBlocks = pgTable('exercise_blocks', { id: text().primaryKey(), data: jsonb().notNull() });
export const lessons = pgTable('lessons', { id: text().primaryKey(), blockId: text('block_id').references(() => blocks.id), data: jsonb().notNull() });
export const exercises = pgTable('exercises', { id: text().primaryKey(), data: jsonb().notNull() });
export const attempts = pgTable('attempts', { id: text().primaryKey(), studentId: text('student_id').notNull().references(() => users.id, {onDelete:'cascade'}), exerciseId: text('exercise_id').notNull().references(() => exercises.id, {onDelete:'cascade'}), data: jsonb().notNull() });
export const trails = pgTable('trails', { id: text().primaryKey(), studentId: text('student_id').notNull().references(() => users.id, {onDelete:'cascade'}), data: jsonb().notNull() });
export const trailSettings = pgTable('trail_settings', { id: text().primaryKey().references(() => users.id, {onDelete:'cascade'}), data: jsonb().notNull() });
export const media = pgTable('media', { id: text().primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), data: jsonb().notNull() });
export const notifications = pgTable('notifications', { id: text().primaryKey(), data: jsonb().notNull() });
export const examSessions = pgTable('exam_sessions', { id: text().primaryKey(), studentId: text('student_id').notNull().references(() => users.id, {onDelete:'cascade'}), data: jsonb().notNull() });
export const rateLimits = pgTable('rate_limits', { id: text().primaryKey(), count: integer().notNull(), resetAt: timestamp('reset_at', {withTimezone:true}).notNull() });
export const backupRuns = pgTable('backup_runs', { id: text().primaryKey(), startedAt: timestamp('started_at', {withTimezone:true}).defaultNow().notNull(), finishedAt: timestamp('finished_at', {withTimezone:true}), status: text().notNull(), manifest: text(), error: text(), verifiedAt: timestamp('verified_at', {withTimezone:true}) });
export const compositions = pgTable('compositions', { id: text().primaryKey().references(() => users.id, {onDelete:'cascade'}), data: jsonb().notNull() });
export const backupJobs = pgTable('backup_jobs', { id:text().primaryKey(), tokenHash:text('token_hash').notNull(), kind:text().notNull(), createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull() });
