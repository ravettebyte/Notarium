import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, eq, desc, lt } from "drizzle-orm";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import { users, sessions, appState, notifications, examSessions, media, loginFailures } from "../../db/schema.js";
import core from "../../notarium-core.js";

const {
  emptyModel, normalizeUsername, validUsername, hashPassword, checkPassword, publicUser: corePublicUser,
  modelFor, referencedMediaIds, normalizeRhythmAnswer, gradeAnswer
} = core as any;

type User = typeof users.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const SESSION_DAYS = 30;
// Funções síncronas do Netlify aceitam até 6 MB por solicitação; o arquivo chega em base64 (+33%).
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function readJson(request: Request): Promise<any> {
  const text = await request.text();
  try { return JSON.parse(text || "{}"); }
  catch { throw new HttpError(400, "JSON inválido."); }
}

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function asUser(row: User) {
  return { ...row, createdAt: iso(row.createdAt), lastSeenAt: iso(row.lastSeenAt) };
}

function publicUser(row: User) {
  return corePublicUser(asUser(row));
}

function portalUrl(request: Request) {
  return new URL("/?login=1", new URL(request.url).origin).href;
}

async function currentUser(request: Request): Promise<User | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const [row] = await db.select({ user: users, createdAt: sessions.createdAt }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row) return null;
  if (Date.now() - row.createdAt.getTime() > SESSION_DAYS * 86_400_000) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return null;
  }
  return row.user;
}

async function createSession(userId: string, executor: Executor = db) {
  const token = randomBytes(32).toString("hex");
  await executor.insert(sessions).values({ tokenHash: hashToken(token), userId });
  return token;
}

async function teacherExists(executor: Executor = db) {
  const [row] = await executor.select({ id: users.id }).from(users).where(eq(users.role, "teacher")).limit(1);
  return Boolean(row);
}

async function readModel(executor: Executor = db): Promise<any | null> {
  const [row] = await executor.select().from(appState).where(eq(appState.key, "model"));
  return row ? row.value : null;
}

// Bloqueia o documento de conteúdo para que gravações simultâneas (professor e alunos) não se sobrescrevam.
async function withLockedModel<T>(callback: (tx: Tx, model: any) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.insert(appState).values({ key: "model", value: emptyModel() }).onConflictDoNothing();
    const [row] = await tx.select().from(appState).where(eq(appState.key, "model")).for("update");
    return callback(tx, row.value);
  });
}

async function writeModel(tx: Tx, model: any) {
  await tx.update(appState).set({ value: model, updatedAt: new Date() }).where(eq(appState.key, "model"));
}

async function addNotification(executor: Executor, recipient: string, type: string, title: string, message: string,
  metadata: Record<string, unknown> = {}, id: string = randomUUID()) {
  const createdAt = new Date();
  const notification = { id, recipient, type, title, message, ...metadata, createdAt: createdAt.toISOString(), readAt: "" };
  await executor.insert(notifications).values({ id, recipient, data: notification, createdAt }).onConflictDoNothing();
  return notification;
}

async function notificationsFor(user: User) {
  const recipient = user.role === "teacher" ? "teacher" : user.id;
  const rows = await db.select().from(notifications).where(eq(notifications.recipient, recipient))
    .orderBy(desc(notifications.createdAt));
  return rows.map(row => row.data as any);
}

function publicExamSession(row: typeof examSessions.$inferSelect | undefined) {
  if (!row) return null;
  return { examId: row.examId, studentId: row.studentId, startedAt: iso(row.startedAt), lastSeenAt: iso(row.lastSeenAt), locked: row.locked };
}

async function findExamSession(examId: string, studentId: string) {
  const [row] = await db.select().from(examSessions)
    .where(and(eq(examSessions.examId, examId), eq(examSessions.studentId, studentId)));
  return row;
}

async function lockExamForInactivity(user: User, exam: any) {
  await db.update(examSessions).set({ locked: true })
    .where(and(eq(examSessions.examId, exam.id), eq(examSessions.studentId, user.id)));
  await addNotification(db, "teacher", "exam-reopen-request", "Aluno precisa retomar uma avaliação",
    `${user.name} saiu da avaliação “${exam.title}” por mais de 3 minutos.`,
    { examId: exam.id, studentId: user.id, studentName: user.name, examTitle: exam.title });
}

