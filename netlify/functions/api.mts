import { Readable } from 'node:stream';
import { createHash, timingSafeEqual } from 'node:crypto';
import { admin, getUser, login, logout, refreshSession, verifyRequestOrigin } from '@netlify/identity';
import { eq } from 'drizzle-orm';
import { loginAttempts, classroom } from '../../db/schema';
import { withClassroom, mediaStore } from '../lib/classroom';
import server from '../../notarium-server.js';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const normalize = (value: unknown) => String(value || '').trim().replace(/^@/, '').toLowerCase();
const validUsername = (value: string) => /^[a-z0-9._-]{3,30}$/.test(value);
const alias = (id: string) => `${id}@accounts.notarium.invalid`;
const teacherUsername = 'prof.ravette';
const sameSecret = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

async function createIdentity(id: string, password: string) {
  try {
    return await admin.createUser({ email: alias(id), password });
  } catch (error: any) {
    // Recover only a previously provisioned internal account if a DB commit failed.
    if (![422, 409].includes(error.status)) throw error;
    for (let page = 1; ; page++) {
      const batch = await admin.listUsers({ page, perPage: 100 });
      const existing = batch.find(user => user.email === alias(id));
      if (existing) {
        await admin.updateUser(existing.id, { password, confirm: true });
        return existing;
      }
      if (batch.length < 100) throw error;
    }
  }
}

