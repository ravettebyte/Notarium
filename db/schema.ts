import { pgTable, text, timestamp, jsonb, boolean, integer, index, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  username: text().notNull().unique(),
  role: text().notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("sessions_user_id_idx").on(table.userId)]);

// Conteúdo da turma (aulas, exercícios, respostas, trilhas) guardado como um documento único.
export const appState = pgTable("app_state", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: text().primaryKey(),
  recipient: text().notNull(),
  data: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("notifications_recipient_idx").on(table.recipient)]);

export const examSessions = pgTable("exam_sessions", {
  examId: text("exam_id").notNull(),
  studentId: text("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  locked: boolean().notNull().default(false),
}, table => [primaryKey({ columns: [table.examId, table.studentId] })]);

// Metadados dos arquivos enviados; o conteúdo fica no Netlify Blobs.
export const media = pgTable("media", {
  id: text().primaryKey(),
  name: text().notNull(),
  type: text().notNull(),
  size: integer().notNull(),
  ownerId: text("owner_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginFailures = pgTable("login_failures", {
  key: text().primaryKey(),
  count: integer().notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