function mediaStore() {
  return getStore({ name: "notarium-media", consistency: "strong" });
}

async function handle(request: Request, context: Context) {
  const url = new URL(request.url);
  const route = url.pathname;
  const method = request.method;

  if (route === "/api/health" && method === "GET") return json(200, { status: "ok" });

  if (route === "/api/setup" && method === "GET") {
    return json(200, { teacherExists: await teacherExists() });
  }

  const user = await currentUser(request);

  if (route === "/api/session" && method === "GET") {
    return json(200, {
      authenticated: Boolean(user),
      setupNeeded: !(await teacherExists()),
      user: user ? publicUser(user) : null,
      portalUrl: portalUrl(request)
    });
  }

  if (route === "/api/auth/bootstrap" && method === "POST") {
    const body = await readJson(request);
    const name = String(body.name || "").trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (!name || !validUsername(username) || password.length < 10 || password.length > 256) {
      return json(400, { error: "Informe nome, usuário válido e senha com 10 a 256 caracteres." });
    }
    return withLockedModel(async (tx, model) => {
      if (await teacherExists(tx)) return json(409, { error: "A conta de professor já foi configurada." });
      const [created] = await tx.insert(users).values({
        id: randomUUID(), name, username, role: "teacher", passwordHash: hashPassword(password)
      }).returning();
      model.profile = { ...model.profile, displayName: name, username, role: "teacher" };
      await writeModel(tx, model);
      const token = await createSession(created.id, tx);
      return json(201, { token, user: publicUser(created), model, portalUrl: portalUrl(request) });
    });
  }

  if (route === "/api/auth/login" && method === "POST") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const key = `${context.ip || "local"}:${username}`;
    const [previous] = await db.select().from(loginFailures).where(eq(loginFailures.key, key));
    const now = Date.now();
    if (previous && previous.resetAt.getTime() > now && previous.count >= 8) {
      return json(429, { error: "Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente." });
    }
    const [account] = await db.select().from(users).where(eq(users.username, username));
    const password = String(body.password || "");
    if (!account || password.length > 256 || !checkPassword(password, account.passwordHash)) {
      const active = previous && previous.resetAt.getTime() > now;
      const values = { key, count: active ? previous.count + 1 : 1, resetAt: active ? previous.resetAt : new Date(now + 15 * 60 * 1000) };
      await db.insert(loginFailures).values(values)
        .onConflictDoUpdate({ target: loginFailures.key, set: { count: values.count, resetAt: values.resetAt } });
      return json(401, { error: "Usuário ou senha incorretos." });
    }
    await db.delete(loginFailures).where(eq(loginFailures.key, key));
    await db.delete(loginFailures).where(lt(loginFailures.resetAt, new Date(now)));
    const [updated] = await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, account.id)).returning();
    const token = await createSession(account.id);
    return json(200, { token, user: publicUser(updated), model: modelFor(await readModel(), asUser(updated)), portalUrl: portalUrl(request) });
  }

  if (route === "/api/auth/logout" && method === "POST") {
    if (user) {
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
      const token = (request.headers.get("authorization") || "").slice(7);
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    }
    return json(200, { ok: true });
  }

  if (!user) return json(401, { error: "Entre na sua conta para continuar." });

  if (route === "/api/presence" && method === "POST") {
    const lastSeenAt = new Date();
    await db.update(users).set({ lastSeenAt }).where(eq(users.id, user.id));
    return json(200, { lastSeenAt: lastSeenAt.toISOString() });
  }

  if (route === "/api/notifications" && method === "GET") {
    const model = user.role === "student" ? await readModel() : null;
    if (model) {
      const now = Date.now();
      for (const exam of model.exercises || []) {
        const releaseAt = Date.parse(exam.assessment?.releaseAt || "");
        if (!exam.assessment || exam.published !== true || ["draft", "closed", "archived"].includes(exam.status)
          || (Number.isFinite(releaseAt) && releaseAt > now)) continue;
        await addNotification(db, user.id, "exam-released", "Uma avaliação foi liberada",
          `Você já pode responder “${exam.title}”.`, { examId: exam.id, exerciseId: exam.id },
          `exam-released:${user.id}:${exam.id}`);
      }
    }
    return json(200, { notifications: await notificationsFor(user) });
  }

  const notificationReadRoute = /^\/api\/notifications\/([^/]+)\/read$/.exec(route);
  if (notificationReadRoute && method === "POST") {
    const recipient = user.role === "teacher" ? "teacher" : user.id;
    const id = decodeURIComponent(notificationReadRoute[1]);
    const [row] = await db.select().from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.recipient, recipient)));
    if (!row) return json(404, { error: "Notificação não encontrada." });
    const notification = { ...(row.data as any) };
    notification.readAt ||= new Date().toISOString();
    await db.update(notifications).set({ data: notification }).where(eq(notifications.id, row.id));
    return json(200, { notification });
  }

  const reviewAttemptRoute = /^\/api\/attempts\/([^/]+)\/review$/.exec(route);
  if (reviewAttemptRoute && method === "POST" && user.role === "teacher") {
    const body = await readJson(request);
    return withLockedModel(async (tx, model) => {
      const attempt = (model.attempts || []).find((item: any) => item.id === reviewAttemptRoute[1]);
      if (!attempt || !attempt.studentId) return json(404, { error: "Resposta de aluno não encontrada." });
      attempt.reviewedAt ||= new Date().toISOString();
      attempt.teacherRating = Math.min(5, Math.max(0, Number(body.teacherRating) || 0));
      attempt.teacherNote = String(body.teacherNote || "").trim().slice(0, 1000);
      await writeModel(tx, model);
      const [student] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, attempt.studentId), eq(users.role, "student")));
      if (student) {
        await addNotification(tx, student.id, "response-reviewed", "Sua resposta foi vista",
          "O professor conferiu sua resposta. Continue acompanhando suas atividades.",
          { exerciseId: attempt.exerciseId, attemptId: attempt.id }, `response-reviewed:${attempt.id}`);
      }
      return json(200, { attempt });
    });
  }

  if (route === "/api/media" && method === "POST") {
    const body = await readJson(request);
    const id = String(body.id || "");
    const dataMatch = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(String(body.dataUrl || ""));
    if (!/^[a-z0-9._-]{1,120}$/i.test(id) || !dataMatch) {
      return json(400, { error: "O identificador ou o conteúdo do arquivo é inválido." });
    }
    const content = Buffer.from(dataMatch[2], "base64");
    if (!content.length || content.length > MAX_MEDIA_BYTES) {
      return json(413, { error: "Cada arquivo enviado ao servidor pode ter no máximo 4 MB." });
    }
    const name = String(body.name || "material").replace(/[\r\n]/g, "").slice(0, 180) || "material";
    const type = dataMatch[1].slice(0, 120);
    const [existing] = await db.select().from(media).where(eq(media.id, id));
    if (existing?.ownerId && existing.ownerId !== user.id) {
      return json(403, { error: "Este arquivo pertence a outra conta e não pode ser sobrescrito." });
    }
    await mediaStore().set(id, content.buffer.slice(content.byteOffset, content.byteOffset + content.length) as ArrayBuffer);
    const record = { id, name, type, size: content.length, ownerId: existing?.ownerId || user.id, updatedAt: new Date() };
    await db.insert(media).values(record).onConflictDoUpdate({
      target: media.id, set: { name, type, size: content.length, ownerId: record.ownerId, updatedAt: record.updatedAt }
    });
    return json(201, { id, name, type, size: content.length });
  }

  const mediaRoute = /^\/api\/media\/([^/]+)$/.exec(route);
  if (mediaRoute && method === "GET") {
    let id: string;
    try { id = decodeURIComponent(mediaRoute[1]); }
    catch { return json(400, { error: "Identificador de arquivo inválido." }); }
    if (user.role !== "teacher" && !referencedMediaIds(modelFor(await readModel(), asUser(user))).has(id)) {
      return json(404, { error: "Arquivo não encontrado." });
    }
    const [record] = await db.select().from(media).where(eq(media.id, id));
    const content = record ? await mediaStore().get(id, { type: "arrayBuffer" }) : null;
    if (!record || !content) return json(404, { error: "Arquivo não encontrado no servidor." });
    return new Response(content, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`,
        "Content-Type": /^[a-z0-9.+/-]+$/i.test(record.type) ? record.type : "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "X-Media-Name": encodeURIComponent(record.name)
      }
    });
  }

  if (route === "/api/account/profile" && method === "PUT") {
    const body = await readJson(request);
    const name = String(body.name || "").trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    if (!name || !validUsername(username)) {
      return json(400, { error: "Informe um nome e um nome de usuário válido." });
    }
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (taken && taken.id !== user.id) return json(409, { error: "Esse nome de usuário já está em uso." });
    return withLockedModel(async (tx, model) => {
      const [updated] = await tx.update(users).set({ name, username }).where(eq(users.id, user.id)).returning();
      if (user.role === "teacher") {
        model.profile.displayName = name;
        model.profile.username = username;
      } else {
        for (const attempt of model.attempts || []) {
          if (attempt.studentId === user.id) attempt.profileName = name;
        }
      }
      await writeModel(tx, model);
      return json(200, { user: publicUser(updated), previousName: user.name });
    });
  }

  if (route === "/api/model" && method === "GET") {
    return json(200, { model: modelFor(await readModel(), asUser(user)) });
  }

  if (route === "/api/model" && method === "PUT") {
    if (user.role !== "teacher") return json(403, { error: "Apenas o professor pode publicar o conteúdo da turma." });
    const body = await readJson(request);
    const model = body.model;
    if (!model || !Array.isArray(model.blocks) || !Array.isArray(model.lessons)
        || !Array.isArray(model.exercises) || !Array.isArray(model.attempts)
        || (model.exerciseBlocks !== undefined && !Array.isArray(model.exerciseBlocks))) {
      return json(400, { error: "O conteúdo enviado está incompleto ou inválido." });
    }
    model.exerciseBlocks ||= [];
    return withLockedModel(async (tx, previous) => {
      const personalExercises = (previous.exercises || []).filter((item: any) => item.personalizedFor);
      const personalExerciseIds = new Set(personalExercises.map((item: any) => item.id));
      model.exercises = model.exercises.filter((item: any) => !item.personalizedFor);
      for (const exercise of personalExercises) {
        if (!model.exercises.some((item: any) => item.id === exercise.id)) model.exercises.push(exercise);
      }
      const storedStudentAttempts = (previous.attempts || []).filter((item: any) => item.studentId
        || personalExerciseIds.has(item.exerciseId));
      for (const attempt of storedStudentAttempts) {
        if (!model.attempts.some((item: any) => item.id === attempt.id)) model.attempts.push(attempt);
      }
      const previousPublished = new Set([
        ...(previous.lessons || []).filter((item: any) => item.published).map((item: any) => `lesson:${item.id}`),
        ...(previous.exercises || []).filter((item: any) => item.published && !["draft", "archived"].includes(item.status))
          .map((item: any) => `exercise:${item.id}`)
      ]);
      await writeModel(tx, model);
      const newlyPublished = [
        ...(model.lessons || []).filter((item: any) => item.published && !previousPublished.has(`lesson:${item.id}`))
          .map((item: any) => ({ key: `lesson:${item.id}`, type: "new-lesson", title: "Aula nova disponível", name: item.title })),
        ...(model.exercises || []).filter((item: any) => item.published && !["draft", "closed", "archived"].includes(item.status)
          && !previousPublished.has(`exercise:${item.id}`))
          .filter((item: any) => !item.assessment || !item.assessment.releaseAt || Date.parse(item.assessment.releaseAt) <= Date.now())
          .map((item: any) => ({ key: `exercise:${item.id}`, type: item.assessment ? "exam-released" : "new-exercise", title: item.assessment ? "Avaliação liberada" : "Exercício novo disponível", name: item.title }))
      ];
      const students = await tx.select({ id: users.id }).from(users).where(eq(users.role, "student"));
      for (const student of students) {
        for (const item of newlyPublished) {
          await addNotification(tx, student.id, item.type, item.title, `${item.name} já está disponível para você.`, { contentKey: item.key });
        }
        for (const step of model.trails || []) {
          if (step.studentId === student.id && !(previous.trails || []).some((item: any) => item.id === step.id)) {
            await addNotification(tx, student.id, "trail-update", "Sua trilha ganhou uma etapa",
              `${step.title} foi adicionada à sua trilha.`, { trailId: step.id, contentKey: step.blockId });
          }
        }
      }
      return json(200, { saved: true });
    });
  }

  if (route === "/api/students" && method === "GET" && user.role === "teacher") {
    const rows = await db.select().from(users).where(eq(users.role, "student"));
    const active = new Set((await db.select({ userId: sessions.userId }).from(sessions)).map(row => row.userId));
    const students = rows.map(student => ({
      ...publicUser(student),
      lastSeenAt: iso(student.lastSeenAt),
      online: active.has(student.id) && Boolean(student.lastSeenAt) && Date.now() - student.lastSeenAt!.getTime() < 120_000
    }));
    return json(200, { students });
  }

  if (route === "/api/students" && method === "POST" && user.role === "teacher") {
    const body = await readJson(request);
    const name = String(body.name || "").trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (!name || !validUsername(username) || password.length < 10 || password.length > 256) {
      return json(400, { error: "Informe nome, usuário de 3 a 30 caracteres e senha de 10 a 256 caracteres." });
    }
    const [created] = await db.insert(users).values({
      id: randomUUID(), name, username, role: "student", passwordHash: hashPassword(password)
    }).onConflictDoNothing({ target: users.username }).returning();
    if (!created) return json(409, { error: "Esse nome de usuário já está em uso." });
    return json(201, { student: publicUser(created), portalUrl: portalUrl(request) });
  }

  const examOpenRoute = /^\/api\/exams\/([^/]+)\/open$/.exec(route);
  if (examOpenRoute && method === "POST" && user.role === "student") {
    const model = await readModel();
    const exam = model?.exercises.find((item: any) => item.id === examOpenRoute[1] && item.assessment);
    if (!exam || exam.published !== true || ["draft", "closed", "archived"].includes(exam.status)) {
      return json(404, { error: "Avaliação não encontrada ou ainda não publicada." });
    }
    const now = Date.now();
    const releaseAt = Date.parse(exam.assessment.releaseAt || "");
    const deadlineAt = Date.parse(exam.assessment.deadlineAt || "");
    if (Number.isFinite(releaseAt) && releaseAt > now) {
      return json(200, { notReleased: true, releaseAt: exam.assessment.releaseAt });
    }
    if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= now) {
      return json(410, { error: "O prazo desta avaliação terminou." });
    }
    let session = await findExamSession(exam.id, user.id);
    if (session && exam.assessment.lockOnExit !== false && !session.locked
      && now - session.lastSeenAt.getTime() > 180_000) {
      await lockExamForInactivity(user, exam);
      session = { ...session, locked: true };
    }
    return json(200, {
      locked: Boolean(session?.locked), session: publicExamSession(session),
      exercise: {
        ...exam,
        questionCount: exam.questions.length,
        questions: exam.questions.map((question: any) => {
          const safeQuestion = { ...question };
          for (const key of ["answer", "acceptedAnswers", "expectedNotes", "expectedIntervals", "assemblyOrder", "referenceNotes", "feedback"]) {
            delete safeQuestion[key];
          }
          return safeQuestion;
        })
      }
    });
  }

  const examStartRoute = /^\/api\/exams\/([^/]+)\/start$/.exec(route);
  if (examStartRoute && method === "POST" && user.role === "student") {
    const model = await readModel();
    const exam = model?.exercises.find((item: any) => item.id === examStartRoute[1] && item.assessment);
    if (!exam || exam.published !== true || ["draft", "closed", "archived"].includes(exam.status)) {
      return json(404, { error: "Avaliação não encontrada." });
    }
    const now = new Date();
    const releaseAt = Date.parse(exam.assessment.releaseAt || "");
    const deadlineAt = Date.parse(exam.assessment.deadlineAt || "");
    if (Number.isFinite(releaseAt) && releaseAt > now.getTime()) return json(423, { error: "Esta avaliação ainda não foi liberada." });
    if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= now.getTime()) return json(410, { error: "O prazo desta avaliação terminou." });
    const existing = await findExamSession(exam.id, user.id);
    if (existing?.locked) return json(423, { error: "Esta avaliação está bloqueada. Solicite a reabertura ao professor." });
    const [session] = existing
      ? await db.update(examSessions).set({ lastSeenAt: now })
          .where(and(eq(examSessions.examId, exam.id), eq(examSessions.studentId, user.id))).returning()
      : await db.insert(examSessions).values({ examId: exam.id, studentId: user.id, startedAt: now, lastSeenAt: now, locked: false })
          .onConflictDoUpdate({ target: [examSessions.examId, examSessions.studentId], set: { lastSeenAt: now } }).returning();
    return json(200, { session: publicExamSession(session) });
  }

  const examHeartbeatRoute = /^\/api\/exams\/([^/]+)\/heartbeat$/.exec(route);
  if (examHeartbeatRoute && method === "POST" && user.role === "student") {
    const model = await readModel();
    const exam = model?.exercises.find((item: any) => item.id === examHeartbeatRoute[1] && item.assessment);
    const session = await findExamSession(examHeartbeatRoute[1], user.id);
    if (!exam || !session || session.locked) return json(423, { error: "Esta avaliação está bloqueada." });
    const now = new Date();
    if (exam.assessment?.lockOnExit !== false && now.getTime() - session.lastSeenAt.getTime() > 180_000) {
      await lockExamForInactivity(user, exam);
      return json(423, { error: "A avaliação foi bloqueada por inatividade." });
    }
    await db.update(examSessions).set({ lastSeenAt: now })
      .where(and(eq(examSessions.examId, exam.id), eq(examSessions.studentId, user.id)));
    return json(200, { lastSeenAt: now.toISOString() });
  }

  const examReopenRoute = /^\/api\/exams\/([^/]+)\/request-reopen$/.exec(route);
  if (examReopenRoute && method === "POST" && user.role === "student") {
    const body = await readJson(request);
    const reason = String(body.reason || "").trim().slice(0, 500);
    const session = await findExamSession(examReopenRoute[1], user.id);
    const model = await readModel();
    const exam = model?.exercises.find((item: any) => item.id === examReopenRoute[1] && item.assessment);
    if (!session?.locked || !exam) return json(409, { error: "Não há uma avaliação bloqueada para reabrir." });
    if (reason.length < 5) return json(400, { error: "Explique o motivo com pelo menos 5 caracteres." });
    const teacherRows = await db.select().from(notifications).where(eq(notifications.recipient, "teacher"));
    const existing = teacherRows.find(row => {
      const item = row.data as any;
      return item.type === "exam-reopen-request" && item.examId === exam.id && item.studentId === user.id && !item.resolvedAt;
    });
    if (existing) {
      const createdAt = new Date();
      const data = {
        ...(existing.data as any), title: "Solicitação para reabrir avaliação", message: `${user.name}: ${reason}`,
        reason, createdAt: createdAt.toISOString(), readAt: ""
      };
      await db.update(notifications).set({ data, createdAt }).where(eq(notifications.id, existing.id));
    } else {
      await addNotification(db, "teacher", "exam-reopen-request", "Solicitação para reabrir avaliação",
        `${user.name}: ${reason}`, { examId: exam.id, studentId: user.id, studentName: user.name, examTitle: exam.title, reason });
    }
    return json(201, { requested: true });
  }

  if (route === "/api/exams/unlock" && method === "POST" && user.role === "teacher") {
    const body = await readJson(request);
    const examId = String(body.examId || "");
    const studentId = String(body.studentId || "");
    const session = await findExamSession(examId, studentId);
    const [student] = await db.select().from(users).where(and(eq(users.id, studentId), eq(users.role, "student")));
    const model = await readModel();
    const exam = model?.exercises.find((item: any) => item.id === examId && item.assessment);
    if (!session?.locked || !student || !exam) return json(404, { error: "Solicitação de reabertura não encontrada." });
    const now = new Date();
    await db.update(examSessions).set({ locked: false, lastSeenAt: now })
      .where(and(eq(examSessions.examId, examId), eq(examSessions.studentId, studentId)));
    const teacherRows = await db.select().from(notifications).where(eq(notifications.recipient, "teacher"));
    for (const row of teacherRows) {
      const item = row.data as any;
      if (item.type === "exam-reopen-request" && item.examId === exam.id && item.studentId === student.id) {
        await db.update(notifications).set({ data: { ...item, resolvedAt: now.toISOString() } }).where(eq(notifications.id, row.id));
      }
    }
    await addNotification(db, student.id, "exam-reopened", "Sua avaliação foi reaberta",
      `O professor liberou novamente “${exam.title}”.`, { examId: exam.id, exerciseId: exam.id });
    return json(200, { unlocked: true });
  }

  const studentRoute = /^\/api\/students\/([^/]+)$/.exec(route);
  if (studentRoute && method === "DELETE" && user.role === "teacher") {
    const studentId = decodeURIComponent(studentRoute[1]);
    return withLockedModel(async (tx, model) => {
      const [removed] = await tx.delete(users).where(and(eq(users.id, studentId), eq(users.role, "student"))).returning();
      if (!removed) return json(404, { error: "Conta de aluno não encontrada." });
      model.attempts = (model.attempts || []).filter((attempt: any) => attempt.studentId !== removed.id);
      await writeModel(tx, model);
      return json(200, { ok: true });
    });
  }

  if (route === "/api/practice/request" && method === "POST" && user.role === "student") {
    const body = await readJson(request);
    return withLockedModel(async (tx, model) => {
      const lesson = (model.lessons || []).find((item: any) => item.id === body.lessonId && item.published === true);
      if (!lesson) return json(404, { error: "Aula publicada não encontrada." });
      const sourceExercises = (model.exercises || []).filter((item: any) => item.published === true
        && !item.assessment && !item.personalizedFor && !["draft", "closed", "archived"].includes(item.status)
        && (item.lessonIds || []).includes(lesson.id));
      const questionPool = sourceExercises.flatMap((exercise: any) => (exercise.questions || []).map((question: any) => ({
        ...question,
        sourceExerciseId: exercise.id,
        sourceExerciseTitle: exercise.title,
        sourceLessonId: lesson.id,
        sourceLessonTitle: lesson.title,
        sourceBlockId: lesson.blockId
      })));
      if (!questionPool.length) return json(409, { error: "Esta aula ainda não tem questões publicadas relacionadas." });
      for (let index = questionPool.length - 1; index > 0; index -= 1) {
        const swap = randomInt(index + 1);
        [questionPool[index], questionPool[swap]] = [questionPool[swap], questionPool[index]];
      }
      const exercise = {
        id: randomUUID(), title: `Prática · ${lesson.title}`,
        instructions: `Lista personalizada com questões de ${lesson.title}.`,
        difficulty: "Geral", status: "published", published: true, showAnswers: false,
        lessonIds: [], questions: questionPool.slice(0, 10).map((question: any) => ({ ...question, id: randomUUID() })),
        personalizedFor: user.id, sourceLessonId: lesson.id, createdAt: new Date().toISOString()
      };
      model.exercises.push(exercise);
      await writeModel(tx, model);
      return json(201, { exercise });
    });
  }

  if (route === "/api/attempts" && method === "POST" && user.role === "student") {
    const body = await readJson(request);
    const source = body.attempt;
    const examSessionRow = source?.exerciseId ? await findExamSession(String(source.exerciseId), user.id) : undefined;
    return withLockedModel(async (tx, model) => {
      const exercise = (model.exercises || []).find((item: any) => item.id === source?.exerciseId);
      if (!exercise || exercise.published !== true || ["draft", "archived", "closed"].includes(exercise.status)
          || !Array.isArray(source.answers)) {
        return json(404, { error: "Exercício publicado não encontrado." });
      }
      const examSession = exercise.assessment ? publicExamSession(examSessionRow) : null;
      if (exercise.assessment) {
        const deadlineAt = Date.parse(exercise.assessment.deadlineAt || "");
        const startedAt = Date.parse(examSession?.startedAt || "");
        if (!examSession || examSession.locked || !Number.isFinite(startedAt)) {
          return json(423, { error: "Abra a avaliação para iniciar ou solicite a liberação ao professor." });
        }
        if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= Date.now()) {
          return json(410, { error: "O prazo desta avaliação terminou." });
        }
        const durationLimit = Math.max(1, Number(exercise.assessment.durationMinutes) || 1) * 60;
        if ((Date.now() - startedAt) / 1000 > durationLimit) {
          return json(410, { error: "O tempo desta avaliação terminou." });
        }
      }
      const allowedQuestions = new Map<string, any>(exercise.questions.map((question: any) => [question.id, question]));
      for (const answer of source.answers) {
        const question = allowedQuestions.get(answer.questionId);
        if (question?.type !== "rhythm") continue;
        const maxExecutions = Math.min(10, Math.max(1, Number(question.retryLimit) || 3));
        if (!Array.isArray(answer.value?.plays) || !answer.value.plays.length
            || answer.value.plays.length > maxExecutions) {
          return json(400, { error: `A atividade rítmica precisa conter entre 1 e ${maxExecutions} execução(ões).` });
        }
        const attemptsUsed = model.attempts.reduce((total: number, attempt: any) => total + (attempt.studentId === user.id
          && attempt.exerciseId === exercise.id
          ? (attempt.answers || []).filter((previous: any) => previous.questionId === question.id)
            .reduce((count: number, previous: any) => count + (Array.isArray(previous.value?.plays) ? previous.value.plays.length : 1), 0)
          : 0), 0);
        if (attemptsUsed + answer.value.plays.length > maxExecutions) {
          return json(409, { error: `Você já usou as ${maxExecutions} execuções permitidas nesta questão rítmica.` });
        }
      }
      const configuredOctave = Number(model.profile?.defaultOctave);
      const defaultOctave = Number.isInteger(configuredOctave) && configuredOctave >= -1 && configuredOctave <= 8
        ? configuredOctave
        : 4;
      const answers = source.answers.filter((answer: any) => allowedQuestions.has(answer.questionId)).map((answer: any) => {
        const question = allowedQuestions.get(answer.questionId);
        const points = Math.max(0, Number(question.points) || 0);
        const correct = gradeAnswer(question, answer.value, defaultOctave);
        return {
          questionId: question.id,
          prompt: question.prompt,
          points,
          value: question.type === "rhythm" ? normalizeRhythmAnswer(question, answer.value) : answer.value,
          correct: Boolean(correct),
          manual: correct === null,
          manualScore: 0
        };
      });
      if (!answers.length) return json(400, { error: "A tentativa não contém respostas válidas." });
      const attachments = Array.isArray(source.attachments)
        ? source.attachments.map((item: any) => ({
            id: String(item.id || ""),
            name: String(item.name || "arquivo").replace(/[\r\n]/g, "").slice(0, 180),
            type: String(item.type || "application/octet-stream").slice(0, 120),
            size: Math.max(0, Number(item.size) || 0)
          })).filter((item: any) => /^[a-z0-9._-]{1,120}$/i.test(item.id))
        : [];
      const attempt = {
        id: randomUUID(),
        exerciseId: exercise.id,
        studentId: user.id,
        profileName: user.name,
        answers,
        attachments,
        score: answers.reduce((sum: number, answer: any) => sum + (answer.correct && !answer.manual ? answer.points : 0), 0),
        maxScore: answers.reduce((sum: number, answer: any) => sum + answer.points, 0),
        startedAt: examSession?.startedAt || (typeof source.startedAt === "string" ? source.startedAt : ""),
        durationSeconds: Math.min(86_400, Math.max(0, examSession
          ? Math.round((Date.now() - Date.parse(examSession.startedAt!)) / 1000)
          : Number(source.durationSeconds) || 0)),
        createdAt: new Date().toISOString()
      };
      model.attempts.push(attempt);
      await writeModel(tx, model);
      await addNotification(tx, "teacher", "response-submitted", "Nova resposta de aluno",
        `${user.name} respondeu “${exercise.title}”.`,
        { exerciseId: exercise.id, attemptId: attempt.id, studentId: user.id });
      return json(201, { attempt });
    });
  }

  return json(404, { error: "Rota não encontrada." });
}

export default async (request: Request, context: Context) => {
  try {
    return await handle(request, context);
  } catch (error: any) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    if (error?.code === "23505") return json(409, { error: "Esse nome de usuário já está em uso." });
    console.error("Falha ao processar API do Notarium:", error);
    return json(500, { error: "Erro interno do servidor." });
  }
};

export const config: Config = {
  path: "/api/*"
};
