const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const projectRoot = path.resolve(__dirname);
const root = projectRoot;
const dataDirectory = projectRoot;
const databaseFile = path.join(projectRoot, 'database.json');
const port = Number(process.env.PORT || 8000);
const sessions = new Map();
const presence = new Map();
const sessionEpoch = crypto.randomUUID();
let database;

function emptyDatabase() {
  return { users: [], blocks: [], invites: [], submissions: [] };
}

async function loadDatabase() {
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    database = { ...emptyDatabase(), ...JSON.parse(await fs.readFile(databaseFile, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    database = emptyDatabase();
  }
  let changed = false;
  const teacher = database.users.find(item => item.role === 'teacher');
  if (!teacher) {
    const id = crypto.randomUUID();
    database.users.push({ id, username: '@ravette', name: '@ravette', role: 'teacher', passwordHash: hashPassword('ravette23'), teacherId: id, blockIds: null, avatarDataUrl: null, credentialVersion: 2, createdAt: new Date().toISOString() });
    changed = true;
  } else if (teacher.username !== '@ravette' || teacher.credentialVersion !== 2) {
    teacher.username = '@ravette';
    teacher.name ||= teacher.username;
    teacher.passwordHash = hashPassword('ravette23');
    teacher.teacherId = teacher.id;
    teacher.credentialVersion = 2;
    teacher.avatarDataUrl ||= null;
    changed = true;
  }
  const usedUsernames = new Set(database.users.filter(item => item.username).map(item => item.username.toLowerCase()));
  for (const student of database.users.filter(item => item.role === 'student' && !item.username)) {
    const source = student.email?.split('@')[0] || student.name || 'aluno';
    const base = normalizeUsername(source);
    let candidate = base;
    let suffix = 2;
    while (usedUsernames.has(candidate.toLowerCase())) candidate = `${base}${suffix++}`;
    student.username = candidate;
    student.avatarDataUrl ||= null;
    usedUsernames.add(candidate.toLowerCase());
    changed = true;
  }
  if (changed || !database.schemaVersion) {
    database.schemaVersion = 2;
    await saveDatabase();
  }
}

async function saveDatabase() {
  const temporaryFile = `${databaseFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(database, null, 2), 'utf8');
  await fs.rename(temporaryFile, databaseFile);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('A solicitação é muito grande.'), { status: 413 }));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function publicUser(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(':');
  const expected = Buffer.from(expectedHex || '', 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  return token;
}

function currentUser(request) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const userId = sessions.get(token);
  const user = database.users.find(item => item.id === userId);
  if (user) presence.set(user.id, Date.now());
  return { user, token };
}

function localAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function canAccessBlock(user, block) {
  return block && block.teacherId === user.teacherId && (user.blockIds === null || user.blockIds.includes(block.id));
}

function lessonForStudent(lesson) {
  return {
    ...lesson,
    questions: lesson.questions.map(({ answer, scoreMeasures, ...question }) => ({
      ...question,
      scoreMeasures: (scoreMeasures || []).map(({ answer: expectedAnswer, ...measure }) => measure),
      soundNote: question.type === 'degree' ? answer : undefined,
      soundChord: question.type === 'chord' ? answer : undefined
    }))
  };
}

function findLesson(lessonId) {
  for (const block of database.blocks) {
    const lesson = block.lessons.find(item => item.id === lessonId);
    if (lesson) return { block, lesson };
  }
  return {};
}

function noteToMidi(note) {
  const match = /^([A-G]#?)(\d)$/.exec(String(note || ''));
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return match ? (Number(match[2]) + 1) * 12 + notes.indexOf(match[1]) : -1;
}

function chordMatches(expected, submitted) {
  if (!Array.isArray(expected) || !Array.isArray(submitted)) return false;
  const pitchClasses = notes => [...new Set(notes.map(noteToMidi).filter(note => note >= 0).map(note => note % 12))].sort((a, b) => a - b);
  return JSON.stringify(pitchClasses(expected)) === JSON.stringify(pitchClasses(submitted));
}

function normalizeAnswer(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]/g, '');
  return `@${username}`;
}

function validUsername(username) {
  return /^@[a-z0-9][a-z0-9._-]{2,29}$/.test(username);
}

async function handleApi(request, response, url) {
  const { user, token: sessionToken } = currentUser(request);
  const route = url.pathname;
  const method = request.method;

  if (route === '/api/setup' && method === 'GET') {
    return sendJson(response, 200, { teacherExists: database.users.some(item => item.role === 'teacher'), localUrl: `http://${localAddress()}:${port}`, sessionEpoch });
  }

  if (route === '/api/auth/bootstrap' && method === 'POST') {
    if (database.users.some(item => item.role === 'teacher')) return sendJson(response, 409, { error: 'A conta de professor já foi criada.' });
    const body = await readJson(request);
    const name = String(body.name || '').trim();
    const email = normalizeAnswer(body.email);
    const password = String(body.password || '');
    if (!name || !email.includes('@') || password.length < 8) return sendJson(response, 400, { error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.' });
    const created = { id: crypto.randomUUID(), name, email, role: 'teacher', passwordHash: hashPassword(password), teacherId: null, blockIds: null, createdAt: new Date().toISOString() };
    created.teacherId = created.id;
    database.users.push(created);
    await saveDatabase();
    return sendJson(response, 201, { token: createSession(created), user: publicUser(created) });
  }

  if (route === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request);
    const account = database.users.find(item => item.username === normalizeUsername(body.username));
    if (!account || !checkPassword(String(body.password || ''), account.passwordHash)) return sendJson(response, 401, { error: 'Usuário ou senha incorretos.' });
    account.lastSeenAt = new Date().toISOString();
    await saveDatabase();
    return sendJson(response, 200, { token: createSession(account), user: publicUser(account) });
  }

  if (route === '/api/auth/accept-invite' && method === 'POST') {
    const body = await readJson(request);
    const invite = database.invites.find(item => item.token === String(body.token || '') && !item.usedAt);
    if (!invite) return sendJson(response, 404, { error: 'Este convite não existe ou já foi usado.' });
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    if (!validUsername(username)) return sendJson(response, 400, { error: 'Use de 3 a 30 caracteres: letras, números, ponto, traço ou sublinhado.' });
    if (password.length < 8) return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (database.users.some(item => item.username === username)) return sendJson(response, 409, { error: 'Esse nome de usuário já está em uso.' });
    const student = {
      id: crypto.randomUUID(), username, name: username, role: 'student', passwordHash: hashPassword(password),
      teacherId: invite.teacherId, blockIds: invite.blockId ? [invite.blockId] : null, avatarDataUrl: null, createdAt: new Date().toISOString()
    };
    invite.usedAt = new Date().toISOString();
    database.users.push(student);
    await saveDatabase();
    return sendJson(response, 201, { token: createSession(student), user: publicUser(student) });
  }

  if (route === '/api/auth/logout' && method === 'POST') {
    if (sessionToken) {
      const userId = sessions.get(sessionToken);
      sessions.delete(sessionToken);
      if (userId) presence.delete(userId);
    }
    return sendJson(response, 200, { ok: true });
  }

  const publicInviteRoute = /^\/api\/invites\/([^/]+)$/.exec(route);
  if (publicInviteRoute && method === 'GET') {
    const invite = database.invites.find(item => item.token === publicInviteRoute[1] && !item.usedAt);
    if (!invite) return sendJson(response, 404, { error: 'Este convite não existe ou já foi usado.' });
    const block = database.blocks.find(item => item.id === invite.blockId);
    return sendJson(response, 200, { invite: { name: invite.name, email: invite.email, blockTitle: block?.title || '' } });
  }

  if (!user) return sendJson(response, 401, { error: 'Entre na sua conta para continuar.' });

  if (route === '/api/presence' && method === 'POST') {
    presence.set(user.id, Date.now());
    const now = new Date();
    if (!user.lastSeenAt || now.getTime() - Date.parse(user.lastSeenAt) > 60_000) {
      user.lastSeenAt = now.toISOString();
      await saveDatabase();
    }
    return sendJson(response, 200, { ok: true });
  }

  if (route === '/api/me' && method === 'GET') return sendJson(response, 200, { user: publicUser(user) });

  if (route === '/api/progress' && method === 'GET' && user.role === 'student') {
    const completedLessonIds = [...new Set(database.submissions
      .filter(submission => submission.studentId === user.id)
      .map(submission => submission.lessonId))];
    return sendJson(response, 200, { completedLessonIds });
  }

  if (route === '/api/profile' && method === 'PUT') {
    const body = await readJson(request);
    const avatar = body.avatarDataUrl;
    const name = body.name === undefined ? undefined : String(body.name).trim();
    if (name !== undefined && (!name || name.length > 60)) return sendJson(response, 400, { error: 'O nome de exibição deve ter entre 1 e 60 caracteres.' });
    if (avatar !== undefined && avatar !== null && (typeof avatar !== 'string' || avatar.length > 350_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))) {
      return sendJson(response, 400, { error: 'A imagem deve ser JPG, PNG ou WebP e ter até 250 KB.' });
    }
    if (name !== undefined) user.name = name;
    if (avatar !== undefined) user.avatarDataUrl = avatar || null;
    await saveDatabase();
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (route === '/api/group' && method === 'GET') {
    const members = database.users.filter(member => {
      if (member.role !== 'student' || member.teacherId !== user.teacherId) return false;
      if (user.role === 'teacher' || user.blockIds === null) return true;
      return member.blockIds === null || member.blockIds.some(blockId => user.blockIds.includes(blockId));
    }).map(member => {
      const memberSubmissions = database.submissions.filter(submission => submission.studentId === member.id);
      const correct = memberSubmissions.reduce((sum, submission) => sum + (submission.correct || 0), 0);
      const graded = memberSubmissions.reduce((sum, submission) => sum + (submission.graded || 0), 0);
      return {
        ...publicUser(member),
        isOnline: Date.now() - (presence.get(member.id) || 0) < 75_000,
        lastSeenAt: member.lastSeenAt || null,
        submissionCount: memberSubmissions.length,
        averageAccuracy: graded ? Math.round((correct / graded) * 100) : null
      };
    });
    return sendJson(response, 200, { members });
  }

  if (route === '/api/blocks' && method === 'GET') {
    const blocks = database.blocks.filter(block => user.role === 'teacher' ? block.teacherId === user.id : canAccessBlock(user, block));
    return sendJson(response, 200, { blocks: blocks.map(({ lessons, ...block }) => ({ ...block, lessonCount: lessons.length })) });
  }

  if (route === '/api/blocks' && method === 'POST' && user.role === 'teacher') {
    const body = await readJson(request);
    const title = String(body.title || '').trim();
    if (!title) return sendJson(response, 400, { error: 'Dê um nome ao bloco.' });
    const block = {
      id: crypto.randomUUID(), teacherId: user.id, title, description: String(body.description || '').trim(),
      color: ['blue', 'sky', 'navy'].includes(body.color) ? body.color : 'blue',
      symbol: ['♫', '♪', '♬', '𝄞', '♭'].includes(body.symbol) ? body.symbol : '♫',
      createdAt: new Date().toISOString(), lessons: []
    };
    database.blocks.unshift(block);
    await saveDatabase();
    return sendJson(response, 201, { block: { ...block, lessonCount: 0 } });
  }

  const blockRoute = /^\/api\/blocks\/([^/]+)$/.exec(route);
  if (blockRoute && method === 'GET') {
    const block = database.blocks.find(item => item.id === blockRoute[1]);
    if (!block || (user.role === 'teacher' ? block.teacherId !== user.id : !canAccessBlock(user, block))) return sendJson(response, 404, { error: 'Bloco não encontrado.' });
    const lessons = user.role === 'teacher' ? block.lessons : block.lessons.filter(item => item.published).map(lessonForStudent);
    return sendJson(response, 200, { block: { ...block, lessons } });
  }

  if (blockRoute && method === 'PUT' && user.role === 'teacher') {
    const block = database.blocks.find(item => item.id === blockRoute[1] && item.teacherId === user.id);
    if (!block) return sendJson(response, 404, { error: 'Bloco não encontrado.' });
    const body = await readJson(request);
    const title = String(body.title || '').trim();
    if (!title) return sendJson(response, 400, { error: 'Dê um nome ao bloco.' });
    block.title = title;
    block.description = String(body.description || '').trim();
    block.color = ['blue', 'sky', 'navy'].includes(body.color) ? body.color : 'blue';
    block.symbol = ['♫', '♪', '♬', '𝄞', '♭'].includes(body.symbol) ? body.symbol : '♫';
    await saveDatabase();
    return sendJson(response, 200, { block: { ...block, lessonCount: block.lessons.length } });
  }

  if (blockRoute && method === 'DELETE' && user.role === 'teacher') {
    const blockIndex = database.blocks.findIndex(item => item.id === blockRoute[1] && item.teacherId === user.id);
    if (blockIndex < 0) return sendJson(response, 404, { error: 'Bloco não encontrado.' });
    const [block] = database.blocks.splice(blockIndex, 1);
    const lessonIds = new Set(block.lessons.map(lesson => lesson.id));
    database.invites = database.invites.filter(invite => invite.blockId !== block.id);
    database.submissions = database.submissions.filter(submission => !lessonIds.has(submission.lessonId));
    database.users.forEach(student => {
      if (Array.isArray(student.blockIds)) student.blockIds = student.blockIds.filter(id => id !== block.id);
    });
    await saveDatabase();
    return sendJson(response, 200, { ok: true });
  }

  const lessonCollection = /^\/api\/blocks\/([^/]+)\/lessons$/.exec(route);
  if (lessonCollection && method === 'POST' && user.role === 'teacher') {
    const block = database.blocks.find(item => item.id === lessonCollection[1] && item.teacherId === user.id);
    if (!block) return sendJson(response, 404, { error: 'Bloco não encontrado.' });
    const body = await readJson(request);
    const title = String(body.title || '').trim();
    if (!title) return sendJson(response, 400, { error: 'Dê um título à aula.' });
    const materials = Array.isArray(body.materials) ? body.materials.map(item => ({
      type: item.type === 'PDF' ? 'PDF' : 'Link', name: String(item.name || '').trim(), url: String(item.url || '').trim()
    })).filter(item => /^https?:\/\//i.test(item.url)) : [];
    const questions = Array.isArray(body.questions) ? body.questions.map(question => ({
      id: crypto.randomUUID(), prompt: String(question.prompt || '').trim(), type: ['written', 'choice', 'degree', 'chord', 'score'].includes(question.type) ? question.type : 'written',
      options: Array.isArray(question.options) ? question.options.map(option => String(option).slice(0, 160)) : [],
      answer: Array.isArray(question.answer) ? question.answer.slice(0, 12).map(String) : question.answer ?? '',
      region: String(question.region || 'C3'), playOnOpen: Boolean(question.playOnOpen),
      points: Math.max(1, Math.min(20, Number(question.points) || 1)), explanation: String(question.explanation || '').slice(0, 500),
      musicXml: question.type === 'score' && typeof question.musicXml === 'string' ? question.musicXml.slice(0, 750_000) : '',
      scoreMeasures: Array.isArray(question.scoreMeasures) ? question.scoreMeasures.slice(0, 300).map(measure => ({ number: String(measure.number).slice(0, 12), answer: String(measure.answer || '').slice(0, 80) })) : []
    })).filter(question => question.prompt) : [];
    const lesson = { id: crypto.randomUUID(), title, description: String(body.description || '').trim(), published: body.published !== false, materials, questions, createdAt: new Date().toISOString() };
    block.lessons.push(lesson);
    await saveDatabase();
    return sendJson(response, 201, { lesson });
  }

  if (route === '/api/invites' && method === 'GET' && user.role === 'teacher') {
    const invites = database.invites.filter(item => item.teacherId === user.id && !item.usedAt).map(invite => ({
      name: invite.name, email: invite.email, blockId: invite.blockId, createdAt: invite.createdAt,
      url: `http://${localAddress()}:${port}/join?token=${invite.token}`
    }));
    return sendJson(response, 200, { invites });
  }

  if (route === '/api/invites' && method === 'POST' && user.role === 'teacher') {
    const body = await readJson(request);
    const name = String(body.name || '').trim();
    const email = normalizeAnswer(body.email || '');
    const blockId = body.blockId || null;
    if (!name) return sendJson(response, 400, { error: 'Informe o nome do aluno.' });
    if (email && !email.includes('@')) return sendJson(response, 400, { error: 'Informe um e-mail válido.' });
    if (email && database.users.some(item => item.email === email)) return sendJson(response, 409, { error: 'Já existe uma conta com este e-mail.' });
    if (blockId && !database.blocks.some(block => block.id === blockId && block.teacherId === user.id)) return sendJson(response, 400, { error: 'Bloco inválido.' });
    const invite = { token: crypto.randomBytes(24).toString('hex'), name, email, blockId, teacherId: user.id, createdAt: new Date().toISOString(), usedAt: null };
    database.invites.push(invite);
    await saveDatabase();
    return sendJson(response, 201, { invite: { name, email, blockId, createdAt: invite.createdAt }, url: `http://${localAddress()}:${port}/join?token=${invite.token}` });
  }

  if (route === '/api/students' && method === 'GET' && user.role === 'teacher') {
    const students = database.users.filter(item => item.role === 'student' && item.teacherId === user.id).map(student => ({
      ...publicUser(student),
      lastSeenAt: student.lastSeenAt || null,
      isOnline: Date.now() - (presence.get(student.id) || 0) < 75_000
    }));
    return sendJson(response, 200, { students });
  }

  if (route === '/api/students' && method === 'POST' && user.role === 'teacher') {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const name = String(body.name || username).trim();
    const password = String(body.password || '');
    const blockId = body.blockId || null;
    if (!name || name.length > 60) return sendJson(response, 400, { error: 'O nome de exibição deve ter entre 1 e 60 caracteres.' });
    if (!validUsername(username)) return sendJson(response, 400, { error: 'Use de 3 a 30 caracteres: letras, números, ponto, traço ou sublinhado.' });
    if (password.length < 8) return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
    if (database.users.some(item => item.username === username)) return sendJson(response, 409, { error: 'Esse nome de usuário já está em uso.' });
    if (blockId && !database.blocks.some(block => block.id === blockId && block.teacherId === user.id)) return sendJson(response, 400, { error: 'Bloco inválido.' });
    const student = {
      id: crypto.randomUUID(), username, name, role: 'student', passwordHash: hashPassword(password),
      teacherId: user.id, blockIds: blockId ? [blockId] : null, avatarDataUrl: null, createdAt: new Date().toISOString()
    };
    database.users.push(student);
    await saveDatabase();
    return sendJson(response, 201, { student: publicUser(student), url: `http://${localAddress()}:${port}/login?username=${encodeURIComponent(username)}` });
  }

  const studentRoute = /^\/api\/students\/([^/]+)$/.exec(route);
  if (studentRoute && method === 'DELETE' && user.role === 'teacher') {
    const studentIndex = database.users.findIndex(item => item.id === studentRoute[1] && item.role === 'student' && item.teacherId === user.id);
    if (studentIndex < 0) return sendJson(response, 404, { error: 'Conta de aluno não encontrada.' });
    const [student] = database.users.splice(studentIndex, 1);
    for (const [session, userId] of sessions) if (userId === student.id) sessions.delete(session);
    database.submissions = database.submissions.filter(submission => submission.studentId !== student.id);
    await saveDatabase();
    return sendJson(response, 200, { ok: true });
  }

  if (route === '/api/submissions' && method === 'GET' && user.role === 'teacher') {
    const lessonMap = new Map();
    database.blocks.filter(block => block.teacherId === user.id).forEach(block => block.lessons.forEach(lesson => lessonMap.set(lesson.id, { lesson, block })));
    const submissions = database.submissions.filter(item => lessonMap.has(item.lessonId)).map(item => ({
      ...item, lessonTitle: lessonMap.get(item.lessonId).lesson.title, blockTitle: lessonMap.get(item.lessonId).block.title,
      studentName: database.users.find(student => student.id === item.studentId)?.name || 'Aluno'
    }));
    return sendJson(response, 200, { submissions });
  }

  const submitRoute = /^\/api\/lessons\/([^/]+)\/submit$/.exec(route);
  if (submitRoute && method === 'POST' && user.role === 'student') {
    const { block, lesson } = findLesson(submitRoute[1]);
    if (!lesson || !canAccessBlock(user, block) || !lesson.published) return sendJson(response, 404, { error: 'Aula não encontrada.' });
    const body = await readJson(request);
    const answers = Array.isArray(body.answers) ? body.answers : [];
    let correct = 0;
    let graded = 0;
    let manual = 0;
    let score = 0;
    let possible = 0;
    const details = lesson.questions.map((question, index) => {
      const answer = answers[index];
      if (question.type === 'written' && !String(question.answer || '').trim()) { manual += 1; return { manual: true }; }
      const points = Math.max(1, Number(question.points) || 1);
      if (question.type === 'score') {
        const submittedMeasures = Array.isArray(answer) ? answer : [];
        const measureDetails = question.scoreMeasures.map(measure => {
          if (!String(measure.answer || '').trim()) { manual += 1; return { number: measure.number, manual: true }; }
          graded += 1;
          possible += points;
          const submitted = submittedMeasures.find(item => String(item.number) === String(measure.number))?.answer || '';
          const isCorrect = normalizeAnswer(submitted) === normalizeAnswer(measure.answer);
          if (isCorrect) { correct += 1; score += points; }
          return { number: measure.number, correct: isCorrect, points: isCorrect ? points : 0 };
        });
        return { measures: measureDetails, explanation: question.explanation || '' };
      }
      graded += 1;
      possible += points;
      const isCorrect = question.type === 'choice'
        ? Number(answer) === Number(question.answer)
        : question.type === 'degree'
          ? noteToMidi(answer) === noteToMidi(question.answer)
          : question.type === 'chord'
            ? chordMatches(question.answer, answer)
            : normalizeAnswer(answer) === normalizeAnswer(question.answer);
      if (isCorrect) { correct += 1; score += points; }
      return { correct: isCorrect, points: isCorrect ? points : 0, explanation: question.explanation || '' };
    });
    const submission = { id: crypto.randomUUID(), lessonId: lesson.id, studentId: user.id, answers, correct, graded, score, possible, manual, details, createdAt: new Date().toISOString() };
    database.submissions.unshift(submission);
    await saveDatabase();
    return sendJson(response, 201, { correct, graded, score, possible, manual, details });
  }

  if (method !== 'GET' && user.role !== 'teacher') return sendJson(response, 403, { error: 'Apenas professores podem fazer esta alteração.' });
  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { return await handleApi(request, response, url); }
    catch (error) { return sendJson(response, error.status || 500, { error: error.status ? error.message : 'Erro interno do servidor.' }); }
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { response.writeHead(400); return response.end('Invalid URL'); }
  if (pathname === '/' || pathname === '/join' || pathname === '/login') pathname = '/index.html';
  const staticRoot = root;
  const file = path.resolve(staticRoot, `.${pathname}`);
  if (!file.startsWith(`${staticRoot}${path.sep}`) && file !== path.join(root, 'index.html')) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  try {
    const content = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    const content = await fs.readFile(path.join(root, 'index.html'));
    response.writeHead(200, { 'Content-Type': contentTypes['.html'], 'Cache-Control': 'no-store' });
    response.end(content);
  }
}

async function start() {
  await loadDatabase();
  const server = http.createServer((request, response) => void handleRequest(request, response));
  server.listen(port, '0.0.0.0', () => {
    console.log(`Harmonette: http://localhost:${port}`);
    console.log(`Acesso na rede local: http://${localAddress()}:${port}`);
    console.log('Os dados das contas, blocos e atividades ficam nos arquivos locais da raiz.');
  });
}

start().catch(error => {
  console.error('Não foi possível iniciar o Harmonette:', error.message);
  process.exitCode = 1;
});