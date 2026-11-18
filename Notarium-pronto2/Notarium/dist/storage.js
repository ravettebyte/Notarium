import { catalog } from './catalog.js';

const STORAGE_KEY = 'notarium-model-v1';
const COLLECTIONS = ['blocks', 'playlists', 'exerciseBlocks', 'lessons', 'exercises', 'attempts', 'trails', 'trailSettings'];

function createDefaultModel() {
  return {
    ...structuredClone(catalog),
    version: catalog.schemaVersion,
    playlists: [],
    profile: {
      displayName: 'Músico',
      username: '',
      role: 'teacher',
      theme: 'light',
      bio: '',
      avatarDataUrl: '',
      defaultOctave: 4,
      ...catalog.profile
    },
    exerciseBlocks: [],
    trails: [],
    trailSettings: []
  };
}

export function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `notarium-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function validateModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Os dados do Notarium precisam ser um objeto válido.');
  }

  const result = structuredClone(value);
  if (result.profile !== undefined && (!result.profile || typeof result.profile !== 'object' || Array.isArray(result.profile))) {
    throw new TypeError('O perfil salvo no Notarium está inválido.');
  }
  result.profile = { ...createDefaultModel().profile, ...result.profile };
  result.profile.role = result.profile.role === 'student' ? 'student' : 'teacher';
  result.profile.theme = result.profile.theme === 'dark' ? 'dark' : 'light';
  if (!Number.isInteger(Number(result.profile.defaultOctave))) result.profile.defaultOctave = 4;
  else result.profile.defaultOctave = Number(result.profile.defaultOctave);

  if (result.trailSettings && typeof result.trailSettings === 'object'
    && !Array.isArray(result.trailSettings) && Object.keys(result.trailSettings).length === 0) {
    result.trailSettings = [];
  }
  for (const key of COLLECTIONS) {
    if (result[key] === undefined) result[key] = [];
    if (!Array.isArray(result[key])) throw new TypeError(`A coleção "${key}" do Notarium está inválida.`);
  }
  result.version = 1;
  return result;
}

export function loadModel() {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) return createDefaultModel();
  try {
    return validateModel(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Os dados locais do Notarium estão corrompidos. Importe um backup válido para continuar.');
    }
    throw error;
  }
}

export function saveModel(value) {
  const model = validateModel(value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('O armazenamento do navegador está cheio. Exporte um backup e remova arquivos de mídia para liberar espaço.');
    }
    throw new Error(`Não foi possível salvar os dados neste navegador: ${error.message}`);
  }
  return model;
}

export function exportModel(value) {
  return JSON.stringify(validateModel(value), null, 2);
}

export function importModel(serialized) {
  let value;
  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  } catch {
    throw new Error('O arquivo de backup não contém JSON válido.');
  }
  return validateModel(value);
}
