'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const bundledMedia = require('./seed-media');
const bundledCatalog = require('./seed-catalog');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DEFAULT_DATA_DIR = path.join(ROOT, 'notarium-data');
const BODY_LIMIT = 32 * 1024 * 1024;
const MEDIA_LIMIT = 20 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXAM_IDLE_MS = 3 * 60 * 1000;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;
const SAFE_MEDIA_TYPES = new Set([
  'application/pdf', 'application/xml', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', 'application/vnd.recordare.musicxml',
  'application/vnd.recordare.musicxml+xml',
  'application/zip', 'text/xml', 'text/plain',
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'audio/aac', 'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/ogg',
  'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
  'video/mp4', 'video/ogg', 'video/webm'
]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ApiError(status, message);
}

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function clone(value) {
  return structuredClone(value);
}

function emptyModel() {
  return {
    profile: {
      displayName: 'Músico',
      username: '',
      role: 'teacher',
      bio: '',
      avatarDataUrl: '',
      defaultOctave: 4,
      theme: 'light'
    },
    version: 1,
    blocks: [],
    playlists: [],
    lessons: [],
    exerciseBlocks: [],
    exercises: [],
    trails: [],
    attempts: [],
    learningProgress: [],
    trailSettings: []
  };
}

function initialStore() {
  return {
    version: 1,
    users: [],
    sessions: [],
    notifications: [],
    examSessions: [],
    media: [],
    seeds: { catalog: true },
    model: clone(bundledCatalog)
  };
}

function cleanJson(value, depth = 0) {
  if (depth > 40) fail(400, 'Os dados enviados são muito profundos.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(400, 'Os dados incluem um número inválido.');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => cleanJson(item, depth + 1));
  if (!value || typeof value !== 'object') fail(400, 'Os dados enviados não são válidos.');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      fail(400, 'Os dados incluem uma propriedade não permitida.');
    }
    result[key] = cleanJson(item, depth + 1);
  }
  return result;
}

function normalizeModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, 'O modelo enviado não é válido.');
  }
  const model = Object.assign(emptyModel(), cleanJson(value));
  if (model.trailSettings && typeof model.trailSettings === 'object'
    && !Array.isArray(model.trailSettings) && Object.keys(model.trailSettings).length === 0) {
    model.trailSettings = [];
  }
  for (const field of ['blocks', 'playlists', 'lessons', 'exerciseBlocks', 'exercises', 'trails', 'attempts', 'trailSettings']) {
    if (!Array.isArray(model[field])) fail(400, `O campo ${field} precisa ser uma lista.`);
    if (model[field].length > 10000) fail(400, `O campo ${field} excede o limite permitido.`);
  }
  if (!model.profile || typeof model.profile !== 'object' || Array.isArray(model.profile)) {
    model.profile = emptyModel().profile;
  }
  return model;
}

function isPublished(item) {
  return item?.published === true || item?.status === 'published';
}

function normalizeAnswer(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

function safeUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    username: user.username,
    lastSeenAt: user.lastSeenAt || null,
    createdAt: user.createdAt || null
  };
}

function hasStudentRelease(item, userId) {
  if (!item || item.releaseMode !== 'selected') return true;
  const ids = Array.isArray(item.releasedStudentIds) ? item.releasedStudentIds : [];
  return ids.includes(userId);
}

function exerciseIsLocked(store, exercise, userId) {
  if (!exercise) return false;
  if (exercise.releaseMode === 'selected') return !hasStudentRelease(exercise, userId);
  if (exercise.exerciseBlockId) {
    const block = store.model.exerciseBlocks.find(item => item.id === exercise.exerciseBlockId);
    if (block && !hasStudentRelease(block, userId)) return true;
  }
  return false;
}

function lessonIsLocked(store, lesson, userId) {
  if (!lesson) return false;
  if (lesson.releaseMode === 'selected') return !hasStudentRelease(lesson, userId);
  if (lesson.blockId) {
    const block = store.model.blocks.find(item => item.id === lesson.blockId);
    if (block && !hasStudentRelease(block, userId)) return true;
  }
  return false;
}

function blockIsLocked(store, block, userId) {
  if (hasStudentRelease(block, userId)) return false;
  const children = store.model.lessons.filter(item => item.blockId === block.id && isPublished(item));
  return children.length === 0 || children.every(item => lessonIsLocked(store, item, userId));
}

function exerciseBlockIsLocked(store, block, userId) {
  if (hasStudentRelease(block, userId)) return false;
  const children = store.model.exercises
    .filter(item => item.exerciseBlockId === block.id && isPublished(item));
  return children.length === 0 || children.every(item => exerciseIsLocked(store, item, userId));
}

function containsMediaReference(value, mediaId) {
  if (Array.isArray(value)) return value.some(item => containsMediaReference(item, mediaId));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    (key === 'mediaId' || key === 'musicMediaId'
      || key === 'promptMediaId' || key === 'promptScoreMediaId' || key === 'audioMediaId') && item === mediaId
      || containsMediaReference(item, mediaId));
}

function mediaIsAccessibleToStudent(store, mediaId, userId) {
  const lessonReferences = store.model.lessons.filter(item =>
    containsMediaReference(item.content, mediaId));
  const exerciseReferences = store.model.exercises.filter(item =>
    containsMediaReference(item.questions, mediaId));
  if (!lessonReferences.length && !exerciseReferences.length) return true;
  return lessonReferences.some(item => isPublished(item) && !lessonIsLocked(store, item, userId))
    || exerciseReferences.some(item => isPublished(item)
      && (!item.personalizedFor || item.studentId === userId)
      && !exerciseIsLocked(store, item, userId));
}

