const crypto = require('node:crypto');

// Lógica compartilhada entre o servidor local (notarium-server.js) e a função do Netlify.

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


function modelFor(storedModel, user) {
  if (!storedModel) return emptyModel();
  if (user.role === 'teacher') return storedModel;

  const model = JSON.parse(JSON.stringify(storedModel));
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
    (attempt.studentId === user.id || (!attempt.studentId && attempt.profileName === user.name)) && !attempt.isDemo);
  model.trails = (model.trails || []).filter(step => step.studentId === user.id);
  model.trailSettings = (model.trailSettings || []).filter(settings => settings.studentId === user.id);
  model.profile = {
    ...model.profile,
    displayName: user.name,
    username: user.username,
    role: 'student',
    avatarDataUrl: ''
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

module.exports = {
  emptyModel, normalizeUsername, validUsername, hashPassword, checkPassword, publicUser,
  modelFor, referencedMediaIds, normalizeRhythmAnswer, gradeAnswer
};
