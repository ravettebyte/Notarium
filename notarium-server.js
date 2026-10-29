const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const root = path.resolve(__dirname);
const publicRoot = root;
const port = Number(process.env.PORT) || 4173;
const dataFile = process.env.NOTARIUM_DATA_FILE
  ? path.resolve(process.env.NOTARIUM_DATA_FILE)
  : path.join(root, 'notarium-server-data.json');
function createApi(options = {}) {
const sessions = options.sessions || new Map();
const loginFailures = new Map();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mxl': 'application/vnd.recordare.musicxml',
  '.musicxml': 'application/vnd.recordare.musicxml+xml',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
};
let store = options.store || { users: [], model: null, media: [], notifications: [], examSessions: [] };
let writeQueue = Promise.resolve();

function emptyModel() {
  return {
    schemaVersion: 1,
    profile: { displayName: 'Músico', username: '', bio: '', avatarDataUrl: '', defaultOctave: 4, role: 'teacher', theme: 'light' },
    blocks: [],
    exerciseBlocks: [],
    lessons: [],
    exercises: [],
    attempts: [],
    trails: [],
    trailSettings: []
  };
}

async function loadStore() {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    if (!saved || !Array.isArray(saved.users)
        || (saved.model !== undefined && saved.model !== null && typeof saved.model !== 'object')) {
      throw new Error('O arquivo de dados do servidor tem formato inválido.');
    }
    store = {
      users: saved.users,
      model: saved.model || null,
      media: Array.isArray(saved.media) ? saved.media : [],
      notifications: Array.isArray(saved.notifications) ? saved.notifications : [],
      examSessions: Array.isArray(saved.examSessions) ? saved.examSessions : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveStore();
  }
}