function modelForUser(store, user) {
  const model = clone(store.model);
  if (user.role === 'student') {
    const visibleLessons = model.lessons.filter(item =>
      isPublished(item) && (!item.personalizedFor || item.studentId === user.id)).map(item => {
        const cloneItem = clone(item);
        const { releaseMode, releasedStudentIds, ...studentItem } = cloneItem;
        studentItem.accessLocked = lessonIsLocked(store, item, user.id);
        if (studentItem.accessLocked) studentItem.content = [];
        return studentItem;
      });
    const visibleExercises = model.exercises.filter(item =>
      isPublished(item) && (!item.personalizedFor || item.studentId === user.id)).map(item => {
        const cloneItem = clone(item);
        const { releaseMode, releasedStudentIds, ...studentItem } = cloneItem;
        studentItem.accessLocked = exerciseIsLocked(store, item, user.id);
        studentItem.questionCount = Array.isArray(item.questions) ? item.questions.length : 0;
        studentItem.questionTypes = [...new Set((Array.isArray(item.questions) ? item.questions : [])
          .map(question => question.type).filter(type => typeof type === 'string'))];
        if (studentItem.accessLocked) studentItem.questions = [];
        return studentItem;
      });
    const lessonIds = new Set(visibleLessons.map(item => item.id));
    const blockIds = new Set(visibleLessons.map(item => item.blockId).filter(Boolean));
    const exerciseBlockIds = new Set(visibleExercises.map(item => item.exerciseBlockId).filter(Boolean));
    model.lessons = visibleLessons;
    model.exercises = visibleExercises;
    model.blocks = model.blocks.filter(item => blockIds.has(item.id)).map(item => {
      const { releaseMode, releasedStudentIds, ...studentItem } = item;
      return { ...studentItem, accessLocked: blockIsLocked(store, item, user.id) };
    });
    model.exerciseBlocks = model.exerciseBlocks.filter(item => exerciseBlockIds.has(item.id)).map(item => {
      const { releaseMode, releasedStudentIds, ...studentItem } = item;
      return {
        ...studentItem,
        accessLocked: exerciseBlockIsLocked(store, item, user.id)
      };
    });
    const playlistIds = new Set(model.exerciseBlocks.map(item => item.playlistId).filter(Boolean));
    const visibleExerciseIds = new Set(visibleExercises.map(item => item.id));
    const exerciseBlockIdSet = new Set(model.exerciseBlocks.map(item => item.id));
    model.playlists = model.playlists.filter(item => playlistIds.has(item.id)
      || (Array.isArray(item.entries) && item.entries.some(entry => entry
        && ((entry.type === 'exercise' && visibleExerciseIds.has(entry.contentId))
          || (entry.type === 'lesson' && lessonIds.has(entry.contentId))
          || (entry.type === 'exerciseBlock' && exerciseBlockIdSet.has(entry.contentId))))));
    model.trails = model.trails.filter(item => item.published !== false
      && (!item.lessonId || lessonIds.has(item.lessonId)));
    model.attempts = model.attempts.filter(item => item.studentId === user.id);
  }
  model.profile = {
    ...model.profile,
    role: user.role,
    displayName: user.name,
    username: user.username
  };
  return model;
}

function portalUrl(req) {
  const host = String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:[\]-]/g, '');
  return `http://${host || 'localhost'}/?login=1`;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '');
  if (!USERNAME_PATTERN.test(username)) {
    fail(400, 'O nome de usuário deve ter de 3 a 30 caracteres e usar somente letras, números, ponto, traço ou sublinhado.');
  }
  return username;
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 100) fail(400, 'Informe um nome com até 100 caracteres.');
  return name;
}

async function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    fail(400, 'A senha deve ter pelo menos 8 caracteres.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: hash.toString('hex') };
}

async function verifyPassword(password, user) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const actual = await scrypt(password, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqualHex(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function addNotification(store, recipientId, fields) {
  store.notifications.unshift({
    id: id(),
    recipientId,
    createdAt: nowIso(),
    readAt: null,
    ...fields
  });
  if (store.notifications.length > 5000) store.notifications.length = 5000;
}

function notifyTeacher(store, fields) {
  const teacher = store.users.find(user => user.role === 'teacher');
  if (teacher) addNotification(store, teacher.id, fields);
}

function findExercise(store, exerciseId) {
  return store.model.exercises.find(item => item.id === exerciseId);
}

function examSessionIndex(store, studentId, examId) {
  return store.examSessions.findIndex(item =>
    item.studentId === studentId && item.examId === examId);
}

function validateMediaData(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MEDIA_LIMIT * 4 / 3) + 256) {
    fail(413, 'O arquivo excede o limite de 20 MB.');
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) fail(400, 'O arquivo enviado não está em um formato válido.');
  const type = match[1].toLowerCase();
  if (!SAFE_MEDIA_TYPES.has(type)) fail(400, 'Este tipo de arquivo não é permitido.');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > MEDIA_LIMIT) fail(413, 'O arquivo precisa ter até 20 MB.');
  return { type, data };
}

function parseId(value, label = 'Identificador') {
  let result;
  try {
    result = decodeURIComponent(value);
  } catch {
    fail(400, `${label} inválido.`);
  }
  if (!result || result.length > 200 || /[\\/\0]/.test(result)) fail(400, `${label} inválido.`);
  return result;
}

