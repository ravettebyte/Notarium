import crypto from 'node:crypto';
import { validateModel } from '../storage.js';
import { canAccess, stripAnswers, validateProfile } from './policy.mjs';
export function domain(store, actor, persist) {
const saveStore = async () => { await persist(store); };
const readJson = async request => request.body;
const sendJson = (response, status, value) => { response.status = status; response.value = value; };
function emptyModel() { return {schemaVersion:1, profile:{displayName:'Músico', username:'', role:'teacher', defaultOctave:4},blocks:[],exerciseBlocks:[],lessons:[],exercises:[],attempts:[],trails:[],trailSettings:[]}; }
function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9._-]{3,30}$/.test(value);
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, isAdmin: !!user.isAdmin, createdAt: user.createdAt };
}
function currentUser() { return actor; }
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
  if (!store.model) return emptyModel();
  if (user.role === 'teacher') return { ...store.model, profile: { ...store.model.profile, ...user.profile, displayName: user.name, username: user.username } };

  const model = JSON.parse(JSON.stringify(store.model));
  const lessons = model.lessons.filter(lesson => canAccess(lesson, user));
  const exercises = model.exercises.filter(exercise =>
    canAccess(exercise, user) && !['draft', 'archived'].includes(exercise.status)
      && (!exercise.personalizedFor || exercise.personalizedFor === user.id));
  const lessonIds = new Set(lessons.map(lesson => lesson.id));
  const exerciseIds = new Set(exercises.map(exercise => exercise.id));
  model.blocks = model.blocks.filter(block => lessons.some(lesson => lesson.blockId === block.id));
  model.exerciseBlocks = (model.exerciseBlocks || []).filter(block => exercises.some(exercise => exercise.exerciseBlockId === block.id));
  model.lessons = lessons.map(lesson => ({
    ...lesson,
    exerciseIds: (lesson.exerciseIds || []).filter(id => exerciseIds.has(id))
  }));
  model.exercises = exercises.map(exercise => ({
    ...exercise,
    questions: exercise.questions.map(stripAnswers),
    ...(exercise.assessment ? { questionCount: exercise.questions.length, questions: [] } : {}),
    lessonIds: (exercise.lessonIds || []).filter(id => lessonIds.has(id))
  }));
  model.attempts = model.attempts.filter(attempt =>
    attempt.studentId === user.id && exerciseIds.has(attempt.exerciseId) && !attempt.isDemo);
  model.trails = (model.trails || []).filter(step => step.studentId === user.id);
  model.trailSettings = (model.trailSettings || []).filter(settings => settings.studentId === user.id);
  model.profile = {
    defaultOctave: model.profile.defaultOctave,
    theme: 'light',
    displayName: user.name,
    username: user.username,
    role: 'student',
    ...user.profile
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
  return '/?login=1';
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
        if (!exam.assessment || !canAccess(exam,user) || ['draft', 'closed', 'archived'].includes(exam.status)
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
    const scores = body.scores || {};
    for (const answer of attempt.answers) {
      if (answer.manual && scores[answer.questionId] !== undefined) {
        const value = Number(scores[answer.questionId]);
        if (!Number.isFinite(value) || value < 0 || value > answer.points) throw Object.assign(new Error('Nota inválida.'), { status: 400 });
        answer.manualScore = value; answer.correct = value === answer.points;
      }
    }
    if (Object.keys(scores).length) attempt.gradedAt = new Date().toISOString();
    attempt.score = attempt.answers.reduce((sum, a) => sum + (a.manual ? a.manualScore || 0 : a.correct ? a.points : 0), 0);
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
    user.profile = validateProfile(body);
    user.name = name;
    user.username = username;
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
    const model = validateModel(body.model);
    if (!model || !Array.isArray(model.blocks) || !Array.isArray(model.lessons)
        || !Array.isArray(model.exercises) || !Array.isArray(model.attempts)
        || (model.exerciseBlocks !== undefined && !Array.isArray(model.exerciseBlocks))) {
      return sendJson(response, 400, { error: 'O conteúdo enviado está incompleto ou inválido.' });
    }
    model.exerciseBlocks ||= [];
    for (const item of [...model.lessons,...model.exercises]) {
      if (item.studentIds && (!Array.isArray(item.studentIds) || item.studentIds.some(id => !store.users.some(user => user.id === id && user.role === 'student')))) throw Object.assign(new Error('Destinatário inválido.'), {status:400});
    }
    for (const exercise of model.exercises) {
      if (exercise.questions.length > 200 || exercise.questions.some(question => !Number.isFinite(Number(question.points)) || Number(question.points) < 0 || Number(question.points) > 10000)) throw Object.assign(new Error('Pontuação inválida.'), {status:400});
    }
    const previous = store.model || emptyModel();
    const personalExercises = (previous.exercises || []).filter(item => item.personalizedFor);
    const personalExerciseIds = new Set(personalExercises.map(item => item.id));

    for (const exercise of personalExercises) {
      if (!model.exercises.some(item => item.id === exercise.id)) model.exercises.push(exercise);
    }
    const storedStudentAttempts = (previous.attempts || []).filter(item => item.studentId
      || personalExerciseIds.has(item.exerciseId));
    model.attempts = storedStudentAttempts.filter(item => model.exercises.some(exercise => exercise.id === item.exerciseId));
    const previousPublished = new Set([
      ...(previous.lessons || []).filter(item => item.published).map(item => `lesson:${item.id}`),
      ...(previous.exercises || []).filter(item => item.published && !['draft', 'archived'].includes(item.status))
        .map(item => `exercise:${item.id}`)
    ]);
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
      online: Date.now() - Date.parse(student.lastSeenAt || '') < 120_000
    }));
    return sendJson(response, 200, { students });
  }

  const examOpenRoute = /^\/api\/exams\/([^/]+)\/open$/.exec(route);
  if (examOpenRoute && method === 'POST' && user.role === 'student') {
    const exam = store.model?.exercises.find(item => item.id === examOpenRoute[1] && item.assessment);
    if (!exam || !canAccess(exam, user) || ['draft', 'closed', 'archived'].includes(exam.status)) {
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
    if (!exam || !canAccess(exam, user) || ['draft', 'closed', 'archived'].includes(exam.status)) {
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
    if (store.model) store.model.attempts = store.model.attempts.filter(attempt => attempt.studentId !== removed.id);

    await saveStore();
    return sendJson(response, 200, { ok: true });
  }

  if (route === '/api/practice/request' && method === 'POST' && user.role === 'student') {
    const body = await readJson(request);
    const lesson = store.model?.lessons.find(item => item.id === body.lessonId && canAccess(item, user));
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
    if (!exercise || !canAccess(exercise, user) || ['draft', 'archived', 'closed'].includes(exercise.status)
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
    if (new Set(source.answers.map(a => a.questionId)).size !== source.answers.length) throw Object.assign(new Error('Respostas duplicadas.'), { status: 400 });
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
    if (source.answers.length !== exercise.questions.length || source.answers.some(answer => !allowedQuestions.has(answer.questionId))) throw Object.assign(new Error('Responda todas as questões da atividade.'), {status:400});
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
        feedback: question.feedback || (manual ? 'Aguardando revisão do professor.' : correct ? 'Resposta correta conforme o critério musical da atividade.' : 'Revise o conteúdo da aula e compare sua resposta com o critério da questão.'),
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
    if (attachments.some(item => !store.media.some(media => media.id === item.id && media.ownerId === user.id))) throw Object.assign(new Error('Anexo não autorizado.'), { status: 403 });
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


return { handleApi, modelFor, referencedMediaIds, gradeAnswer, emptyModel, publicUser };
}
