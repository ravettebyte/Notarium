const STORAGE_KEY = 'notarium-local-v1';
const DEFAULT_DATA_URL = new URL('catalog.json', import.meta.url);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emptyModel() {
  return {
    schemaVersion: 1,
    profile: {
      displayName: 'Músico',
      username: '',
      bio: '',
      avatarDataUrl: '',
      defaultOctave: 4,
      role: 'teacher',
      theme: 'light'
    },
    blocks: [],
    exerciseBlocks: [],
    lessons: [],
    exercises: [],
    attempts: [],
    trails: [],
    trailSettings: []
  };
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() || `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function validateModel(value) {
  if (!isRecord(value) || !Array.isArray(value.blocks) || !Array.isArray(value.lessons)
      || !Array.isArray(value.exercises) || !Array.isArray(value.attempts)
      || (value.exerciseBlocks !== undefined && !Array.isArray(value.exerciseBlocks))
      || (value.trails !== undefined && !Array.isArray(value.trails))
      || (value.trailSettings !== undefined && !Array.isArray(value.trailSettings))) {
    throw new Error('O arquivo deve conter blocos, aulas, exercícios, tentativas e trilhas em formato JSON.');
  }
  const collections = ['blocks', 'lessons', 'exercises', 'attempts'];
  const exerciseBlocks = value.exerciseBlocks || [];
  const exerciseBlockIds = new Set();
  for (const block of exerciseBlocks) {
    if (!isRecord(block) || typeof block.id !== 'string' || !block.id.trim()) {
      throw new Error('Há um bloco de exercícios sem identificador válido.');
    }
    if (exerciseBlockIds.has(block.id)) throw new Error(`O identificador "${block.id}" está duplicado nos blocos de exercícios.`);
    exerciseBlockIds.add(block.id);
  }
  const trails = value.trails || [];
  for (const collectionName of collections) {
    const collection = value[collectionName];
    const ids = new Set();
    for (const item of collection) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
        throw new Error(`Há um registro sem identificador válido em "${collectionName}".`);
      }
      if (ids.has(item.id)) throw new Error(`O identificador "${item.id}" está duplicado em "${collectionName}".`);
      ids.add(item.id);
    }
  }
  const trailIds = new Set();
  const trailSettings = value.trailSettings || [];
  const trailSettingIds = new Set();
  for (const step of trails) {
    if (!isRecord(step) || typeof step.id !== 'string' || !step.id.trim()) {
      throw new Error('Há uma etapa de trilha sem identificador válido.');
    }
    if (trailIds.has(step.id)) throw new Error(`O identificador "${step.id}" está duplicado nas trilhas.`);
    trailIds.add(step.id);
  }
  for (const settings of trailSettings) {
    if (!isRecord(settings) || typeof settings.studentId !== 'string' || !settings.studentId.trim()) {
      throw new Error('Há uma configuração de partitura sem identificação válida de aluno.');
    }
    if (trailSettingIds.has(settings.studentId)) {
      throw new Error(`A configuração da trilha de "${settings.studentId}" está duplicada.`);
    }
    trailSettingIds.add(settings.studentId);
  }
  for (const lesson of value.lessons) {
    if (!Array.isArray(lesson.content) || !Array.isArray(lesson.exerciseIds)) {
      throw new Error(`A aula "${lesson.title || lesson.id}" não tem conteúdo e relações válidas.`);
    }
    if (lesson.content.some(block => !isRecord(block) || typeof block.type !== 'string')) {
      throw new Error(`A aula "${lesson.title || lesson.id}" contém um bloco de conteúdo inválido.`);
    }
  }
  for (const exercise of value.exercises) {
    if (!Array.isArray(exercise.lessonIds) || !Array.isArray(exercise.questions)) {
      throw new Error(`O exercício "${exercise.title || exercise.id}" não tem questões e relações válidas.`);
    }
    if (exercise.exerciseBlockId && !exerciseBlockIds.has(exercise.exerciseBlockId)) {
      throw new Error(`O exercício "${exercise.title || exercise.id}" aponta para um bloco de exercícios inexistente.`);
    }
    const questionIds = new Set();
    for (const question of exercise.questions) {
      if (!isRecord(question) || typeof question.id !== 'string' || !question.id.trim()) {
        throw new Error(`O exercício "${exercise.title || exercise.id}" contém uma questão sem identificador válido.`);
      }
      if (questionIds.has(question.id)) throw new Error(`A questão "${question.id}" está duplicada no exercício "${exercise.title || exercise.id}".`);
      questionIds.add(question.id);
    }
  }
  if (!isRecord(value.profile)) throw new Error('O perfil local está inválido.');
  if (value.profile.avatarDataUrl !== undefined && value.profile.avatarDataUrl !== ''
      && (typeof value.profile.avatarDataUrl !== 'string'
        || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(value.profile.avatarDataUrl)
        || value.profile.avatarDataUrl.length > 300_000)) {
    throw new Error('A imagem do perfil no arquivo de dados não é válida ou excede o limite local.');
  }
  const profile = { ...value.profile };
  delete profile.visibility;
  delete profile.following;
  delete profile.accessRequests;
  const blockIds = new Set(value.blocks.map(block => block.id));
  const lessonIds = new Set(value.lessons.map(lesson => lesson.id));
  const exerciseIds = new Set(value.exercises.map(exercise => exercise.id));
  for (const step of trails) {
    if (!isRecord(step) || typeof step.id !== 'string' || !step.id.trim()
        || typeof step.studentId !== 'string' || !step.studentId.trim()
        || typeof step.title !== 'string' || !step.title.trim()
        || typeof step.blockId !== 'string' || !blockIds.has(step.blockId)) {
      throw new Error('Cada etapa da trilha precisa de aluno, nome e bloco de aula válidos.');
    }
    if (step.lessonId && (!lessonIds.has(step.lessonId)
        || getLessonById(value.lessons, step.lessonId)?.blockId !== step.blockId)) {
      throw new Error(`A etapa "${step.title}" aponta para uma aula que não pertence ao bloco selecionado.`);
    }
  }
  for (const lesson of value.lessons) {
    if (lesson.blockId && !blockIds.has(lesson.blockId)) {
      throw new Error(`A aula "${lesson.title || lesson.id}" aponta para um bloco inexistente.`);
    }
    if (lesson.exerciseIds.some(id => !exerciseIds.has(id))) {
      throw new Error(`A aula "${lesson.title || lesson.id}" aponta para um exercício inexistente.`);
    }
    if (new Set(lesson.exerciseIds).size !== lesson.exerciseIds.length) {
      throw new Error(`A aula "${lesson.title || lesson.id}" relaciona o mesmo exercício mais de uma vez.`);
    }
  }
  for (const exercise of value.exercises) {
    if (exercise.lessonIds.some(id => !lessonIds.has(id))) {
      throw new Error(`O exercício "${exercise.title || exercise.id}" aponta para uma aula inexistente.`);
    }
    if (new Set(exercise.lessonIds).size !== exercise.lessonIds.length) {
      throw new Error(`O exercício "${exercise.title || exercise.id}" relaciona a mesma aula mais de uma vez.`);
    }
    if (exercise.lessonIds.some(id => !getLessonById(value.lessons, id).exerciseIds.includes(exercise.id))) {
      throw new Error(`As relações do exercício "${exercise.title || exercise.id}" não correspondem às aulas relacionadas.`);
    }
  }
  for (const lesson of value.lessons) {
    if (lesson.exerciseIds.some(id => !getExerciseById(value.exercises, id).lessonIds.includes(lesson.id))) {
      throw new Error(`As relações da aula "${lesson.title || lesson.id}" não correspondem aos exercícios relacionados.`);
    }
  }
  for (const attempt of value.attempts) {
    if (!exerciseIds.has(attempt.exerciseId) || !Array.isArray(attempt.answers)) {
      throw new Error(`A tentativa "${attempt.id}" não está ligada a um exercício válido.`);
    }
  }
  return {
    ...emptyModel(),
    ...value,
    exerciseBlocks: exerciseBlocks.map(block => ({
      id: block.id,
      title: String(block.title || '').trim().slice(0, 80),
      description: String(block.description || '').trim().slice(0, 400),
      color: ['blue', 'violet', 'teal'].includes(block.color) ? block.color : 'blue',
      decoration: ['notes', 'stars', 'petals', 'moon'].includes(block.decoration) ? block.decoration : 'notes',
      order: Number.isFinite(Number(block.order)) ? Number(block.order) : 1,
      createdAt: typeof block.createdAt === 'string' ? block.createdAt : new Date(0).toISOString()
    })),
    schemaVersion: 1,
    profile: {
      ...emptyModel().profile,
      ...profile,
      displayName: String(profile.displayName || 'Músico').slice(0, 60),
      username: String(profile.username || '').replace(/^@/, '').slice(0, 30),
      bio: String(profile.bio || '').slice(0, 500),
      avatarDataUrl: typeof profile.avatarDataUrl === 'string'
        && /^data:image\/(?:png|jpeg|webp);base64,/i.test(profile.avatarDataUrl)
        && profile.avatarDataUrl.length <= 300_000
        ? profile.avatarDataUrl
        : '',
      defaultOctave: Number.isInteger(Number(profile.defaultOctave))
        && Number(profile.defaultOctave) >= -1
        && Number(profile.defaultOctave) <= 8
        ? Number(profile.defaultOctave)
        : 4,
      role: profile.role === 'student' ? 'student' : 'teacher',
      theme: profile.theme === 'dark' ? 'dark' : 'light'
    },
    trails: trails.map(step => ({
      id: step.id,
      studentId: step.studentId,
      title: String(step.title).trim().slice(0, 80),
      description: String(step.description || '').slice(0, 300),
      blockId: step.blockId,
      lessonId: typeof step.lessonId === 'string' ? step.lessonId : '',
      rhythm: ['whole', 'half', 'quarter', 'eighth', 'sixteenth'].includes(step.rhythm) ? step.rhythm : 'quarter',
      scoreEvent: ['auto', 'note', 'rest'].includes(step.scoreEvent) ? step.scoreEvent : 'auto',
      status: step.completed === true || step.status === 'completed'
        ? 'completed'
        : step.status === 'in_progress' ? 'in_progress' : 'pending',
      order: Number.isFinite(Number(step.order)) ? Number(step.order) : 1,
      completed: step.completed === true || step.status === 'completed',
      completedAt: typeof step.completedAt === 'string' ? step.completedAt : '',
      createdAt: typeof step.createdAt === 'string' ? step.createdAt : new Date(0).toISOString()
    })),
    trailSettings: trailSettings.map(settings => ({
      studentId: settings.studentId,
      title: String(settings.title || '').trim().slice(0, 80),
      keySignature: [
        'C-major', 'G-major', 'D-major', 'A-major', 'E-major', 'B-major', 'Fsharp-major', 'Csharp-major',
        'F-major', 'Bb-major', 'Eb-major', 'Ab-major', 'Db-major', 'Gb-major', 'Cb-major',
        'A-minor', 'E-minor', 'B-minor', 'Fsharp-minor', 'Csharp-minor', 'Gsharp-minor', 'Dsharp-minor', 'Asharp-minor',
        'D-minor', 'G-minor', 'C-minor', 'F-minor', 'Bb-minor', 'Eb-minor', 'Ab-minor'
      ].includes(settings.keySignature) ? settings.keySignature : 'C-major',
      timeSignature: ['2/4', '3/4', '4/4', '5/4', '6/8', '9/8', '12/8'].includes(settings.timeSignature)
        ? settings.timeSignature
        : '4/4',
      clef: ['treble', 'alto', 'bass'].includes(settings.clef) ? settings.clef : 'treble'
    }))
  };
}

function getLessonById(lessons, id) {
  return lessons.find(lesson => lesson.id === id);
}

function getExerciseById(exercises, id) {
  return exercises.find(exercise => exercise.id === id);
}

export async function loadModel() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    let parsed;
    try { parsed = JSON.parse(saved); }
    catch { throw new Error('Os dados salvos neste navegador estão corrompidos. Importe uma cópia JSON válida para continuar.'); }
    return validateModel(parsed);
  }
  const response = await fetch(DEFAULT_DATA_URL);
  if (!response.ok) throw new Error(`Não foi possível carregar o arquivo inicial de dados (${response.status}). Abra o projeto pelo Live Server.`);
  let initial;
  try { initial = await response.json(); }
  catch { throw new Error('O arquivo catalog.json não contém JSON válido.'); }
  const model = validateModel(initial);
  saveModel(model);
  return model;
}

export function saveModel(model) {
  const validated = validateModel(model);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); }
  catch (error) {
    if (error?.name === 'QuotaExceededError') throw new Error('O armazenamento do navegador está cheio. Exporte uma cópia e remova arquivos de mídia grandes.');
    throw error;
  }
  return validated;
}

export function importModel(jsonText) {
  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch { throw new Error('O arquivo não é um JSON válido.'); }
  return validateModel(parsed);
}

export function exportModel(model) {
  return JSON.stringify(validateModel(model), null, 2);
}