function createFileStorage(dataDir) {
  const storeFile = path.join(dataDir, 'store.json');
  const mediaDir = path.join(dataDir, 'media');
  return {
    async init() {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      await fs.mkdir(mediaDir, { recursive: true, mode: 0o700 });
    },
    async readStore() {
      try {
        return await fs.readFile(storeFile, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async writeStore(content) {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      const tempFile = path.join(dataDir, `.store-${crypto.randomUUID()}.tmp`);
      await fs.writeFile(tempFile, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      for (let attempt = 0; ; attempt += 1) {
        try {
          await fs.rename(tempFile, storeFile);
          break;
        } catch (error) {
          if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 4) {
            await fs.unlink(tempFile).catch(() => {});
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
    },
    async backup(content) {
      const backupDir = path.join(dataDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      const backupFile = path.join(backupDir, `store-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      await fs.writeFile(backupFile, content, { encoding: 'utf8', mode: 0o600 });
      const backupFiles = (await fs.readdir(backupDir)).filter(name => /^store-.*\.json$/.test(name)).sort();
      for (const oldName of backupFiles.slice(0, Math.max(0, backupFiles.length - 30))) {
        await fs.rm(path.join(backupDir, oldName), { force: true });
      }
    },
    async writeMedia(filename, data) {
      await fs.mkdir(mediaDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(mediaDir, filename), data, { flag: 'wx', mode: 0o600 });
    },
    async readMedia(filename) {
      return fs.readFile(path.join(mediaDir, filename));
    },
    async deleteMedia(filename) {
      await fs.unlink(path.join(mediaDir, filename));
    }
  };
}

function createApplication(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.NOTARIUM_DATA_DIR || DEFAULT_DATA_DIR);
  const storage = options.storage || createFileStorage(dataDir);
  const examIdleMs = Number(options.examIdleMs ?? EXAM_IDLE_MS);
  let store;
  let writeQueue = Promise.resolve();
  let lastBackupAt = 0;
  const loginAttempts = new Map();

  async function persist(next) {
    await storage.writeStore(JSON.stringify(next));
    const now = Date.now();
    if (now - lastBackupAt >= 24 * 60 * 60 * 1000) {
      await storage.backup(JSON.stringify(next));
      lastBackupAt = now;
    }
  }

  async function initialize() {
    await storage.init();
    try {
      const raw = await storage.readStore();
      if (raw === null) {
        const error = new Error('Store not found.');
        error.code = 'ENOENT';
        throw error;
      }
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.users)
        || !Array.isArray(saved.sessions) || !saved.model) {
        throw new Error('Unsupported or invalid Notarium data file.');
      }
      store = Object.assign(initialStore(), saved);
      if (!Object.prototype.hasOwnProperty.call(saved, 'seeds')) store.seeds = {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not load Notarium data: ${error.message}`);
      store = initialStore();
      await persist(store);
    }
    store.model = normalizeModel(store.model);
    if (!Array.isArray(store.learningProgress)) store.learningProgress = [];
    const next = clone(store);
    let seeded = false;
    // Cria a conta padrão do professor (professor / professor123) quando ainda não há professor.
    const seedDefaultTeacher = options.seedDefaultTeacher ?? process.env.NODE_ENV !== 'production';
    if (seedDefaultTeacher && !next.users.some(user => user.role === 'teacher')) {
      const credentials = await passwordRecord('professor123');
      const account = {
        id: id(),
        role: 'teacher',
        name: 'Professor',
        username: 'professor',
        usernameKey: 'professor',
        ...credentials,
        createdAt: nowIso(),
        lastSeenAt: null
      };
      next.users.push(account);
      next.model.profile = {
        ...next.model.profile,
        displayName: 'Professor',
        username: 'professor',
        role: 'teacher'
      };
      seeded = true;
    }
    for (const item of bundledMedia) {
      if (next.media.some(media => media.id === item.id)) continue;
      const data = Buffer.from(item.data, 'base64');
      if (data.length !== item.size || data.toString('base64') !== item.data
        || !data.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
        throw new Error(`Bundled media "${item.name}" is invalid.`);
      }
      const filename = `${crypto.randomUUID()}.bin`;
      await storage.writeMedia(filename, data);
      next.media.push({
        id: item.id,
        filename,
        ownerId: null,
        name: item.name,
        type: item.type,
        size: data.length,
        createdAt: item.updatedAt || nowIso()
      });
      seeded = true;
    }
    if (store.seeds?.catalog !== true) {
      for (const block of bundledCatalog.exerciseBlocks) {
        if (next.model.exerciseBlocks.some(item => item.id === block.id)) continue;
        next.model.exerciseBlocks.push(clone(block));
      }
      for (const exercise of bundledCatalog.exercises) {
        if (next.model.exercises.some(item => item.id === exercise.id)) continue;
        next.model.exercises.push(clone(exercise));
      }
      next.seeds = { ...(next.seeds || {}), catalog: true };
      seeded = true;
    }
    if (seeded) {
      await persist(next);
      store = next;
    }
  }

  function transaction(action) {
    const operation = writeQueue.then(async () => {
      const next = clone(store);
      const result = await action(next);
      await persist(next);
      store = next;
      return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function requireUser(req, role) {
    const header = String(req.headers.authorization || '');
    const match = /^Bearer ([A-Za-z0-9_-]{40,200})$/.exec(header);
    if (!match) fail(401, 'Entre na sua conta para continuar.');
    const digest = tokenDigest(match[1]);
    const session = store.sessions.find(item =>
      safeEqualHex(item.tokenHash, digest) && Date.parse(item.expiresAt) > Date.now());
    if (!session) fail(401, 'Sua sessão expirou. Entre novamente.');
    const user = store.users.find(item => item.id === session.userId);
    if (!user) fail(401, 'Sua sessão não é mais válida.');
    if (role && user.role !== role) fail(403, 'Você não tem permissão para esta ação.');
    return user;
  }

  async function readBody(req) {
    const length = Number(req.headers['content-length'] || 0);
    if (length > BODY_LIMIT) fail(413, 'A solicitação excede o limite permitido.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > BODY_LIMIT) fail(413, 'A solicitação excede o limite permitido.');
      chunks.push(chunk);
    }
    if (!size) return {};
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail(400, 'O corpo da solicitação precisa ser JSON válido.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(400, 'O corpo da solicitação precisa ser um objeto JSON.');
    }
    return cleanJson(parsed);
  }

  function json(res, status, value) {
    const output = JSON.stringify(value);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(output),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    });
    res.end(output);
  }

  function createSession(storeCopy, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    storeCopy.sessions.push({
      tokenHash: tokenDigest(token),
      userId: user.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    });
    return token;
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    const pathname = url.pathname;
    if (method === 'GET' && pathname === '/api/setup') {
      return json(res, 200, { teacherExists: store.users.some(user => user.role === 'teacher') });
    }

    if (method === 'POST' && (pathname === '/api/auth/bootstrap' || pathname === '/api/auth/login')) {
      const body = await readBody(req);
      const username = normalizeUsername(body.username);
      if (pathname === '/api/auth/login') {
        const clientIp = String(req.socket.remoteAddress || 'unknown');
        const attempt = loginAttempts.get(clientIp) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        if (Date.now() > attempt.resetAt) {
          attempt.count = 0;
          attempt.resetAt = Date.now() + 15 * 60 * 1000;
        }
        if (attempt.count >= 8) {
          loginAttempts.set(clientIp, attempt);
          fail(429, 'Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.');
        }
      }
      let user;
      if (pathname === '/api/auth/bootstrap') {
        const name = normalizeName(body.name);
        const credentials = await passwordRecord(body.password);
        const created = await transaction(next => {
          if (next.users.some(item => item.role === 'teacher')) {
            fail(409, 'A conta de professor já foi configurada.');
          }
          const account = {
            id: id(), role: 'teacher', name, username,
            usernameKey: username.toLowerCase(), ...credentials,
            createdAt: nowIso(), lastSeenAt: null
          };
          next.users.push(account);
          next.model.profile = { ...next.model.profile, displayName: name, username, role: 'teacher' };
          const token = createSession(next, account);
          return { user: safeUser(account), token, model: modelForUser(next, account) };
        });
        return json(res, 201, { ...created, portalUrl: portalUrl(req) });
      }

      user = store.users.find(item => item.usernameKey === username.toLowerCase());
      if (!user || !(await verifyPassword(body.password, user))) {
        const clientIp = String(req.socket.remoteAddress || 'unknown');
        const attempt = loginAttempts.get(clientIp) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        attempt.count++;
        loginAttempts.set(clientIp, attempt);
        fail(401, 'Usuário ou senha incorretos.');
      }
      const loggedIn = await transaction(next => {
        const account = next.users.find(item => item.id === user.id);
        if (!account) fail(401, 'Usuário ou senha incorretos.');
        account.lastSeenAt = nowIso();
        const token = createSession(next, account);
        return { user: safeUser(account), token, model: modelForUser(next, account) };
      });
      loginAttempts.delete(String(req.socket.remoteAddress || 'unknown'));
      return json(res, 200, { ...loggedIn, portalUrl: portalUrl(req) });
    }

    const user = requireUser(req);

    if (method === 'GET' && pathname === '/api/auth/session') {
      return json(res, 200, { user: safeUser(user), model: modelForUser(store, user) });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const digest = tokenDigest(req.headers.authorization.slice(7));
      await transaction(next => {
        next.sessions = next.sessions.filter(item => item.tokenHash !== digest);
      });
      return json(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/model') {
      return json(res, 200, { model: modelForUser(store, user) });
    }

    if (method === 'GET' && pathname === '/api/progress') {
      if (user.role !== 'student') fail(403, 'O histórico de aprendizagem é exclusivo da conta do aluno.');
      const progress = store.learningProgress
        .filter(item => item.studentId === user.id)
        .map(({ studentId, ...item }) => item);
      return json(res, 200, { progress });
    }

    const progressMatch = /^\/api\/progress\/(lesson|exercise)\/([^/]+)$/.exec(pathname);
    if (method === 'PUT' && progressMatch) {
      if (user.role !== 'student') fail(403, 'Somente alunos podem atualizar o próprio histórico.');
      const contentType = progressMatch[1];
      const contentId = parseId(progressMatch[2], 'Identificador do conteúdo');
      const body = await readBody(req);
      if (typeof body.completed !== 'boolean') fail(400, 'Informe se o conteúdo foi concluído.');
      const item = contentType === 'lesson'
        ? store.model.lessons.find(entry => entry.id === contentId && isPublished(entry))
        : store.model.exercises.find(entry => entry.id === contentId && isPublished(entry) && !entry.assessment);
      if (!item) fail(404, 'Conteúdo publicado não encontrado.');
      if (contentType === 'lesson'
        ? lessonIsLocked(store, item, user.id)
        : exerciseIsLocked(store, item, user.id)) {
        fail(403, 'Este conteúdo ainda não foi liberado para você.');
      }
      const progress = await transaction(next => {
        const index = next.learningProgress.findIndex(entry =>
          entry.studentId === user.id && entry.contentType === contentType && entry.contentId === contentId);
        if (!body.completed) {
          if (index >= 0) next.learningProgress.splice(index, 1);
          return null;
        }
        const entry = {
          studentId: user.id,
          contentType,
          contentId,
          completedAt: index >= 0 ? next.learningProgress[index].completedAt : nowIso(),
          updatedAt: nowIso()
        };
        if (index >= 0) next.learningProgress[index] = entry;
        else next.learningProgress.push(entry);
        return entry;
      });
      return json(res, 200, {
        progress: progress ? (({ studentId, ...visible }) => visible)(progress) : null,
        completed: body.completed
      });
    }

    if (method === 'PUT' && pathname === '/api/model') {
      requireUser(req, 'teacher');
      const body = await readBody(req);
      const incoming = normalizeModel(body.model);
      const previous = store.model;
      const result = await transaction(next => {
        const savedModel = incoming;
        const incomingAttempts = new Map(savedModel.attempts.map(item => [item.id, item]));
        for (const attempt of next.model.attempts) {
          if (!incomingAttempts.has(attempt.id)) savedModel.attempts.push(attempt);
        }
        for (const lesson of savedModel.lessons) {
          const previousLesson = previous.lessons.find(item => item.id === lesson.id);
          if (isPublished(lesson) && (!previousLesson || !isPublished(previousLesson))) {
            for (const student of next.users.filter(item => item.role === 'student')) {
              if (lessonIsLocked({ model: savedModel }, lesson, student.id)) continue;
              addNotification(next, student.id, {
                type: 'new-lesson',
                title: 'Nova aula disponível',
                message: `Uma nova aula foi publicada: ${lesson.title || 'Aula'}.`,
                contentKey: `lesson:${lesson.id}`,
                lessonId: lesson.id
              });
            }
          }
          if (isPublished(lesson) && previousLesson && isPublished(previousLesson)) {
            for (const student of next.users.filter(item => item.role === 'student')) {
              if (lessonIsLocked({ model: previous }, previousLesson, student.id)
                && !lessonIsLocked({ model: savedModel }, lesson, student.id)) {
                addNotification(next, student.id, {
                  type: 'content-released',
                  title: 'Aula liberada para você',
                  message: `O professor liberou a aula ${lesson.title || 'Aula'} para você.`,
                  contentKey: `lesson:${lesson.id}`,
                  lessonId: lesson.id
                });
              }
            }
          }
        }
        for (const exercise of savedModel.exercises) {
          const previousExercise = previous.exercises.find(item => item.id === exercise.id);
          const wasPublished = previousExercise && isPublished(previousExercise);
          if (isPublished(exercise) && exercise.assessment && !wasPublished) {
            for (const student of next.users.filter(item => item.role === 'student')) {
              if (exerciseIsLocked({ model: savedModel }, exercise, student.id)) continue;
              addNotification(next, student.id, {
                type: 'exam-released',
                title: 'Nova avaliação disponível',
                message: `Uma avaliação foi publicada: ${exercise.title || 'Avaliação'}.`,
                examId: exercise.id,
                exerciseId: exercise.id
              });
            }
          }
          if (isPublished(exercise) && !exercise.assessment && !exercise.personalizedFor
            && !wasPublished) {
            for (const student of next.users.filter(item => item.role === 'student')) {
              if (exerciseIsLocked({ model: savedModel }, exercise, student.id)) continue;
              addNotification(next, student.id, {
                type: 'new-exercise',
                title: 'Novo exercício disponível',
                message: `Um novo exercício foi publicado: ${exercise.title || 'Exercício'}.`,
                contentKey: `exercise:${exercise.id}`,
                exerciseId: exercise.id
              });
            }
          }
          if (wasPublished && isPublished(exercise) && previousExercise) {
            for (const student of next.users.filter(item => item.role === 'student')) {
              if (exerciseIsLocked({ model: previous }, previousExercise, student.id)
                && !exerciseIsLocked({ model: savedModel }, exercise, student.id)) {
                addNotification(next, student.id, {
                  type: 'content-released',
                  title: exercise.assessment ? 'Avaliação liberada para você' : 'Atividade liberada para você',
                  message: `O professor liberou ${exercise.title || (exercise.assessment ? 'uma avaliação' : 'uma atividade')} para você.`,
                  contentKey: `exercise:${exercise.id}`,
                  exerciseId: exercise.id,
                  examId: exercise.assessment ? exercise.id : undefined
                });
              }
            }
          }
        }
        const publishedTrails = trails => trails.filter(item => item.published !== false);
        if (JSON.stringify(publishedTrails(previous.trails)) !== JSON.stringify(publishedTrails(savedModel.trails))) {
          for (const student of next.users.filter(item => item.role === 'student')) {
            addNotification(next, student.id, {
              type: 'trail-update',
              title: 'Trilha de aprendizagem atualizada',
              message: 'O professor atualizou a trilha de aprendizagem.'
            });
          }
        }
        next.model = savedModel;
        return { model: modelForUser(next, user) };
      });
      return json(res, 200, result);
    }

    if (method === 'POST' && pathname === '/api/media') {
      const body = await readBody(req);
      const mediaId = parseId(String(body.id || ''), 'Identificador do arquivo');
      const { type, data } = validateMediaData(body.dataUrl);
      const filename = `${crypto.randomUUID()}.bin`;
      await storage.writeMedia(filename, data);
      const media = {
        id: mediaId,
        filename,
        ownerId: user.role === 'student' ? user.id : null,
        name: String(body.name || 'material').replace(/[\r\n"]/g, '').slice(0, 180) || 'material',
        type,
        size: data.length,
        createdAt: nowIso()
      };
      try {
        await transaction(next => {
          if (next.media.some(item => item.id === mediaId)) {
            fail(409, 'Já existe um arquivo com este identificador.');
          }
          next.media.push(media);
        });
      } catch (error) {
        await storage.deleteMedia(filename).catch(() => {});
        throw error;
      }
      return json(res, 201, { media: { id: media.id, name: media.name, type: media.type, size: media.size } });
    }

    const mediaMatch = /^\/api\/media\/([^/]+)$/.exec(pathname);
    if ((method === 'GET' || method === 'HEAD') && mediaMatch) {
      const mediaId = parseId(mediaMatch[1], 'Identificador do arquivo');
      const item = store.media.find(entry => entry.id === mediaId);
      if (!item || (item.ownerId && item.ownerId !== user.id && user.role !== 'teacher')
        || (user.role === 'student' && item.ownerId !== user.id
          && !mediaIsAccessibleToStudent(store, mediaId, user.id))) {
        fail(404, 'Arquivo não encontrado.');
      }
      if (!/^[a-f0-9-]{36}\.bin$/i.test(item.filename)) fail(404, 'Arquivo não encontrado.');
      const content = await storage.readMedia(item.filename);
      res.writeHead(200, {
        'Content-Type': item.type,
        'Content-Length': content.length,
        'Content-Disposition': `inline; filename="${item.name.replace(/[^\w .()-]/g, '_')}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      });
      return res.end(method === 'HEAD' ? undefined : content);
    }

    if (method === 'GET' && pathname === '/api/students') {
      requireUser(req, 'teacher');
      const students = store.users.filter(item => item.role === 'student')
        .map(item => ({
          ...safeUser(item),
          online: Boolean(item.lastSeenAt && Date.now() - Date.parse(item.lastSeenAt) < 90_000)
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return json(res, 200, { students });
    }

    if (method === 'POST' && pathname === '/api/students') {
      requireUser(req, 'teacher');
      const body = await readBody(req);
      const name = normalizeName(body.name);
      const username = normalizeUsername(body.username);
      const credentials = await passwordRecord(body.password);
      const student = await transaction(next => {
        if (next.users.some(item => item.usernameKey === username.toLowerCase())) {
          fail(409, 'Este nome de usuário já está em uso.');
        }
        const account = {
          id: id(), role: 'student', name, username,
          usernameKey: username.toLowerCase(), ...credentials,
          createdAt: nowIso(), lastSeenAt: null
        };
        next.users.push(account);
        return safeUser(account);
      });
      return json(res, 201, { student, portalUrl: portalUrl(req) });
    }

    const studentMatch = /^\/api\/students\/([^/]+)$/.exec(pathname);
    if (method === 'PUT' && studentMatch) {
      requireUser(req, 'teacher');
      const studentId = parseId(studentMatch[1], 'Identificador do aluno');
      const body = await readBody(req);
      const name = normalizeName(body.name);
      const username = normalizeUsername(body.username);
      const password = typeof body.password === 'string' && body.password.length
        ? body.password
        : null;
      const credentials = password ? await passwordRecord(password) : null;
      const updated = await transaction(next => {
        const student = next.users.find(item => item.id === studentId && item.role === 'student');
        if (!student) fail(404, 'Aluno não encontrado.');
        if (next.users.some(item => item.id !== studentId
          && item.usernameKey === username.toLowerCase())) {
          fail(409, 'Este nome de usuário já está em uso.');
        }
        student.name = name;
        student.username = username;
        student.usernameKey = username.toLowerCase();
        if (credentials) {
          student.salt = credentials.salt;
          student.passwordHash = credentials.passwordHash;
          next.sessions = next.sessions.filter(item => item.userId !== studentId);
        }
        return safeUser(student);
      });
      return json(res, 200, { student: updated, passwordChanged: Boolean(credentials) });
    }

    if (method === 'DELETE' && studentMatch) {
      requireUser(req, 'teacher');
      const studentId = parseId(studentMatch[1], 'Identificador do aluno');
      const deletedFiles = await transaction(next => {
        const index = next.users.findIndex(item => item.id === studentId && item.role === 'student');
        if (index < 0) fail(404, 'Aluno não encontrado.');
        next.users.splice(index, 1);
        next.sessions = next.sessions.filter(item => item.userId !== studentId);
        next.notifications = next.notifications.filter(item => item.recipientId !== studentId
          && item.studentId !== studentId);
        next.examSessions = next.examSessions.filter(item => item.studentId !== studentId);
        next.learningProgress = next.learningProgress.filter(item => item.studentId !== studentId);
        next.model.attempts = next.model.attempts.filter(item => item.studentId !== studentId);
        next.model.exercises = next.model.exercises.filter(item => item.studentId !== studentId);
        const ownedMedia = next.media.filter(item => item.ownerId === studentId);
        next.media = next.media.filter(item => item.ownerId !== studentId);
        return ownedMedia.map(item => item.filename);
      });
      await Promise.all(deletedFiles.map(filename =>
        storage.deleteMedia(filename).catch(() => {})));
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && pathname === '/api/practice/request') {
      if (user.role !== 'student') fail(403, 'Somente alunos podem solicitar uma lista de prática.');
      const body = await readBody(req);
      const lessonId = parseId(String(body.lessonId || ''), 'Identificador da aula');
      const result = await transaction(next => {
        const lesson = next.model.lessons.find(item => item.id === lessonId && isPublished(item));
        if (!lesson) fail(404, 'Aula publicada não encontrada.');
        if (lessonIsLocked(next, lesson, user.id)) fail(403, 'Esta aula ainda não foi liberada para você.');
        const pool = next.model.exercises
          .filter(item => isPublished(item) && !item.assessment && !item.personalizedFor
            && !exerciseIsLocked(next, item, user.id)
            && (item.lessonIds || []).includes(lessonId))
          .flatMap(item => (Array.isArray(item.questions) ? item.questions : []).map(question => ({
            ...question,
            sourceExerciseId: item.id,
            sourceExerciseTitle: item.title,
            sourceLessonId: lesson.id,
            sourceLessonTitle: lesson.title,
            sourceBlockId: lesson.blockId
          })));
        for (let index = pool.length - 1; index > 0; index -= 1) {
          const swap = crypto.randomInt(index + 1);
          [pool[index], pool[swap]] = [pool[swap], pool[index]];
        }
        const questions = pool.slice(0, 10).map(question => ({ ...question, id: id() }));
        if (!questions.length) fail(400, 'Esta aula ainda não tem questões publicadas relacionadas.');
        const exercise = {
          id: id(),
          title: `Prática · ${lesson.title || 'Aula'}`,
          instructions: `Lista personalizada com questões de ${lesson.title || 'aula'}.`,
          difficulty: 'Geral',
          status: 'published',
          published: true,
          showAnswers: false,
          lessonIds: [],
          questions,
          personalizedFor: user.name,
          studentId: user.id,
          sourceLessonId: lesson.id,
          createdAt: nowIso()
        };
        next.model.exercises.push(exercise);
        return { exercise };
      });
      return json(res, 200, result);
    }

    if (method === 'GET' && pathname === '/api/notifications') {
      const notifications = store.notifications
        .filter(item => item.recipientId === user.id)
        .map(({ recipientId, ...item }) => item);
      return json(res, 200, { notifications });
    }

    const readNotificationMatch = /^\/api\/notifications\/([^/]+)\/read$/.exec(pathname);
    if (method === 'POST' && readNotificationMatch) {
      const notificationId = parseId(readNotificationMatch[1], 'Identificador da notificação');
      const notification = await transaction(next => {
        const item = next.notifications.find(entry =>
          entry.id === notificationId && entry.recipientId === user.id);
        if (!item) fail(404, 'Notificação não encontrada.');
        if (!item.readAt) item.readAt = nowIso();
        const { recipientId, ...visible } = item;
        return visible;
      });
      return json(res, 200, { notification });
    }

    if (method === 'POST' && pathname === '/api/presence') {
      const lastSeenAt = nowIso();
      await transaction(next => {
        const account = next.users.find(item => item.id === user.id);
        if (account) account.lastSeenAt = lastSeenAt;
      });
      return json(res, 200, { lastSeenAt });
    }

    if (method === 'PUT' && pathname === '/api/account/profile') {
      const body = await readBody(req);
      const name = normalizeName(body.name);
      const username = normalizeUsername(body.username);
      const updated = await transaction(next => {
        const account = next.users.find(item => item.id === user.id);
        if (next.users.some(item => item.id !== user.id
          && item.usernameKey === username.toLowerCase())) {
          fail(409, 'Este nome de usuário já está em uso.');
        }
        account.name = name;
        account.username = username;
        account.usernameKey = username.toLowerCase();
        if (account.role === 'teacher') {
          next.model.profile = { ...next.model.profile, displayName: name, username };
        }
        return safeUser(account);
      });
      return json(res, 200, { user: updated });
    }

    if (method === 'POST' && pathname === '/api/attempts') {
      if (user.role !== 'student') fail(403, 'Somente alunos podem enviar respostas.');
      const body = await readBody(req);
      const incoming = body.attempt;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        fail(400, 'A resposta enviada não é válida.');
      }
      const result = await transaction(next => {
        const exercise = findExercise(next, String(incoming.exerciseId || ''));
        if (!exercise || !isPublished(exercise)
          || (exercise.studentId && exercise.studentId !== user.id)) {
          fail(404, 'Exercício publicado não encontrado.');
        }
        if (exerciseIsLocked(next, exercise, user.id)) {
          fail(403, 'Esta atividade ainda não foi liberada para você.');
        }
        if (exercise.assessment) {
          const examIndex = examSessionIndex(next, user.id, exercise.id);
          const examSession = examIndex < 0 ? null : next.examSessions[examIndex];
          if (!examSession?.startedAt || examSession.locked) {
            fail(403, 'A avaliação não está liberada para envio.');
          }
          const deadlineAt = Date.parse(exercise.assessment.deadlineAt || '');
          if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= Date.now()) {
            fail(403, 'O prazo desta avaliação terminou.');
          }
          const startedAt = Date.parse(examSession.startedAt);
          const durationMs = Math.max(1, Number(exercise.assessment.durationMinutes) || 30) * 60_000;
          if (!Number.isFinite(startedAt) || Date.now() - startedAt > durationMs) {
            fail(403, 'O tempo para responder a esta avaliação terminou.');
          }
        }
        if (!Array.isArray(incoming.answers) || incoming.answers.length > 500) {
          fail(400, 'A lista de respostas não é válida.');
        }
        const questions = Array.isArray(exercise.questions) ? exercise.questions : [];
        const questionsById = new Map(questions.filter(item => typeof item.id === 'string')
          .map(item => [item.id, item]));
        const answeredIds = new Set();
        const submitted = cleanJson(incoming);
        const receivedAt = Date.now();
        const submittedStart = Date.parse(submitted.startedAt || '');
        const startedAt = Number.isFinite(submittedStart) && submittedStart <= receivedAt
          && receivedAt - submittedStart <= 7 * 24 * 60 * 60 * 1000
          ? new Date(submittedStart).toISOString()
          : nowIso();
        const attempt = {
          id: id(),
          exerciseId: exercise.id,
          studentId: user.id,
          profileName: user.name,
          startedAt,
          createdAt: nowIso(),
          answers: submitted.answers
        };
        let score = 0;
        let maxScore = 0;
        attempt.answers = attempt.answers.map(answer => {
          if (!answer || typeof answer !== 'object' || typeof answer.questionId !== 'string') {
            fail(400, 'Uma das respostas não é válida.');
          }
          const question = questionsById.get(answer.questionId);
          if (!question || answeredIds.has(answer.questionId)) {
            fail(400, 'Uma resposta referencia uma questão inválida ou repetida.');
          }
          answeredIds.add(answer.questionId);
          const points = Math.max(0, Math.min(10000, Number(question.points) || 0));
          maxScore += points;
          const expected = [question.answer, ...(Array.isArray(question.acceptedAnswers)
            ? question.acceptedAnswers : [])]
            .filter(value => value !== undefined && String(value).trim() !== '');
          const manual = question.manual === true || ['chord', 'rhythm'].includes(question.type)
            || expected.length === 0;
          const value = Array.isArray(answer.value)
            ? answer.value.slice(0, 100).map(item => String(item).slice(0, 2000))
            : answer.value && typeof answer.value === 'object'
              ? cleanJson(answer.value)
              : String(answer.value ?? '').slice(0, 10000);
          if (value && typeof value === 'object'
            && JSON.stringify(value).length > 10000) {
            fail(400, 'Uma resposta excede o tamanho permitido.');
          }
          let audioAttachment;
          if (question.requireAudioResponse && !answer.audioAttachment) {
            fail(400, 'Esta questão exige uma resposta em áudio.');
          }
          if (answer.audioAttachment !== undefined) {
            if (!question.allowAudioResponse || !answer.audioAttachment
              || typeof answer.audioAttachment.id !== 'string') {
              fail(400, 'O anexo de áudio não é válido para esta questão.');
            }
            const media = next.media.find(item => item.id === answer.audioAttachment.id
              && item.ownerId === user.id && item.type.startsWith('audio/'));
            if (!media) fail(400, 'O áudio não foi enviado nesta conta ou não é válido.');
            audioAttachment = {
              id: media.id,
              name: media.name,
              type: media.type,
              size: media.size
            };
          }
          const correct = !manual && !audioAttachment && expected.some(item =>
            normalizeAnswer(item) === normalizeAnswer(value));
          const requiresManualReview = manual || Boolean(audioAttachment);
          if (correct) score += points;
          return {
            questionId: question.id,
            value,
            prompt: String(question.prompt || '').slice(0, 10000),
            points,
            correct,
            manual: requiresManualReview,
            manualScore: 0,
            ...(audioAttachment ? { audioAttachment } : {})
          };
        });
        const attachments = Array.isArray(submitted.attachments) ? submitted.attachments : [];
        if (attachments.length > 20) fail(400, 'Uma resposta pode incluir até 20 arquivos.');
        attempt.attachments = attachments.map(attachment => {
          const media = next.media.find(item => item.id === attachment?.id
            && item.ownerId === user.id);
          if (!media) fail(400, 'Um dos arquivos anexados não foi enviado nesta conta.');
          return { id: media.id, name: media.name, type: media.type, size: media.size };
        });
        attempt.score = score;
        attempt.maxScore = maxScore;
        attempt.durationSeconds = Math.max(0, Math.min(7 * 24 * 60 * 60,
          Number(incoming.durationSeconds) || 0));
        next.model.attempts.push(attempt);
        notifyTeacher(next, {
          type: 'response-submitted',
          title: 'Nova resposta recebida',
          message: `${user.name} enviou uma resposta para ${exercise.title || 'um exercício'}.`,
          exerciseId: exercise.id,
          studentId: user.id,
          studentName: user.name,
          attemptId: attempt.id
        });
        return { attempt };
      });
      return json(res, 201, result);
    }

    const reviewMatch = /^\/api\/attempts\/([^/]+)\/review$/.exec(pathname);
    if (method === 'POST' && reviewMatch) {
      requireUser(req, 'teacher');
      const attemptId = parseId(reviewMatch[1], 'Identificador da resposta');
      const body = await readBody(req);
      const rating = Number(body.teacherRating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
        fail(400, 'A avaliação deve estar entre 0 e 5 estrelas.');
      }
      const note = String(body.teacherNote || '').trim();
      if (note.length > 3000) fail(400, 'O comentário deve ter até 3.000 caracteres.');
      const attempt = await transaction(next => {
        const item = next.model.attempts.find(entry => entry.id === attemptId);
        if (!item) fail(404, 'Resposta não encontrada.');
        item.teacherRating = Math.round(rating);
        item.teacherNote = note;
        item.reviewedAt = nowIso();
        const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 20) : [];
        item.teacherAttachments = attachments.map(attachment => {
          const media = next.media.find(entry => entry.id === attachment?.id);
          if (!media) fail(400, 'Um dos arquivos do professor não foi encontrado.');
          return { id: media.id, name: media.name, type: media.type, size: media.size };
        });
        if (item.studentId) {
          addNotification(next, item.studentId, {
            type: 'response-reviewed',
            title: 'Sua resposta foi revisada',
            message: `O professor revisou sua resposta para ${findExercise(next, item.exerciseId)?.title || 'um exercício'}.`,
            exerciseId: item.exerciseId,
            attemptId: item.id
          });
        }
        return item;
      });
      return json(res, 200, { attempt });
    }

    const gradeMatch = /^\/api\/attempts\/([^/]+)\/grade$/.exec(pathname);
    if (method === 'POST' && gradeMatch) {
      requireUser(req, 'teacher');
      const attemptId = parseId(gradeMatch[1], 'Identificador da resposta');
      const body = await readBody(req);
      const grades = body.grades && typeof body.grades === 'object' ? body.grades : {};
      const comments = body.comments && typeof body.comments === 'object' ? body.comments : {};
      const attempt = await transaction(next => {
        const item = next.model.attempts.find(entry => entry.id === attemptId);
        if (!item) fail(404, 'Resposta não encontrada.');
        let total = 0;
        let gradeCount = 0;
        for (const answer of item.answers || []) {
          if (!answer.manual) {
            total += answer.correct ? Number(answer.points) || 0 : 0;
            if (Object.prototype.hasOwnProperty.call(comments, answer.questionId)) {
              answer.teacherComment = String(comments[answer.questionId] || '').trim();
            }
            continue;
          }
          const points = Math.min(Number(answer.points) || 0,
            Math.max(0, Number(grades[answer.questionId]) || 0));
          answer.manualScore = points;
          answer.correct = points >= (Number(answer.points) || 0);
          if (Object.prototype.hasOwnProperty.call(comments, answer.questionId)) {
            answer.teacherComment = String(comments[answer.questionId] || '').trim();
          }
          total += points;
          gradeCount++;
        }
        item.score = total;
        item.gradedAt = nowIso();
        if (item.studentId) {
          addNotification(next, item.studentId, {
            type: 'response-graded',
            title: 'Correção disponível',
            message: `O professor corrigiu sua resposta e deixou comentários para ${findExercise(next, item.exerciseId)?.title || 'um exercício'}.`,
            exerciseId: item.exerciseId,
            attemptId: item.id
          });
        }
        return item;
      });
      return json(res, 200, { attempt });
    }

    const examAction = /^\/api\/exams\/([^/]+)\/(open|start|heartbeat|request-reopen)$/.exec(pathname);
    if (examAction && method === 'POST') {
      if (user.role !== 'student') fail(403, 'Somente alunos podem acessar avaliações.');
      const examId = parseId(examAction[1], 'Identificador da avaliação');
      const action = examAction[2];
      const body = await readBody(req);
      const outcome = await transaction(next => {
        const exercise = findExercise(next, examId);
        if (!exercise || !exercise.assessment || !isPublished(exercise)) {
          fail(404, 'Avaliação não encontrada.');
        }
        if (exerciseIsLocked(next, exercise, user.id)) {
          if (action !== 'open') fail(403, 'Esta avaliação ainda não foi liberada para você.');
          return { notReleased: true, releaseAt: '' };
        }
        const releaseAt = Date.parse(exercise.assessment.releaseAt || '');
        const deadlineAt = Date.parse(exercise.assessment.deadlineAt || '');
        if (Number.isFinite(releaseAt) && releaseAt > Date.now()) {
          if (action !== 'open') fail(403, 'Esta avaliação ainda não foi liberada.');
          return { notReleased: true, releaseAt: exercise.assessment.releaseAt };
        }
        if (Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= Date.now()) {
          fail(403, 'O prazo desta avaliação terminou.');
        }
        let index = examSessionIndex(next, user.id, examId);
        if (index < 0) {
          next.examSessions.push({
            studentId: user.id,
            examId,
            startedAt: null,
            lastSeenAt: nowIso(),
            locked: false,
            reopenRequestedAt: null
          });
          index = next.examSessions.length - 1;
        }
        const session = next.examSessions[index];
        const lastSeen = Date.parse(session.lastSeenAt || '');
        const lockOnExit = exercise.assessment.lockOnExit !== false;
        if (action === 'open' && lockOnExit && session.startedAt && !session.locked
          && Number.isFinite(lastSeen) && Date.now() - lastSeen > examIdleMs) {
          session.locked = true;
        }
        if (action === 'open') {
          if (!session.locked) session.lastSeenAt = nowIso();
          return { exercise, session: { startedAt: session.startedAt, lastSeenAt: session.lastSeenAt }, locked: session.locked };
        }
        if (action === 'start') {
          if (session.locked) fail(423, 'A avaliação está trancada.');
          if (!session.startedAt) session.startedAt = nowIso();
          session.lastSeenAt = nowIso();
          return { session: { startedAt: session.startedAt, lastSeenAt: session.lastSeenAt } };
        }
        if (action === 'heartbeat') {
          if (session.locked) return { locked: true };
          if (!session.startedAt) fail(409, 'A avaliação ainda não foi iniciada.');
          if (lockOnExit && Number.isFinite(lastSeen) && Date.now() - lastSeen > examIdleMs) {
            session.locked = true;
            return { locked: true };
          }
          session.lastSeenAt = nowIso();
          return { session: { startedAt: session.startedAt, lastSeenAt: session.lastSeenAt } };
        }
        const reason = String(body.reason || '').trim();
        if (reason.length < 5 || reason.length > 500) {
          fail(400, 'Explique o motivo em pelo menos 5 caracteres (até 500).');
        }
        if (!session.locked) fail(409, 'Esta avaliação não está trancada.');
        session.reopenRequestedAt = nowIso();
        notifyTeacher(next, {
          type: 'exam-reopen-request',
          title: 'Pedido para reabrir avaliação',
          message: `${user.name} pediu a reabertura de ${exercise.title || 'uma avaliação'}.`,
          examId,
          studentId: user.id,
          studentName: user.name,
          examTitle: exercise.title || 'Avaliação',
          reason
        });
        return { ok: true };
      });
      if (outcome.locked) fail(423, 'A avaliação foi trancada por inatividade.');
      return json(res, 200, outcome);
    }

    if (method === 'POST' && pathname === '/api/exams/unlock') {
      requireUser(req, 'teacher');
      const body = await readBody(req);
      const examId = parseId(String(body.examId || ''), 'Identificador da avaliação');
      const studentId = parseId(String(body.studentId || ''), 'Identificador do aluno');
      await transaction(next => {
        const exercise = findExercise(next, examId);
        const student = next.users.find(item => item.id === studentId && item.role === 'student');
        const index = examSessionIndex(next, studentId, examId);
        if (!exercise?.assessment || !student || index < 0 || !next.examSessions[index].locked) {
          fail(404, 'Solicitação de reabertura não encontrada.');
        }
        const examSession = next.examSessions[index];
        examSession.locked = false;
        examSession.startedAt = null;
        examSession.lastSeenAt = nowIso();
        examSession.reopenRequestedAt = null;
        addNotification(next, student.id, {
          type: 'exam-reopened',
          title: 'Avaliação liberada novamente',
          message: `O professor liberou novamente ${exercise.title || 'a avaliação'}.`,
          examId,
          exerciseId: examId
        });
        const notice = next.notifications.find(item =>
          item.recipientId === teacherId(next) && item.examId === examId
          && item.studentId === studentId && item.type === 'exam-reopen-request');
        if (notice) notice.readAt = nowIso();
      });
      return json(res, 200, { ok: true });
    }

    fail(404, 'Endpoint não encontrado.');
  }

  function teacherId(current) {
    return current.users.find(item => item.role === 'teacher')?.id;
  }

  async function serveStatic(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Método não permitido.');
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      fail(400, 'Caminho inválido.');
    }
    if (decoded.includes('\0') || decoded.includes('\\')) fail(400, 'Caminho inválido.');
    const requested = decoded === '/' ? '/index.html' : decoded;
    const parts = requested.split('/').filter(Boolean);
    const firstPart = (parts[0] || '').toLowerCase();
    if (parts.some(part => part.startsWith('.'))
      || ['server.js', 'server.test.js', 'backend.md', 'node_modules', 'notarium-data'].includes(firstPart)) {
      fail(404, 'Arquivo não encontrado.');
    }
    const filename = requested === '/chart.umd.js'
      ? path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
      : path.resolve(ROOT, `.${requested}`);
    const relative = path.relative(ROOT, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail(404, 'Arquivo não encontrado.');
    let stats;
    try {
      stats = await fs.stat(filename);
      if (!stats.isFile()) fail(404, 'Arquivo não encontrado.');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      fail(404, 'Arquivo não encontrado.');
    }
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json'
    };
    res.writeHead(200, {
      'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': path.basename(filename) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' blob: http: https:; frame-src 'self' https://www.youtube-nocookie.com https://musescore.com https://*.musescore.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(await fs.readFile(filename));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' });
          return res.end();
        }
        return await handleApi(req, res, url);
      }
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error(error);
      return json(res, status, { error: status === 500 ? 'Erro interno do servidor.' : error.message });
    }
  });

  return { server, initialize, dataDir };
}

if (require.main === module) {
  const app = createApplication();
  app.initialize().then(() => {
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '0.0.0.0';
    app.server.listen(port, host, () => {
      console.log(`Notarium running at http://${host}:${port}`);
      console.log(`Data directory: ${app.dataDir}`);
    });
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApplication };
