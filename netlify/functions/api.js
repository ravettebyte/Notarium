const crypto = require('node:crypto');
const { getStore } = require('@netlify/blobs');

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const response = (statusCode, value, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  body: typeof value === 'string' ? value : JSON.stringify(value)
});

function emptyModel() {
  return {
    schemaVersion: 1,
    profile: { displayName: 'Músico', username: '', bio: '', avatarDataUrl: '', defaultOctave: 4, role: 'teacher', theme: 'light' },
    blocks: [], exerciseBlocks: [], lessons: [], exercises: [], attempts: [], trails: [], trailSettings: []
  };
}

async function readStore(store, key, fallback = null) {
  try { return (await store.get(key, { type: 'json' })) ?? fallback; } catch { return fallback; }
}
async function writeStore(store, key, value) { await store.setJSON(key, value); }
const publicUser = user => ({ id: user.id, name: user.name, username: user.username, role: user.role });
const authorization = event => String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '').trim();

async function getSession(store, event) {
  const token = authorization(event);
  return token ? readStore(store, `session:${token}`, null) : null;
}

async function ensureTeacher(store, env) {
  const password = String(env.NOTARIUM_TEACHER_PASSWORD || '').trim();
  if (!password) return false;
  const username = String(env.NOTARIUM_TEACHER_USERNAME || 'prof.ravette').trim().toLowerCase();
  const name = String(env.NOTARIUM_TEACHER_NAME || 'Professor Ravette').trim() || 'Professor Ravette';
  let teacher = await readStore(store, 'teacher', null);
  const passwordHash = hash(password);
  if (!teacher) {
    teacher = { id: id('professor'), name, username, role: 'teacher', passwordHash, createdAt: new Date().toISOString() };
    await writeStore(store, 'teacher', teacher);
    await writeStore(store, 'model', emptyModel());
    await writeStore(store, 'students', []);
  } else if (teacher.name !== name || teacher.username !== username || teacher.passwordHash !== passwordHash) {
    await writeStore(store, 'teacher', { ...teacher, name, username, passwordHash });
  }
  return true;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }, body: '' };
  }

  const store = getStore({ name: 'notarium', consistency: 'strong' });
  await ensureTeacher(store, { ...process.env, ...context?.env });

  let rawPath = String(event.path || '');
  if (rawPath.includes('/.netlify/functions/api')) rawPath = rawPath.split('/.netlify/functions/api')[1] || '/api';
  const path = (rawPath.replace(/\/+$/, '') || '/');
  const method = event.httpMethod || 'GET';
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    } catch {}
  }
  const origin = `https://${event.headers.host || event.headers.Host || ''}`;

  if (path === '/api/setup' && method === 'GET') {
    return response(200, { teacherExists: Boolean(await readStore(store, 'teacher', null)) });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const username = String(body.username || '').trim().toLowerCase();
    const passwordHash = hash(String(body.password || ''));
    const teacher = await readStore(store, 'teacher', null);
    const students = await readStore(store, 'students', []);
    const user = teacher && teacher.username === username && teacher.passwordHash === passwordHash
      ? teacher
      : students.find(student => student.username === username && student.passwordHash === passwordHash);
    if (!user) return response(401, { error: 'Usuário ou senha incorretos.' });
    if (user.role === 'student') {
      await writeStore(store, 'students', students.map(student => student.id === user.id ? { ...student, lastSeenAt: new Date().toISOString() } : student));
    }
    const token = id('sessao');
    await writeStore(store, `session:${token}`, { ...publicUser(user), teacherId: teacher?.id || null });
    return response(200, { token, user: publicUser(user), model: await readStore(store, 'model', emptyModel()), portalUrl: origin });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const token = authorization(event);
    if (token) await store.delete(`session:${token}`);
    return response(200, { ok: true });
  }

  const session = await getSession(store, event);
  if (!session) return response(401, { error: 'Faça login novamente.' });

  if (path === '/api/model' && method === 'GET') return response(200, { model: await readStore(store, 'model', emptyModel()) });
  if (path === '/api/model' && method === 'PUT') {
    if (session.role !== 'teacher') return response(403, { error: 'Somente o professor pode alterar o conteúdo.' });
    if (!body.model || typeof body.model !== 'object') return response(400, { error: 'Modelo inválido.' });
    await writeStore(store, 'model', body.model);
    return response(200, { ok: true, model: body.model });
  }

  if (path === '/api/students' && method === 'GET') {
    if (session.role !== 'teacher') return response(403, { error: 'Acesso reservado ao professor.' });
    const students = await readStore(store, 'students', []);
    return response(200, { students: students.map(({ passwordHash, ...student }) => student) });
  }
  if (path === '/api/students' && method === 'POST') {
    if (session.role !== 'teacher') return response(403, { error: 'Acesso reservado ao professor.' });
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || !/^[a-z0-9._-]{3,30}$/i.test(username) || password.length < 10) return response(400, { error: 'Informe nome, usuário válido e senha com pelo menos 10 caracteres.' });
    const students = await readStore(store, 'students', []);
    if (students.some(student => student.username === username)) return response(409, { error: 'Esse nome de usuário já está sendo usado.' });
    const student = { id: id('aluno'), name, username, role: 'student', passwordHash: hash(password), createdAt: new Date().toISOString(), lastSeenAt: null };
    await writeStore(store, 'students', [...students, student]);
    const { passwordHash, ...publicStudent } = student;
    return response(201, { student: publicStudent, portalUrl: origin });
  }
  if (path.startsWith('/api/students/') && method === 'DELETE') {
    if (session.role !== 'teacher') return response(403, { error: 'Acesso reservado ao professor.' });
    const studentId = decodeURIComponent(path.split('/').pop());
    const students = await readStore(store, 'students', []);
    await writeStore(store, 'students', students.filter(student => student.id !== studentId));
    return response(200, { ok: true });
  }

  if (path === '/api/account/profile' && method === 'PUT') {
    const model = await readStore(store, 'model', emptyModel());
    model.profile = { ...model.profile, ...body };
    await writeStore(store, 'model', model);
    return response(200, { ok: true, model });
  }
  if (path === '/api/attempts' && method === 'POST') {
    const model = await readStore(store, 'model', emptyModel());
    const attempt = { ...body, id: body.id || id('tentativa'), createdAt: new Date().toISOString(), profileId: session.id };
    model.attempts = [...(model.attempts || []).filter(item => item.id !== attempt.id), attempt];
    await writeStore(store, 'model', model);
    return response(200, { attempt, model });
  }
  if (path.startsWith('/api/attempts/') && path.endsWith('/review') && method === 'PUT') {
    if (session.role !== 'teacher') return response(403, { error: 'Somente o professor pode corrigir respostas.' });
    const attemptId = path.split('/').at(-2);
    const model = await readStore(store, 'model', emptyModel());
    model.attempts = (model.attempts || []).map(attempt => attempt.id === attemptId ? { ...attempt, ...body, reviewedAt: new Date().toISOString(), reviewedBy: session.id } : attempt);
    await writeStore(store, 'model', model);
    return response(200, { ok: true, model });
  }
  if (path === '/api/media' && method === 'POST') {
    if (session.role !== 'teacher') return response(403, { error: 'Somente o professor pode enviar arquivos.' });
    if (!body.id || typeof body.dataUrl !== 'string') return response(400, { error: 'Arquivo inválido.' });
    await writeStore(store, `media:${body.id}`, { name: String(body.name || 'arquivo'), type: String(body.type || 'application/octet-stream'), dataUrl: body.dataUrl });
    return response(200, { ok: true, id: body.id });
  }
  if (path.startsWith('/api/media/') && method === 'GET') {
    const media = await readStore(store, `media:${decodeURIComponent(path.split('/').pop())}`, null);
    if (!media) return response(404, { error: 'Arquivo não encontrado.' });
    const match = /^data:([^;]+);base64,(.*)$/s.exec(media.dataUrl);
    if (!match) return response(404, { error: 'Arquivo inválido.' });
    return { statusCode: 200, headers: { 'Content-Type': match[1], 'X-Media-Name': encodeURIComponent(media.name), 'Cache-Control': 'private, max-age=3600' }, body: match[2], isBase64Encoded: true };
  }

  if (path === '/api/presence' && method === 'POST') return response(200, { ok: true });
  if (path === '/api/practice/request' && method === 'POST') return response(200, { ok: true });
  if (path.startsWith('/api/exams/') && method === 'POST') return response(200, { ok: true });
  if (path === '/api/exams/unlock' && method === 'POST') return session.role === 'teacher' ? response(200, { ok: true }) : response(403, { error: 'Acesso reservado ao professor.' });
  return response(404, { error: 'Endpoint não encontrado.' });
};