export default async (request: Request, context: any) => {
  const url = new URL(request.url);
  const route = url.pathname;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    try { verifyRequestOrigin(request); }
    catch { return json({ error: 'Origem da solicitação não permitida.' }, 403); }
  }
  if (Number(request.headers.get('content-length')) > 5 * 1024 * 1024) return json({ error: 'Envie arquivos de até 3 MB.' }, 413);
  try {
    let identity = await getUser();
    if (!identity && context.cookies.get('nf_refresh')) {
      try { await refreshSession(); identity = await getUser(); } catch { /* login screen handles expiry */ }
    }
    return await withClassroom(async (store, persist, tx) => {
      let user = identity ? store.users.find((item: any) => item.id === identity.id) : null;
      const api = () => server.createApi({ store, userId: user?.id, persist, origin: url.origin });
      if (route === '/api/setup' && method === 'GET') {
        // The teacher handle is reserved; there is no public administrator signup.
        return json({ teacherExists: true });
      }
      if (route === '/api/session' && method === 'GET') return json({ authenticated: !!user, setupNeeded: false, user: user ? api().publicUser(user) : null });
      if (route === '/api/auth/bootstrap') return json({ error: 'Entre com a conta de professor configurada para o site.' }, 403);
      if (route === '/api/auth/login' && method === 'POST') {
        const body = await request.json();
        const username = normalize(body.username);
        const password = String(body.password || '');
        if (!validUsername(username) || !password || password.length > 256) return json({ error: 'Usuário ou senha incorretos.' }, 401);
        const key = createHash('sha256').update(`${context.ip || 'unknown'}:${username}`).digest('hex');
        const [previous] = await tx.select().from(loginAttempts).where(eq(loginAttempts.id, key));
        if (previous && previous.resetAt > new Date() && previous.count >= 8) return json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
        const count = previous && previous.resetAt > new Date() ? previous.count + 1 : 1;
        await tx.insert(loginAttempts).values({ id: key, count, resetAt: new Date(Date.now() + 900000) })
          .onConflictDoUpdate({ target: loginAttempts.id, set: { count, resetAt: previous && previous.resetAt > new Date() ? previous.resetAt : new Date(Date.now() + 900000) } });
        user = store.users.find((item: any) => item.username === username);
        if (!user && username === teacherUsername && !store.users.some((item: any) => item.role === 'teacher')) {
          const initialPassword = Netlify.env.get('NOTARIUM_TEACHER_PASSWORD');
          if (!initialPassword) return json({ error: 'A conta principal ainda precisa de configuração protegida na hospedagem. Contate o responsável pelo site.' }, 503);
          if (!sameSecret(password, initialPassword)) return json({ error: 'Usuário ou senha incorretos.' }, 401);
          const created = await createIdentity('teacher', password);
          user = { id: created.id, authKey: 'teacher', username: teacherUsername, name: 'Professor Ravette', role: 'teacher', createdAt: new Date().toISOString(), profile: {} };
          store.users.push(user);
          await persist(store);
        }
        // Login failures are returned normally so the transaction commits the rate limit.
        if (!user) return json({ error: 'Usuário ou senha incorretos.' }, 401);
        try { await login(alias(user.authKey), password); }
        catch { return json({ error: 'Usuário ou senha incorretos.' }, 401); }
        await tx.delete(loginAttempts).where(eq(loginAttempts.id, key));
        user.lastSeenAt = new Date().toISOString();
        await persist(store);
        return json({ token: 'cookie', user: api().publicUser(user), model: api().modelFor(user), portalUrl: `${url.origin}/login` });
      }
      if (!user) return json({ error: 'Entre na sua conta para continuar.' }, 401);
      if (route === '/api/auth/logout' && method === 'POST') {
        await logout();
        return json({ ok: true });
      }
      if (route === '/api/students' && method === 'POST') {
        if (user.role !== 'teacher') return json({ error: 'Apenas o professor pode criar acessos.' }, 403);
        const body = await request.json();
        const username = normalize(body.username);
        const name = String(body.name || '').trim().slice(0, 60);
        const password = String(body.password || '');
        if (!name || !validUsername(username) || password.length < 6 || password.length > 256) return json({ error: 'Informe nome, usuário válido e senha de 6 a 256 caracteres.' }, 400);
        if (store.users.some((item: any) => item.username === username)) return json({ error: 'Esse nome de usuário já está em uso.' }, 409);
        // Stable internal alias permits recovery if provisioning succeeds but the DB commit fails.
        const accountKey = createHash('sha256').update(username).digest('hex');
        const created = await createIdentity(accountKey, password);
        const student = { id: created.id, authKey: accountKey, name, username, role: 'student', profile: {}, createdAt: new Date().toISOString() };
        store.users.push(student);
        await persist(store);
        return json({ student: api().publicUser(student), portalUrl: `${url.origin}/login` }, 201);
      }
      if (route === '/api/students' && method === 'GET' && user.role === 'teacher') {
        return json({ students: store.users.filter((item: any) => item.role === 'student').map((item: any) => ({ ...api().publicUser(item), lastSeenAt: item.lastSeenAt, online: Date.now() - Date.parse(item.lastSeenAt || '') < 120000 })) });
      }
      if (route === '/api/model' && method === 'PUT' && user.role === 'teacher') {
        const copy = await request.clone().json();
        user.profile = { ...user.profile, theme: copy.model?.profile?.theme === 'dark' ? 'dark' : 'light', defaultOctave: Number.isInteger(copy.model?.profile?.defaultOctave) ? Math.max(0, Math.min(8, copy.model.profile.defaultOctave)) : 4 };
      }
      if (route === '/api/account/profile' && method === 'PUT') {
        const copy = await request.clone().json();
        if (user.role === 'teacher' && normalize(copy.username) !== teacherUsername) return json({ error: 'O usuário da conta principal é fixo.' }, 400);
      }
      if (route === '/api/backup/status' && method === 'GET' && user.role === 'teacher') {
        const configured = !!(Netlify.env.get('NOTARIUM_GITHUB_BACKUP_TOKEN') && Netlify.env.get('NOTARIUM_GITHUB_BACKUP_REPOSITORY') && Netlify.env.get('NOTARIUM_BACKUP_ENCRYPTION_KEY'));
        const [last] = await tx.select().from(classroom).where(eq(classroom.id, 'backup-status'));
        return json({ configured, last: last?.data || null });
      }
      if (route === '/api/preferences' && method === 'PUT') {
        const body = await request.json();
        user.profile = { ...user.profile, theme: body.theme === 'dark' ? 'dark' : 'light', defaultOctave: Number.isInteger(body.defaultOctave) ? Math.max(0, Math.min(8, body.defaultOctave)) : 4 };
        if (user.role === 'student') {
          const progress = new Map((Array.isArray(body.trails) ? body.trails : []).map((item: any) => [item.id, item]));
          for (const step of store.model?.trails || []) {
            const update: any = progress.get(step.id);
            if (step.studentId === user.id && update) {
              step.status = ['pending', 'in_progress', 'completed'].includes(update.status) ? update.status : 'pending';
              step.completed = step.status === 'completed';
              step.completedAt = step.completed ? (step.completedAt || new Date().toISOString()) : '';
            }
          }
        }
        await persist(store);
        return json({ saved: true });
      }
      // Adapt the existing, permission-checked lesson/exercise/assessment API.
      const raw = Buffer.from(await request.arrayBuffer());
      if (raw.length > 5 * 1024 * 1024) return json({ error: 'Envie arquivos de até 3 MB.' }, 413);
      const incoming: any = Readable.from([raw]);
      incoming.method = method;
      incoming.headers = Object.fromEntries(request.headers);
      incoming.socket = { remoteAddress: context.ip || '' };
      const chunks: Buffer[] = [];
      let status = 200;
      const headers = new Headers();
      const response = {
        writeHead(code: number, values: Record<string, any>) { status = code; for (const [key, value] of Object.entries(values)) headers.set(key, String(value)); },
        setHeader(key: string, value: string) { headers.set(key, value); },
        end(value?: any) { if (value !== undefined) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value))); },
      };
      const mediaId = /^\/api\/media\/([^/]+)$/.exec(route)?.[1];
      if (mediaId && method === 'GET') {
        const record = store.media.find((item: any) => item.id === decodeURIComponent(mediaId));
        if (record) {
          const content = await mediaStore().get(record.id, { type: 'arrayBuffer' });
          if (content) record.data = Buffer.from(content).toString('base64');
          else return json({ error: 'Arquivo não encontrado.' }, 404);
        }
      }
      await api().handleApi(incoming, response, url);
      return new Response(Buffer.concat(chunks), { status, headers });
    });
  } catch {
    return json({ error: 'Não foi possível concluir a solicitação. Tente novamente.' }, 500);
  }
};

export const config = { path: '/api/*' };
