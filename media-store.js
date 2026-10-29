import { createId } from './storage.js';
import { apiUrl } from './api-url.js';

const MAX_FILE_SIZE = 3 * 1024 * 1024;
const urls = new Map();

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

export async function saveMediaFile(file, id) {
  if (!(file instanceof Blob) || !file.size || file.size > 3 * 1024 * 1024) throw new Error('Escolha um arquivo de até 3 MB.');
  const mediaId = id || createId();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
  const response = await fetch(apiUrl('/api/media'), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:mediaId,name:file.name,type:mediaType(file),dataUrl}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o arquivo.');
  return result;
}

export async function getMediaUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const file = await getMediaFile(id);
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  return url;
}

export async function getMediaFile(id) {
  let response;
  try {
    response = await fetch(apiUrl(`/api/media/${encodeURIComponent(id)}`), {
      credentials: 'same-origin'
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
    throw new Error('O arquivo de mídia do backup é inválido ou excede o limite de 3 MB.');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_FILE_SIZE) throw new Error('O arquivo de mídia do backup está vazio ou excede 3 MB.');
  const file = new File([blob], String(name || 'material').slice(0, 180), { type: blob.type || 'application/octet-stream' });
  return saveMediaFile(file, id);
}
