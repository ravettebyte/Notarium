const DATABASE_NAME = 'notarium-media';
const STORE_NAME = 'files';
const objectUrls = new Map();
let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador não oferece armazenamento local de arquivos.'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(new Error(`Não foi possível abrir o armazenamento de mídia: ${request.error?.message || 'erro desconhecido'}`));
    };
    request.onblocked = () => reject(new Error('Feche outras abas do Notarium para atualizar o armazenamento de mídia.'));
  });
  return databasePromise;
}

async function transaction(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Falha no armazenamento de mídia: ${request.error?.message || 'erro desconhecido'}`));
    tx.onabort = () => reject(new Error(`Falha no armazenamento de mídia: ${tx.error?.message || 'transação cancelada'}`));
  });
}

export async function saveMediaFile(file) {
  if (!(file instanceof Blob)) throw new TypeError('Selecione um arquivo válido.');
  const id = globalThis.crypto?.randomUUID?.()
    || `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const record = {
    id,
    blob: file,
    name: file.name || 'arquivo',
    type: file.type || 'application/octet-stream',
    size: file.size
  };
  await transaction('readwrite', store => store.put(record));
  return { id, name: record.name, type: record.type, size: record.size };
}

export async function getMediaFile(id) {
  const record = await transaction('readonly', store => store.get(String(id)));
  if (!record) throw new Error('O arquivo de mídia não foi encontrado neste navegador.');
  return new File([record.blob], record.name, { type: record.type, lastModified: record.blob.lastModified || Date.now() });
}

export async function getMediaUrl(id) {
  const key = String(id);
  if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(await getMediaFile(key)));
  return objectUrls.get(key);
}

export async function mediaAsDataUrl(id) {
  const file = await getMediaFile(id);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Não foi possível ler o arquivo "${file.name}".`));
    reader.readAsDataURL(file);
  });
}

export async function restoreMediaDataUrl(dataUrl, name = 'arquivo', type) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new TypeError('O backup contém uma mídia em formato inválido.');
  }
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Não foi possível restaurar um arquivo de mídia do backup.');
  const blob = await response.blob();
  return saveMediaFile(new File([blob], String(name || 'arquivo'), { type: type || blob.type }));
}