function saveStore() {
  if (options.persist) return options.persist(store);
  const operation = writeQueue.then(async () => {
    const temporaryFile = `${dataFile}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, dataFile);
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function allowCorsOrigin(request, response) {
  const origin = request.headers.origin || '';
  const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Expose-Headers', 'X-Media-Name');
  response.setHeader('Vary', 'Origin');
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 24 * 1024 * 1024) {
        reject(Object.assign(new Error('A solicitação excede o limite de 24 MB.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9._-]{3,30}$/.test(value);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function checkPassword(password, savedHash) {
  const [salt, expectedHex] = String(savedHash || '').split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(expectedHex || '')) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return crypto.timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, createdAt: user.createdAt };
}

function bearerToken(request) {
  const value = request.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function currentUser(request) {
  if (options.userId) return store.users.find(user => user.id === options.userId) || null;
  const userId = sessions.get(bearerToken(request));
  return store.users.find(user => user.id === userId) || null;
}

function addNotification(recipient, type, title, message, metadata = {}) {
  const notification = {
    id: crypto.randomUUID(), recipient, type, title, message,
    ...metadata, createdAt: new Date().toISOString(), readAt: ''
  };
  store.notifications.push(notification);
  return notification;
}

function notificationsFor(user) {
  const recipient = user.role === 'teacher' ? 'teacher' : user.id;
  return store.notifications.filter(item => item.recipient === recipient)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function modelFor(user) {
  if (!store.model) store.model = emptyModel();
  if (user.role === 'teacher') return { ...store.model, profile: { ...store.model.profile, ...user.profile, displayName: user.name, username: user.username, role: user.role } };

  const model = JSON.parse(JSON.stringify(store.model));
  const lessons = model.lessons.filter(lesson => lesson.published === true);
  const exercises = model.exercises.filter(exercise =>
    exercise.published === true && !['draft', 'archived'].includes(exercise.status)
      && (!exercise.personalizedFor || exercise.personalizedFor === user.id));
  const lessonIds = new Set(lessons.map(lesson => lesson.id));
  const exerciseIds = new Set(exercises.map(exercise => exercise.id));
  model.blocks = model.blocks.filter(block => lessons.some(lesson => lesson.blockId === block.id));
  model.exerciseBlocks = (model.exerciseBlocks || []).filter(block => model.exercises.some(exercise => exercise.exerciseBlockId === block.id));
  model.lessons = lessons.map(lesson => ({
    ...lesson,
    exerciseIds: (lesson.exerciseIds || []).filter(id => exerciseIds.has(id))
  }));
  model.exercises = exercises.map(exercise => ({
    ...exercise,
    ...(exercise.assessment ? { questionCount: exercise.questions.length, questions: [] } : {}),
    lessonIds: (exercise.lessonIds || []).filter(id => lessonIds.has(id))
  }));
  model.attempts = model.attempts.filter(attempt =>
    attempt.studentId === user.id && !attempt.isDemo);
  model.trails = (model.trails || []).filter(step => step.studentId === user.id);
  model.trailSettings = (model.trailSettings || []).filter(settings => settings.studentId === user.id);
  model.profile = {
    ...emptyModel().profile,
    ...user.profile,
    displayName: user.name,
    username: user.username,
    role: 'student'
  };
  return model;
}

function referencedMediaIds(model) {
  const ids = new Set();
  for (const block of model?.blocks || []) {
    for (const content of block.content || []) {
      if (content.mediaSource === 'upload' && content.mediaId) ids.add(content.mediaId);
    }
  }
  for (const lesson of model?.lessons || []) {
    for (const content of lesson.content || []) {
      if (content.mediaSource === 'upload' && content.mediaId) ids.add(content.mediaId);
    }
  }
  for (const exercise of model?.exercises || []) {
    for (const question of exercise.questions || []) {
      if (question.mediaSource === 'upload' && question.mediaId) ids.add(question.mediaId);
      if (question.musicMediaId) ids.add(question.musicMediaId);
    }
  }
  for (const step of model?.trails || []) {
    if (step.mediaSource === 'upload' && step.mediaId) ids.add(step.mediaId);
  }
  for (const attempt of model?.attempts || []) {
    for (const attachment of attempt.attachments || []) {
      if (attachment.id) ids.add(attachment.id);
    }
  }
  return ids;
}

function portalUrl(request) {
  if (options.origin) return new URL('/login', options.origin).href;
  if (process.env.PUBLIC_URL) return new URL('/?login=1', process.env.PUBLIC_URL).href;
  return new URL('/?login=1', `http://${request.headers.host || 'localhost'}`).href;
}

function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
}

function parsePitch(value, defaultOctave = 4) {
  if (Number.isInteger(value) && value >= 0 && value <= 127) return value;
  const match = String(value ?? '').trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
  if (!match) return null;
  const letter = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const accidental = match[2].replace('♯', '#').replace('♭', 'b');
  const octave = match[3] === undefined ? defaultOctave : Number(match[3]);
  if (!Number.isInteger(octave) || octave < -1 || octave > 9) return null;
  const midi = (octave + 1) * 12 + letter + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return midi >= 0 && midi <= 127 ? midi : null;
}

function pitchSequence(value, defaultOctave) {
  const tokens = Array.isArray(value) ? value : String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  return tokens.map(note => parsePitch(note, defaultOctave));
}

function intervalCycle(notes) {
  return notes.length < 2 ? [] : notes.map((note, index) =>
    (((notes[(index + 1) % notes.length] % 12) - (note % 12) + 12) % 12) || 12);
}

function chordAnswerCorrect(question, value, defaultOctave) {
  const expectedTokens = question.expectedNotes || [];
  let expected = pitchSequence(expectedTokens, defaultOctave);
  const submittedTokens = Array.isArray(value) ? value : String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  const submitted = pitchSequence(submittedTokens, defaultOctave);
  if (submitted.some(note => note === null)) return false;
  if (!expected.length && question.expectedIntervals?.length) {
    expected = [60];
    for (const interval of question.expectedIntervals.slice(0, -1)) {
      expected.push(expected[expected.length - 1] + Number(interval));
    }
  }
  if (question.manual || (!expected.length && !question.expectedIntervals?.length)) return null;
  if (expected.some(note => note === null)) return false;

  const criterion = question.correctionCriterion || 'notes';
  const order = question.chordOrder || (question.assemblyOrder?.length ? 'sequence' : 'any');
  const sequenceTokens = order === 'inversion' ? expectedTokens
    : question.assemblyOrder?.length ? question.assemblyOrder : expectedTokens;
  const sequence = order === 'inversion' ? expected
    : question.assemblyOrder?.length ? pitchSequence(question.assemblyOrder, defaultOctave) : expected;
  const normalizeOctave = notes => notes.map(note => question.ignoreOctave ? ((note % 12) + 12) % 12 : note);

  if (criterion === 'intervals') {
    const expectedIntervals = question.expectedIntervals?.map(Number) || intervalCycle(sequence);
    const actualIntervals = intervalCycle(submitted);
    if (!expectedIntervals.length || expectedIntervals.length !== actualIntervals.length) return false;
    return order === 'any'
      ? actualIntervals.some((_, offset) => expectedIntervals.every((interval, index) => interval === actualIntervals[(index + offset) % actualIntervals.length]))
      : expectedIntervals.every((interval, index) => interval === actualIntervals[index]);
  }

  if (question.acceptEnharmonic === false) {
    const actualSpellings = submittedTokens.map((source, index) => {
      const note = submitted[index];
      const token = typeof source === 'string' ? source : '';
      const parsed = token.match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
      if (!parsed) return `midi:${note}`;
      const accidental = parsed[2].replace('♯', '#').replace('♭', 'b');
      const octave = parsed[3] === undefined ? defaultOctave : Number(parsed[3]);
      return `${parsed[1].toUpperCase()}${accidental}${question.ignoreOctave ? '' : octave}`;
    });
    const expectedSpellings = sequenceTokens.map(note => {
      const parsed = String(note).match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
      if (!parsed) return '';
      const accidental = parsed[2].replace('♯', '#').replace('♭', 'b');
      const octave = parsed[3] === undefined ? defaultOctave : Number(parsed[3]);
      return `${parsed[1].toUpperCase()}${accidental}${question.ignoreOctave ? '' : octave}`;
    });
    if (actualSpellings.length !== expectedSpellings.length) return false;
    if (order === 'any') {
      actualSpellings.sort();
      expectedSpellings.sort();
    }
    return JSON.stringify(actualSpellings) === JSON.stringify(expectedSpellings);
  }

  const normalizedExpected = normalizeOctave(sequence);
  const normalizedSubmitted = normalizeOctave(submitted);
  if (normalizedExpected.length !== normalizedSubmitted.length) return false;
  if (order === 'sequence' || order === 'inversion') {
    return JSON.stringify(normalizedExpected) === JSON.stringify(normalizedSubmitted);
  }
  return JSON.stringify(normalizedExpected.sort((a, b) => a - b))
    === JSON.stringify(normalizedSubmitted.sort((a, b) => a - b));
}

function normalizeRhythmAnswer(question, value) {
  const expected = question.rhythmEvents || [];
  const tolerance = Math.min(500, Math.max(60, Number(question.toleranceMs) || 220));
  const maximum = Math.min(10, Math.max(1, Number(question.retryLimit) || 3));
  const plays = (Array.isArray(value?.plays) ? value.plays : []).slice(0, maximum).map(play => {
    const taps = (Array.isArray(play.taps) ? play.taps : []).slice(0, expected.length).map((tap, index) => {
      const atMs = Number(tap.atMs);
      const targetMs = Number(expected[index]?.timeSeconds) * 1000;
      const errorMs = Number.isFinite(atMs) && Number.isFinite(targetMs) ? Math.round(atMs - targetMs) : null;
      return { index, atMs: Number.isFinite(atMs) ? Math.round(atMs) : null, errorMs,
        correct: errorMs !== null && Math.abs(errorMs) <= tolerance, missed: tap.missed === true };
    });
    const correct = taps.filter(tap => tap.correct).length;
    const ordered = taps.length === expected.length && taps.every((tap, index) => tap.index === index
      && tap.atMs !== null && (index === 0 || tap.atMs >= taps[index - 1].atMs));
    const accuracy = expected.length ? Math.round(correct / expected.length * 100) : 0;
    return { taps, outOfOrder: ordered ? [] : [{ detail: 'Sequência de toques inválida.' }], correct, total: expected.length, accuracy };
  });
  const best = plays.reduce((result, play) => play.accuracy > result.accuracy ? play : result,
    { accuracy: 0, correct: 0, total: expected.length });
  return { plays, bestAccuracy: best.accuracy, bestCorrect: plays.some(play => play.accuracy >= 80 && !play.outOfOrder.length) };
}

function gradeAnswer(question, value, defaultOctave) {
  if (question.type === 'rhythm') {
    return normalizeRhythmAnswer(question, value).bestCorrect;
  }
  if (question.type === 'chord') return chordAnswerCorrect(question, value, defaultOctave);
  if (question.manual) return null;
  const accepted = [question.answer, ...(question.acceptedAnswers || [])]
    .filter(answer => answer !== undefined && String(answer).trim() !== '');
  if (!accepted.length) return null;
  const submittedPitch = parsePitch(value, defaultOctave);
  return accepted.some(answer => {
    const expectedPitch = parsePitch(answer, defaultOctave);
    return submittedPitch !== null && expectedPitch !== null
      ? submittedPitch === expectedPitch
      : normalizeAnswer(answer) === normalizeAnswer(value);
  });
}

async function handleApi(request, response, url) {
  const route = url.pathname;
  const method = request.method;
  const user = currentUser(request);

  if (route === '/api/health' && method === 'GET') {
    return sendJson(response, 200, { status: 'ok' });
  }

  if (route === '/api/setup' && method === 'GET') {
    return sendJson(response, 200, { teacherExists: store.users.some(item => item.role === 'teacher') });
  }

  if (route === '/api/session' && method === 'GET') {
    return sendJson(response, 200, {
      authenticated: Boolean(user),
      setupNeeded: !store.users.some(item => item.role === 'teacher'),
      user: user ? publicUser(user) : null
    });
  }

  if (route === '/api/auth/bootstrap' && method === 'POST') {
    if (store.users.some(item => item.role === 'teacher')) return sendJson(response, 409, { error: 'A conta de professor já foi configurada.' });
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    if (!name || !validUsername(username) || password.length < 10 || password.length > 256) {
      return sendJson(response, 400, { error: 'Informe nome, usuário válido e senha com 10 a 256 caracteres.' });
    }
    const created = {
      id: crypto.randomUUID(), name, username, role: 'teacher',
      passwordHash: hashPassword(password), createdAt: new Date().toISOString()
    };
    store.users.push(created);
    store.model ||= emptyModel();
    await saveStore();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, created.id);
    return sendJson(response, 201, { token, user: publicUser(created), model: store.model, portalUrl: portalUrl(request) });
  }

  if (route === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    const key = `${request.socket.remoteAddress || 'local'}:${username}`;
    const previous = loginFailures.get(key) || { count: 0, resetAt: 0 };
    if (previous.resetAt > Date.now() && previous.count >= 8) {
      return sendJson(response, 429, { error: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.' });
    }
    const account = store.users.find(item => item.username === username);
    const password = String(body.password || '');
    if (!account || password.length > 256 || !checkPassword(password, account.passwordHash)) {
      const failures = previous.resetAt > Date.now() ? previous : { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
      failures.count += 1;
      loginFailures.set(key, failures);
      return sendJson(response, 401, { error: 'Usuário ou senha incorretos.' });
    }
    loginFailures.delete(key);
    account.lastSeenAt = new Date().toISOString();
    await saveStore();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, account.id);
    return sendJson(response, 200, { token, user: publicUser(account), model: modelFor(account), portalUrl: portalUrl(request) });
  }

  if (route === '/api/auth/logout' && method === 'POST') {
    if (user) {
      user.lastSeenAt = new Date().toISOString();
      await saveStore();
    }
    sessions.delete(bearerToken(request));
    return sendJson(response, 200, { ok: true });
  }

  if (!user) return sendJson(response, 401, { error: 'Entre na sua conta para continuar.' });

  if (route === '/api/presence' && method === 'POST') {
    user.lastSeenAt = new Date().toISOString();
    await saveStore();
    return sendJson(response, 200, { lastSeenAt: user.lastSeenAt });
  }

  if (route === '/api/notifications' && method === 'GET') {
    if (user.role === 'student' && store.model) {
      const now = Date.now();
      let addedExamNotification = false;
      for (const exam of store.model.exercises || []) {
        const releaseAt = Date.parse(exam.assessment?.releaseAt || '');
        if (!exam.assessment || exam.published !== true || ['draft', 'closed', 'archived'].includes(exam.status)
          || (Number.isFinite(releaseAt) && releaseAt > now)) continue;
        if (!store.notifications.some(item => item.recipient === user.id && item.type === 'exam-released' && item.examId === exam.id)) {
          addNotification(user.id, 'exam-released', 'Uma avaliação foi liberada',
            `Você já pode responder “${exam.title}”.`, { examId: exam.id, exerciseId: exam.id });
          addedExamNotification = true;
        }
      }
      if (addedExamNotification) await saveStore();
    }
    return sendJson(response, 200, { notifications: notificationsFor(user) });
  }

  const notificationReadRoute = /^\/api\/notifications\/([^/]+)\/read$/.exec(route);
  if (notificationReadRoute && method === 'POST') {
    const recipient = user.role === 'teacher' ? 'teacher' : user.id;
    const notification = store.notifications.find(item => item.id === notificationReadRoute[1]
      && item.recipient === recipient);
    if (!notification) return sendJson(response, 404, { error: 'Notificação não encontrada.' });
    notification.readAt ||= new Date().toISOString();
    await saveStore();
    return sendJson(response, 200, { notification });
  }

  const reviewAttemptRoute = /^\/api\/attempts\/([^/]+)\/review$/.exec(route);
  if (reviewAttemptRoute && method === 'POST' && user.role === 'teacher') {
    const attempt = store.model?.attempts.find(item => item.id === reviewAttemptRoute[1]);
    if (!attempt || !attempt.studentId) return sendJson(response, 404, { error: 'Resposta de aluno não encontrada.' });
    const body = await readJson(request);
    const rating = Math.min(5, Math.max(0, Number(body.teacherRating) || 0));
    const note = String(body.teacherNote || '').trim().slice(0, 1000);
    attempt.reviewedAt ||= new Date().toISOString();
    attempt.teacherRating = rating;
    attempt.teacherNote = note;
    const student = store.users.find(item => item.id === attempt.studentId && item.role === 'student');
    if (student && !store.notifications.some(item => item.type === 'response-reviewed' && item.attemptId === attempt.id)) {
      addNotification(student.id, 'response-reviewed', 'Sua resposta foi vista',
        'O professor conferiu sua resposta. Continue acompanhando suas atividades.',
        { exerciseId: attempt.exerciseId, attemptId: attempt.id });
    }
    await saveStore();
    return sendJson(response, 200, { attempt });
  }

  if (route === '/api/media' && method === 'POST') {
    const body = await readJson(request);
    const id = String(body.id || '');
    const dataMatch = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(String(body.dataUrl || ''));
    if (!/^[a-z0-9._-]{1,120}$/i.test(id) || !dataMatch) {
      return sendJson(response, 400, { error: 'O identificador ou o conteúdo do arquivo é inválido.' });
    }
    const content = Buffer.from(dataMatch[2], 'base64');
    if (!content.length || content.length > 15 * 1024 * 1024) {
      return sendJson(response, 413, { error: 'Cada arquivo pode ter no máximo 15 MB.' });
    }
    const name = String(body.name || 'material').replace(/[\r\n]/g, '').slice(0, 180) || 'material';
    const type = dataMatch[1].slice(0, 120);
    const existing = store.media.findIndex(item => item.id === id);
    if (existing >= 0 && store.media[existing].ownerId && store.media[existing].ownerId !== user.id) {
      return sendJson(response, 403, { error: 'Este arquivo pertence a outra conta e não pode ser sobrescrito.' });
    }
    const record = {
      id,
      name,
      type,
      size: content.length,
      data: dataMatch[2],
      ownerId: existing >= 0 ? (store.media[existing].ownerId || user.id) : user.id,
      updatedAt: new Date().toISOString()
    };
    if (existing < 0) store.media.push(record);
    else store.media[existing] = record;
    await saveStore();
    return sendJson(response, 201, { id, name, type, size: content.length });
  }

  const mediaRoute = /^\/api\/media\/([^/]+)$/.exec(route);
  if (mediaRoute && method === 'GET') {
    let id;
    try { id = decodeURIComponent(mediaRoute[1]); }
    catch { return sendJson(response, 400, { error: 'Identificador de arquivo inválido.' }); }
    if (user.role !== 'teacher' && !referencedMediaIds(modelFor(user)).has(id)) {
      return sendJson(response, 404, { error: 'Arquivo não encontrado.' });
    }
    const record = store.media.find(item => item.id === id);
    if (!record) return sendJson(response, 404, { error: 'Arquivo não encontrado no servidor.' });
    const content = Buffer.from(record.data, 'base64');
    response.writeHead(200, {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      'Content-Length': content.length,
      'Content-Type': /^[a-z0-9.+/-]+$/i.test(record.type) ? record.type : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Media-Name': encodeURIComponent(record.name)
    });
    return response.end(content);
  }

  if (route === '/api/account/profile' && method === 'PUT') {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    if (!name || !validUsername(username)) {
      return sendJson(response, 400, { error: 'Informe um nome e um nome de usuário válido.' });
    }
    if (store.users.some(item => item.id !== user.id && item.username === username)) {
      return sendJson(response, 409, { error: 'Esse nome de usuário já está em uso.' });
    }
    const previousName = user.name;
    user.name = name;
    user.username = username;
    user.profile = { ...user.profile, bio: String(body.bio || '').slice(0, 500), avatarDataUrl: /^data:image\/(png|jpeg|webp);base64,/.test(body.avatarDataUrl || '') && body.avatarDataUrl.length <= 300000 ? body.avatarDataUrl : '', defaultOctave: Math.min(8, Math.max(0, Number(body.defaultOctave) || 4)), theme: body.theme === 'dark' ? 'dark' : 'light' };
    if (store.model) {
      if (user.role === 'teacher') {
        store.model.profile.displayName = name;
        store.model.profile.username = username;
      } else {
        for (const attempt of store.model.attempts) {
          if (attempt.studentId === user.id) attempt.profileName = name;
        }
      }
    }
    await saveStore();
    return sendJson(response, 200, { user: publicUser(user), previousName });
  }

  if (route === '/api/model' && method === 'GET') {
    return sendJson(response, 200, { model: modelFor(user) });
  }

  if (route === '/api/model' && method === 'PUT') {
    if (user.role !== 'teacher') return sendJson(response, 403, { error: 'Apenas o professor pode publicar o conteúdo da turma.' });
    const body = await readJson(request);
    const model = body.model;
    if (!model || !Array.isArray(model.blocks) || !Array.isArray(model.lessons)
        || !Array.isArray(model.exercises) || !Array.isArray(model.attempts)
        || (model.exerciseBlocks !== undefined && !Array.isArray(model.exerciseBlocks))) {
      return sendJson(response, 400, { error: 'O conteúdo enviado está incompleto ou inválido.' });
    }
    model.exerciseBlocks ||= [];
    const previous = store.model || emptyModel();
    const personalExercises = (previous.exercises || []).filter(item => item.personalizedFor);
    const personalExerciseIds = new Set(personalExercises.map(item => item.id));
    model.exercises = model.exercises.filter(item => !item.personalizedFor);
    for (const exercise of personalExercises) {
      if (!model.exercises.some(item => item.id === exercise.id)) model.exercises.push(exercise);
    }
    const storedStudentAttempts = (previous.attempts || []).filter(item => item.studentId
      || personalExerciseIds.has(item.exerciseId));
    for (const attempt of storedStudentAttempts) {
      if (!model.attempts.some(item => item.id === attempt.id)) model.attempts.push(attempt);
    }
    const previousPublished = new Set([
      ...(previous.lessons || []).filter(item => item.published).map(item => `lesson:${item.id}`),
      ...(previous.exercises || []).filter(item => item.published && !['draft', 'archived'].includes(item.status))
        .map(item => `exercise:${item.id}`)
    ]);
    for (const step of model.trails || []) {
      const saved = (previous.trails || []).find(item => item.id === step.id && item.studentId === step.studentId);
      if (saved) { step.status = saved.status; step.completed = saved.completed; step.completedAt = saved.completedAt; }
    }
    store.model = model;
    const newlyPublished = [
      ...(model.lessons || []).filter(item => item.published && !previousPublished.has(`lesson:${item.id}`))
        .map(item => ({ key: `lesson:${item.id}`, type: 'new-lesson', title: 'Aula nova disponível', name: item.title })),
      ...(model.exercises || []).filter(item => item.published && !['draft', 'closed', 'archived'].includes(item.status)
        && !previousPublished.has(`exercise:${item.id}`))
        .filter(item => !item.assessment || !item.assessment.releaseAt || Date.parse(item.assessment.releaseAt) <= Date.now())
        .map(item => ({ key: `exercise:${item.id}`, type: item.assessment ? 'exam-released' : 'new-exercise', title: item.assessment ? 'Avaliação liberada' : 'Exercício novo disponível', name: item.title }))
    ];
    const students = store.users.filter(item => item.role === 'student');
    for (const student of students) {
      for (const item of newlyPublished) {
        addNotification(student.id, item.type, item.title, `${item.name} já está disponível para você.`, { contentKey: item.key });
      }
      for (const step of model.trails || []) {
        if (step.studentId === student.id && !(previous.trails || []).some(item => item.id === step.id)) {
          addNotification(student.id, 'trail-update', 'Sua trilha ganhou uma etapa',
            `${step.title} foi adicionada à sua trilha.`, { trailId: step.id, contentKey: step.blockId });
        }
      }
    }
    await saveStore();
    return sendJson(response, 200, { saved: true });
  }

  if (route === '/api/students' && method === 'GET' && user.role === 'teacher') {
    const students = store.users.filter(item => item.role === 'student').map(student => ({
      ...publicUser(student),
      lastSeenAt: student.lastSeenAt || null,
      online: [...sessions.values()].includes(student.id)
        && Date.now() - Date.parse(student.lastSeenAt || '') < 120_000
    }));
    return sendJson(response, 200, { students });
  }

  if (route === '/api/students' && method === 'POST' && user.role === 'teacher') {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 60);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    if (!name || !validUsername(username) || password.length < 10 || password.length > 256) {
      return sendJson(response, 400, { error: 'Informe nome, usuário de 3 a 30 caracteres e senha de 10 a 256 caracteres.' });
    }
    if (store.users.some(item => item.username === username)) {
      return sendJson(response, 409, { error: 'Esse nome de usuário já está em uso.' });
    }
    const student = {
      id: crypto.randomUUID(), name, username, role: 'student',
      passwordHash: hashPassword(password), createdAt: new Date().toISOString()
    };
    store.users.push(student);
    await saveStore();
    return sendJson(response, 201, { student: publicUser(student), portalUrl: portalUrl(request) });
  }

  const examOpenRoute = /^\/api\/exams\/([^/]+)\/open$/.exec(route);
  if (examOpenRoute && method === 'POST' && user.role === 'student') {
    const exam = store.model?.exercises.find(item => item.id === examOpenRoute[1] && item.assessment);
    if (!exam || exam.published !== true || ['draft', 'closed', 'archived'].includes(exam.status)) {
      return sendJson(response, 404, { error: 'Avaliação não encontrada ou ainda não publicada.' });
    }
    const now = Date.now();
    const releaseAt = Date.parse(exam.assessment.releaseAt || '');
    const deadlineAt = Date.parse(exam.assessment.deadlineAt || '');
    if (Number.isFinite(releaseAt) && releaseAt > now) {
      return sendJson(response, 200, { notReleased: true, releaseAt: exam.assessment.releaseAt });
    }
    if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= now) {
      return sendJson(response, 410, { error: 'O prazo desta avaliação terminou.' });
    }
    let session = store.examSessions.find(item => item.examId === exam.id && item.studentId === user.id);
    if (session && exam.assessment.lockOnExit !== false && !session.locked
      && now - Date.parse(session.lastSeenAt) > 180_000) {
      session.locked = true;
      addNotification('teacher', 'exam-reopen-request', 'Aluno precisa retomar uma avaliação',
        `${user.name} saiu da avaliação “${exam.title}” por mais de 3 minutos.`,
        { examId: exam.id, studentId: user.id, studentName: user.name, examTitle: exam.title });
      await saveStore();
    }
    return sendJson(response, 200, {
      locked: Boolean(session?.locked), session: session || null,
      exercise: {
        ...exam,
        questionCount: exam.questions.length,
        questions: exam.questions.map(question => {
          const safeQuestion = { ...question };
          for (const key of ['answer', 'acceptedAnswers', 'expectedNotes', 'expectedIntervals', 'assemblyOrder', 'referenceNotes', 'feedback']) {
            delete safeQuestion[key];
          }
          return safeQuestion;
        })
      }
    });
  }

  const examStartRoute = /^\/api\/exams\/([^/]+)\/start$/.exec(route);
  if (examStartRoute && method === 'POST' && user.role === 'student') {
    const exam = store.model?.exercises.find(item => item.id === examStartRoute[1] && item.assessment);
    if (!exam || exam.published !== true || ['draft', 'closed', 'archived'].includes(exam.status)) {
      return sendJson(response, 404, { error: 'Avaliação não encontrada.' });
    }
    const now = Date.now();
    const releaseAt = Date.parse(exam.assessment.releaseAt || '');
    const deadlineAt = Date.parse(exam.assessment.deadlineAt || '');
    if (Number.isFinite(releaseAt) && releaseAt > now) return sendJson(response, 423, { error: 'Esta avaliação ainda não foi liberada.' });
    if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= now) return sendJson(response, 410, { error: 'O prazo desta avaliação terminou.' });
    let session = store.examSessions.find(item => item.examId === exam.id && item.studentId === user.id);
    if (session?.locked) return sendJson(response, 423, { error: 'Esta avaliação está bloqueada. Solicite a reabertura ao professor.' });
    if (!session) {
      session = { examId: exam.id, studentId: user.id, startedAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(), locked: false };
      store.examSessions.push(session);
    } else session.lastSeenAt = new Date(now).toISOString();
    await saveStore();
    return sendJson(response, 200, { session });
  }

  const examHeartbeatRoute = /^\/api\/exams\/([^/]+)\/heartbeat$/.exec(route);
  if (examHeartbeatRoute && method === 'POST' && user.role === 'student') {
    const exam = store.model?.exercises.find(item => item.id === examHeartbeatRoute[1] && item.assessment);
    const session = store.examSessions.find(item => item.examId === examHeartbeatRoute[1] && item.studentId === user.id);
    if (!exam || !session || session.locked) return sendJson(response, 423, { error: 'Esta avaliação está bloqueada.' });
    const now = Date.now();
    if (exam?.assessment?.lockOnExit !== false && now - Date.parse(session.lastSeenAt) > 180_000) {
      session.locked = true;
      addNotification('teacher', 'exam-reopen-request', 'Aluno precisa retomar uma avaliação',
        `${user.name} saiu da avaliação “${exam.title}” por mais de 3 minutos.`,
        { examId: exam.id, studentId: user.id, studentName: user.name, examTitle: exam.title });
      await saveStore();
      return sendJson(response, 423, { error: 'A avaliação foi bloqueada por inatividade.' });
    }
    session.lastSeenAt = new Date(now).toISOString();
    await saveStore();
    return sendJson(response, 200, { lastSeenAt: session.lastSeenAt });
  }

  const examReopenRoute = /^\/api\/exams\/([^/]+)\/request-reopen$/.exec(route);
  if (examReopenRoute && method === 'POST' && user.role === 'student') {
    const body = await readJson(request);
    const reason = String(body.reason || '').trim().slice(0, 500);
    const session = store.examSessions.find(item => item.examId === examReopenRoute[1] && item.studentId === user.id);
    const exam = store.model?.exercises.find(item => item.id === examReopenRoute[1] && item.assessment);
    if (!session?.locked || !exam) return sendJson(response, 409, { error: 'Não há uma avaliação bloqueada para reabrir.' });
    if (reason.length < 5) return sendJson(response, 400, { error: 'Explique o motivo com pelo menos 5 caracteres.' });
    const existing = store.notifications.find(item => item.type === 'exam-reopen-request' && item.examId === exam.id
      && item.studentId === user.id && !item.resolvedAt);
    if (existing) {
      existing.title = 'Solicitação para reabrir avaliação';
      existing.message = `${user.name}: ${reason}`;
      existing.reason = reason;
      existing.createdAt = new Date().toISOString();
      existing.readAt = '';
    } else {
      addNotification('teacher', 'exam-reopen-request', 'Solicitação para reabrir avaliação',
        `${user.name}: ${reason}`, { examId: exam.id, studentId: user.id, studentName: user.name, examTitle: exam.title, reason });
    }
    await saveStore();
    return sendJson(response, 201, { requested: true });
  }

  if (route === '/api/exams/unlock' && method === 'POST' && user.role === 'teacher') {
    const body = await readJson(request);
    const session = store.examSessions.find(item => item.examId === body.examId && item.studentId === body.studentId);
    const student = store.users.find(item => item.id === body.studentId && item.role === 'student');
    const exam = store.model?.exercises.find(item => item.id === body.examId && item.assessment);
    if (!session?.locked || !student || !exam) return sendJson(response, 404, { error: 'Solicitação de reabertura não encontrada.' });
    session.locked = false;
    session.lastSeenAt = new Date().toISOString();
    for (const notification of store.notifications) {
      if (notification.type === 'exam-reopen-request' && notification.examId === exam.id && notification.studentId === student.id) {
        notification.resolvedAt = session.lastSeenAt;
      }
    }
    addNotification(student.id, 'exam-reopened', 'Sua avaliação foi reaberta',
      `O professor liberou novamente “${exam.title}”.`, { examId: exam.id, exerciseId: exam.id });
    await saveStore();
    return sendJson(response, 200, { unlocked: true });
  }

  const studentRoute = /^\/api\/students\/([^/]+)$/.exec(route);
  if (studentRoute && method === 'DELETE' && user.role === 'teacher') {
    const index = store.users.findIndex(item => item.id === studentRoute[1] && item.role === 'student');
    if (index < 0) return sendJson(response, 404, { error: 'Conta de aluno não encontrada.' });
    const [removed] = store.users.splice(index, 1);
    if (store.model) {
      store.model.attempts = store.model.attempts.filter(attempt => attempt.studentId !== removed.id);
      store.model.trails = (store.model.trails || []).filter(step => step.studentId !== removed.id);
      store.model.trailSettings = (store.model.trailSettings || []).filter(item => item.studentId !== removed.id);
    }
    for (const [token, userId] of sessions) if (userId === removed.id) sessions.delete(token);
    await saveStore();
    return sendJson(response, 200, { ok: true });
  }

  if (route === '/api/practice/request' && method === 'POST' && user.role === 'student') {
    const body = await readJson(request);
    const lesson = store.model?.lessons.find(item => item.id === body.lessonId && item.published === true);
    if (!lesson) return sendJson(response, 404, { error: 'Aula publicada não encontrada.' });
    const sourceExercises = (store.model.exercises || []).filter(item => item.published === true
      && !item.assessment && !item.personalizedFor && !['draft', 'closed', 'archived'].includes(item.status)
      && (item.lessonIds || []).includes(lesson.id));
    const questionPool = sourceExercises.flatMap(exercise => (exercise.questions || []).map(question => ({
      ...question,
      sourceExerciseId: exercise.id,
      sourceExerciseTitle: exercise.title,
      sourceLessonId: lesson.id,
      sourceLessonTitle: lesson.title,
      sourceBlockId: lesson.blockId
    })));
    if (!questionPool.length) return sendJson(response, 409, { error: 'Esta aula ainda não tem questões publicadas relacionadas.' });
    for (let index = questionPool.length - 1; index > 0; index -= 1) {
      const swap = crypto.randomInt(index + 1);
      [questionPool[index], questionPool[swap]] = [questionPool[swap], questionPool[index]];
    }
    const exercise = {
      id: crypto.randomUUID(), title: `Prática · ${lesson.title}`,
      instructions: `Lista personalizada com questões de ${lesson.title}.`,
      difficulty: 'Geral', status: 'published', published: true, showAnswers: false,
      lessonIds: [], questions: questionPool.slice(0, 10).map(question => ({ ...question, id: crypto.randomUUID() })),
      personalizedFor: user.id, sourceLessonId: lesson.id, createdAt: new Date().toISOString()
    };
    store.model.exercises.push(exercise);
    await saveStore();
    return sendJson(response, 201, { exercise });
  }

  if (route === '/api/attempts' && method === 'POST' && user.role === 'student') {
    const body = await readJson(request);
    const source = body.attempt;
    const exercise = store.model?.exercises.find(item => item.id === source?.exerciseId);
    if (!exercise || exercise.published !== true || ['draft', 'archived', 'closed'].includes(exercise.status)
        || !Array.isArray(source.answers)) {
      return sendJson(response, 404, { error: 'Exercício publicado não encontrado.' });
    }
    let examSession = null;
    if (exercise.assessment) {
      examSession = store.examSessions.find(item => item.examId === exercise.id && item.studentId === user.id);
      const deadlineAt = Date.parse(exercise.assessment.deadlineAt || '');
      const startedAt = Date.parse(examSession?.startedAt || '');
      if (!examSession || examSession.locked || !Number.isFinite(startedAt)) {
        return sendJson(response, 423, { error: 'Abra a avaliação para iniciar ou solicite a liberação ao professor.' });
      }
      if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= Date.now()) {
        return sendJson(response, 410, { error: 'O prazo desta avaliação terminou.' });
      }
      const durationLimit = Math.max(1, Number(exercise.assessment.durationMinutes) || 1) * 60;
      if ((Date.now() - startedAt) / 1000 > durationLimit) {
        return sendJson(response, 410, { error: 'O tempo desta avaliação terminou.' });
      }
    }
    const allowedQuestions = new Map(exercise.questions.map(question => [question.id, question]));
    for (const answer of source.answers) {
      const question = allowedQuestions.get(answer.questionId);
      if (question?.type !== 'rhythm') continue;
      const maxExecutions = Math.min(10, Math.max(1, Number(question.retryLimit) || 3));
      if (!Array.isArray(answer.value?.plays) || !answer.value.plays.length
          || answer.value.plays.length > maxExecutions) {
        return sendJson(response, 400, { error: `A atividade rítmica precisa conter entre 1 e ${maxExecutions} execução(ões).` });
      }
      const attemptsUsed = store.model.attempts.reduce((total, attempt) => total + (attempt.studentId === user.id
        && attempt.exerciseId === exercise.id
        ? (attempt.answers || []).filter(previous => previous.questionId === question.id)
          .reduce((count, previous) => count + (Array.isArray(previous.value?.plays) ? previous.value.plays.length : 1), 0)
        : 0), 0);
      if (attemptsUsed + answer.value.plays.length > maxExecutions) {
        return sendJson(response, 409, { error: `Você já usou as ${maxExecutions} execuções permitidas nesta questão rítmica.` });
      }
    }
    const configuredOctave = Number(store.model.profile.defaultOctave);
    const defaultOctave = Number.isInteger(configuredOctave) && configuredOctave >= -1 && configuredOctave <= 8
      ? configuredOctave
      : 4;
    const answers = source.answers.filter(answer => allowedQuestions.has(answer.questionId)).map(answer => {
      const question = allowedQuestions.get(answer.questionId);
      const points = Math.max(0, Number(question.points) || 0);
      const correct = gradeAnswer(question, answer.value, defaultOctave);
      const manual = correct === null;
      return {
        questionId: question.id,
        prompt: question.prompt,
        points,
        value: question.type === 'rhythm' ? normalizeRhythmAnswer(question, answer.value) : answer.value,
        correct: Boolean(correct),
        manual,
        manualScore: 0
      };
    });
    if (!answers.length) return sendJson(response, 400, { error: 'A tentativa não contém respostas válidas.' });
    const attachments = Array.isArray(source.attachments)
      ? source.attachments.map(item => ({
          id: String(item.id || ''),
          name: String(item.name || 'arquivo').replace(/[\r\n]/g, '').slice(0, 180),
          type: String(item.type || 'application/octet-stream').slice(0, 120),
          size: Math.max(0, Number(item.size) || 0)
        })).filter(item => /^[a-z0-9._-]{1,120}$/i.test(item.id))
      : [];
    const attempt = {
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      studentId: user.id,
      profileName: user.name,
      answers,
      attachments,
      score: answers.reduce((sum, answer) => sum + (answer.correct && !answer.manual ? answer.points : 0), 0),
      maxScore: answers.reduce((sum, answer) => sum + answer.points, 0),
      startedAt: examSession?.startedAt || (typeof source.startedAt === 'string' ? source.startedAt : ''),
      durationSeconds: Math.min(86_400, Math.max(0, examSession
        ? Math.round((Date.now() - Date.parse(examSession.startedAt)) / 1000)
        : Number(source.durationSeconds) || 0)),
      createdAt: new Date().toISOString()
    };
    store.model.attempts.push(attempt);
    addNotification('teacher', 'response-submitted', 'Nova resposta de aluno',
      `${user.name} respondeu “${exercise.title}”.`,
      { exerciseId: exercise.id, attemptId: attempt.id, studentId: user.id });
    await saveStore();
    return sendJson(response, 201, { attempt });
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const publicFiles = new Set([
  '/index.html',
  '/icone.png',
  '/notarium.css',
  '/catalog.json',
  '/app.js',
  '/api-url.js',
  '/media-store.js',
  '/musicxml.js',
  '/piano.js',
  '/storage.js',
  '/chart.umd.js',
  '/jszip.min.js',
  '/opensheetmusicdisplay.min.js'
]);

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const corsAllowed = allowCorsOrigin(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(corsAllowed ? 204 : 403, { 'X-Content-Type-Options': 'nosniff' });
      response.end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
      response.writeHead(405, { Allow: 'GET, POST, PUT, DELETE', 'X-Content-Type-Options': 'nosniff' });
      response.end('Método não permitido.');
      return;
    }
    try { return await handleApi(request, response, url); }
    catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error('Falha ao processar API do Notarium:', error);
      return sendJson(response, 500, { error: 'Erro interno do servidor.' });
    }
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' });
    response.end('Método não permitido.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { 'X-Content-Type-Options': 'nosniff' });
    response.end('Endereço inválido.');
    return;
  }

  const requestedPath = pathname === '/' || pathname === '/login' ? '/index.html' : pathname;
  if (!publicFiles.has(requestedPath)) {
    response.writeHead(404, { 'X-Content-Type-Options': 'nosniff' });
    response.end('Arquivo não encontrado.');
    return;
  }
  const staticRoot = publicRoot;
  const filePath = path.resolve(staticRoot, `.${requestedPath}`);
  const relativePath = path.relative(staticRoot, filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath)) {
    response.writeHead(403, { 'X-Content-Type-Options': 'nosniff' });
    response.end('Acesso negado.');
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    const resolvedFile = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const content = await fs.readFile(resolvedFile);
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': content.length,
      'Content-Type': contentTypes[path.extname(resolvedFile).toLowerCase()] || mimeTypes[path.extname(resolvedFile).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'X-Content-Type-Options': 'nosniff' });
    response.end(error.code === 'ENOENT' ? 'Arquivo não encontrado.' : 'Não foi possível acessar o arquivo.');
    if (error.code !== 'ENOENT') console.error('Falha ao servir arquivo do Notarium:', error);
  }
}

function localAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

async function start() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um número entre 1 e 65535.');
  await loadStore();
  const server = http.createServer((request, response) => void handleRequest(request, response));
  server.listen(port, '0.0.0.0', () => {
    console.log(`Notarium pronto em http://127.0.0.1:${port}/`);
    console.log(`Acesso na rede local: http://${localAddress()}:${port}/`);
    console.log(`Dados de contas e conteúdo: ${dataFile}`);
    if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) {
      console.warn('Configure PUBLIC_URL com a URL HTTPS pública para gerar links corretos para os alunos.');
    }
  });
}

return { handleApi, handleRequest, start, modelFor, publicUser, emptyModel };
}

module.exports = { createApi };

if (require.main === module) createApi().start().catch(error => {
  console.error('Não foi possível iniciar o Notarium:', error.message);
  process.exitCode = 1;
});
