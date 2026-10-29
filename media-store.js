import { createId } from './storage.js';
import { apiUrl } from './api-url.js';

const DATABASE_NAME = 'notarium-local-media';
const DATABASE_VERSION = 1;
const STORE_NAME = 'files';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const urls = new Map();
let databasePromise;

function mediaType(file) {
  if (file.type) return file.type;
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  return ({
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', xml: 'application/xml', musicxml: 'application/vnd.recordare.musicxml+xml', mxl: 'application/vnd.recordare.musicxml'
  })[extension] || 'application/octet-stream';
}

function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('O armazenamento de arquivos deste navegador não está disponível.');
  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento local de arquivos.'));
    request.onblocked = () => reject(new Error('Feche outras abas do Notarium para atualizar o armazenamento de arquivos.'));
  });
  return databasePromise;
}

async function storeRecord(record) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('O navegador não conseguiu salvar o arquivo selecionado.'));
    transaction.onabort = () => reject(new Error('O armazenamento do navegador recusou este arquivo. Libere espaço e tente novamente.'));
  });
}

export async function saveMediaFile(file, id) {
  if (!(file instanceof Blob) || !file.size) throw new Error('Escolha um arquivo válido e não vazio.');
  if (file.size > MAX_FILE_SIZE) throw new Error('Para preservar o espaço local, cada arquivo pode ter no máximo 15 MB.');
  if (navigator.storage?.estimate) {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota && usage !== undefined && quota - usage < file.size * 1.15) {
      throw new Error('Há pouco espaço livre no navegador para este arquivo. Exporte seus dados ou escolha um arquivo menor.');
    }
  }
  const mediaId = id || createId();
  const record = {
    id: mediaId,
    blob: file,
    name: String(file.name || 'material').slice(0, 180),
    type: mediaType(file),
    size: file.size,
    updatedAt: new Date().toISOString()
  };
  await storeRecord(record);
  return { id: mediaId, name: record.name, type: record.type, size: record.size };
}

export async function getMediaUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const file = await getMediaFile(id);
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  return url;
}

export async function getMediaFile(id) {
  if (globalThis.indexedDB) {
    const database = await openDatabase();
    const record = await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Não foi possível carregar o arquivo salvo.'));
    });
    if (record?.blob) return new File([record.blob], record.name, { type: record.type });
  }
  const token = sessionStorage.getItem('notarium-session') || '';
  if (!token) throw new Error('O arquivo deste material não foi encontrado neste navegador. Restaure-o a partir de um backup.');
  let response;
  try {
    response = await fetch(apiUrl(`/api/media/${encodeURIComponent(id)}`), {
      headers: { Authorization: 'Bearer ' + token },
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor para carregar este material.');
  }
  if (!response.ok) {
    let message = 'O arquivo deste material não foi encontrado no servidor.';
    try { message = (await response.json()).error || message; }
    catch { message = 'O servidor respondeu com um erro ao carregar este material.'; }
    throw new Error(message);
  }
  const blob = await response.blob();
  const encodedName = response.headers.get('X-Media-Name');
  if (!encodedName) throw new Error('O servidor não informou o nome do arquivo.');
  let name;
  try { name = decodeURIComponent(encodedName); }
  catch { throw new Error('O servidor informou um nome de arquivo inválido.'); }
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

export async function mediaAsDataUrl(id) {
  const file = await getMediaFile(id);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Não foi possível incluir “${file.name}” no backup.`));
    reader.readAsDataURL(file);
  });
}

export async function restoreMediaDataUrl(dataUrl, name, id) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:') || dataUrl.length > MAX_FILE_SIZE * 1.5) {
    throw new Error('O arquivo de mídia do backup é inválido ou excede o limite de 15 MB.');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_FILE_SIZE) throw new Error('O arquivo de mídia do backup está vazio ou excede 15 MB.');
  const file = new File([blob], String(name || 'material').slice(0, 180), { type: blob.type || 'application/octet-stream' });
  return saveMediaFile(file, id);
}
