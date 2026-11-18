import { createId, exportModel, importModel, loadModel, saveModel, validateModel } from './storage.js';
import { bindPianos, formatNote, parseNote, parseNoteSpelling, parseNotes, pianoMarkup, playNoteSequence, playNotes } from './piano.js?v=score-playback-1';
import { extractPlaybackEvents, extractRhythmEvents, readMusicXmlFile, readMusicXmlUrl, renderMusicXml } from './musicxml.js?v=score-playback-1';
import { getMediaFile, getMediaUrl, mediaAsDataUrl, restoreMediaDataUrl, saveMediaFile } from './media-store.js';
import { apiUrl } from './api-url.js';
import { catalogItems } from './catalog.js';

const root = document.createElement('div');
root.id = 'notarium-root';
document.body.replaceChildren(root);
let loadingQuote = null;
let loadingQuoteTimer = null;
document.documentElement.lang = 'pt-BR';
document.title = 'Notarium — Aprenda música no seu ritmo';

let model;
let view = 'inicio';
let selectedBlockId = null;
let selectedExercisePlaylistId = null;
let selectedExerciseBlockId = null;
let learningProgress = [];
let activeExerciseId = null;
let activeLessonId = null;
let toastTimer;
let dialogNoticeTimer;
let activityLoadingTimer = null;
let activityLoadingTitle = '';
let exerciseDraft = null;
let pendingScoreFiles = new Map();
let questionRecorders = new Map();
const remoteMediaUrls = new Map();
const scoreXmlCache = new Map();
let resultsExerciseId = null;
let resultsStudentId = null;
let selectedOnlineStudentId = null;
let charts = [];
let profileTab = 'profile';
let selectedProfileId = null;
let selectedTrailStudentId = 'demo-ana';
let collaboratorFilter = 'all';
let collaboratorSort = 'name';
let accountSession = null;
let accountToken = localStorage.getItem('notarium-session') || sessionStorage.getItem('notarium-session') || '';
let accountPortalUrl = '';
let accountError = '';
let accountNotice = '';
let accountSetupNeeded = false;
let studentsCache = [];
let studentsLoaded = false;
let studentsLoading = false;
let lastCreatedStudentAccess = null;
let remoteSaveTimer;
let remoteModelSaveQueue = Promise.resolve();
let notificationsCache = [];
let notificationsLoaded = false;
let presenceTimer;
let studentContentRefreshPromise = null;
let studentContentRefreshWarningShown = false;
let assessmentAccess = null;
let assessmentClockTimer;
let assessmentCountdownValue = 10;
let assessmentHeartbeatTimer;
const rhythmRunStates = new Map();
const demoGroup = {
  id: 'demo-harmonia',
  name: 'Grupo',
  description: 'Acompanhe os membros, a participação e o progresso nas atividades.',
  memberIds: ['demo-ana', 'demo-caio', 'demo-lia', 'demo-mateus', 'demo-bia']
};
const demoMembers = [
  { id: 'demo-ana', name: 'Ana Costa', username: 'ana.costa', initials: 'AC', bio: 'Estudante de piano e curiosa sobre harmonia.', groupRole: 'admin', presence: 'online', publications: ['Como pratico tríades maiores (demo)'], activities: ['Prática de acordes · hoje (demo)'] },
  { id: 'demo-caio', name: 'Caio Nunes', username: 'caio.nunes', initials: 'CN', bio: 'Estudante de música e piano.', groupRole: 'moderator', presence: 'away', publications: [], activities: [] },
  { id: 'demo-lia', name: 'Lia Martins', username: 'lia.martins', initials: 'LM', bio: 'Violão, percepção musical e composição.', groupRole: 'member', presence: 'offline', publications: ['Diário de composição (demo)'], activities: ['Estudo de intervalos · ontem (demo)'] },
  { id: 'demo-mateus', name: 'Mateus Rocha', username: 'mateus.rocha', initials: 'MR', bio: 'Aprendendo piano e leitura à primeira vista.', groupRole: 'moderator', presence: 'online', publications: ['Meu primeiro exercício de leitura (demo)'], activities: ['Leitura à primeira vista · hoje (demo)'] },
  { id: 'demo-bia', name: 'Bia Souza', username: 'bia.souza', initials: 'BS', bio: 'Gosta de explorar acordes e ritmos.', groupRole: 'member', presence: 'offline', publications: ['Ideias de ritmo para piano (demo)'], activities: ['Prática de ritmo · há 2 dias (demo)'] }
];
const demoParticipants = [
  { id: 'demo-ana', name: 'Ana (demo)', initials: 'A' },
  { id: 'demo-caio', name: 'Caio (demo)', initials: 'C' },
  { id: 'demo-lia', name: 'Lia (demo)', initials: 'L' },
  { id: 'demo-mateus', name: 'Mateus (demo)', initials: 'M' },
  { id: 'demo-bia', name: 'Bia (demo)', initials: 'B' }
];
const trailKeySignatures = [
  { value: 'C-major', label: 'Dó maior', type: 'sharp', count: 0 },
  { value: 'G-major', label: 'Sol maior', type: 'sharp', count: 1 },
  { value: 'D-major', label: 'Ré maior', type: 'sharp', count: 2 },
  { value: 'A-major', label: 'Lá maior', type: 'sharp', count: 3 },
  { value: 'E-major', label: 'Mi maior', type: 'sharp', count: 4 },
  { value: 'B-major', label: 'Si maior', type: 'sharp', count: 5 },
  { value: 'Fsharp-major', label: 'Fá sustenido maior', type: 'sharp', count: 6 },
  { value: 'Csharp-major', label: 'Dó sustenido maior', type: 'sharp', count: 7 },
  { value: 'F-major', label: 'Fá maior', type: 'flat', count: 1 },
  { value: 'Bb-major', label: 'Si bemol maior', type: 'flat', count: 2 },
  { value: 'Eb-major', label: 'Mi bemol maior', type: 'flat', count: 3 },
  { value: 'Ab-major', label: 'Lá bemol maior', type: 'flat', count: 4 },
  { value: 'Db-major', label: 'Ré bemol maior', type: 'flat', count: 5 },
  { value: 'Gb-major', label: 'Sol bemol maior', type: 'flat', count: 6 },
  { value: 'Cb-major', label: 'Dó bemol maior', type: 'flat', count: 7 },
  { value: 'A-minor', label: 'Lá menor', type: 'sharp', count: 0 },
  { value: 'E-minor', label: 'Mi menor', type: 'sharp', count: 1 },
  { value: 'B-minor', label: 'Si menor', type: 'sharp', count: 2 },
  { value: 'Fsharp-minor', label: 'Fá sustenido menor', type: 'sharp', count: 3 },
  { value: 'Csharp-minor', label: 'Dó sustenido menor', type: 'sharp', count: 4 },
  { value: 'Gsharp-minor', label: 'Sol sustenido menor', type: 'sharp', count: 5 },
  { value: 'Dsharp-minor', label: 'Ré sustenido menor', type: 'sharp', count: 6 },
  { value: 'Asharp-minor', label: 'Lá sustenido menor', type: 'sharp', count: 7 },
  { value: 'D-minor', label: 'Ré menor', type: 'flat', count: 1 },
  { value: 'G-minor', label: 'Sol menor', type: 'flat', count: 2 },
  { value: 'C-minor', label: 'Dó menor', type: 'flat', count: 3 },
  { value: 'F-minor', label: 'Fá menor', type: 'flat', count: 4 },
  { value: 'Bb-minor', label: 'Si bemol menor', type: 'flat', count: 5 },
  { value: 'Eb-minor', label: 'Mi bemol menor', type: 'flat', count: 6 },
  { value: 'Ab-minor', label: 'Lá bemol menor', type: 'flat', count: 7 }
];
const trailTimeSignatures = ['2/4', '3/4', '4/4', '5/4', '6/8', '9/8', '12/8'];

const icons = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  lessons: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 4.5v17m4-15h7m-7 4h7"/></svg>',
  exercises: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  results: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 14h17M8 15l4-4 3 2 5-6"/><path d="M17 7h3v3"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm13-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1h-3"/></svg>',
  trail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v4a4 4 0 0 0 4 4h8a4 4 0 0 1 4 4v4"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="20" r="2"/><circle cx="16" cy="12" r="2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54A.49.49 0 0 0 13.87 2h-3.84a.49.49 0 0 0-.49.42L9.18 4.96c-.59.23-1.14.55-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.63 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.05.3-.08.61-.08.94s.03.64.08.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.21.37.3.61.22l2.39-.96c.49.39 1.04.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.59-.23 1.14-.55 1.63-.94l2.39.96c.24.09.49-.01.61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/></svg>'
};
const types = {
  choice: 'Múltipla escolha',
  boolean: 'Verdadeiro ou falso',
  written: 'Resposta escrita',
  chord: 'Construção de acorde',
  ear: 'Reconhecimento auditivo',
  score: 'Questão com partitura',
  rhythm: 'Leitura rítmica',
  material: 'Imagem ou material',
  custom: 'Resposta personalizada'
};

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function text(value = '') {
  return esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
}

function sanitizeRichText(value = '') {
  const source = document.createElement('template');
  source.innerHTML = String(value);
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN']);
  const sanitizeNode = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const fragment = document.createDocumentFragment();
    if (!allowedTags.has(node.tagName)) {
      for (const child of node.childNodes) fragment.append(sanitizeNode(child));
      if (['DIV', 'P'].includes(node.tagName)) fragment.append(document.createElement('br'));
      return fragment;
    }
    const element = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === 'SPAN') {
      const color = node.style.color;
      if (/^(#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i.test(color)) element.style.color = color;
    }
    for (const child of node.childNodes) element.append(sanitizeNode(child));
    fragment.append(element);
    return fragment;
  };
  const clean = document.createElement('div');
  for (const child of source.content.childNodes) clean.append(sanitizeNode(child));
  return clean.innerHTML;
}

function richTextMarkup(value = '') {
  const source = String(value ?? '');
  return source.includes('<') ? sanitizeRichText(source) : text(source);
}

function chordAssistMarkup() {
  const symbols = ['♯', '♭', '♮', '♭5', '♯5', '♭9', '♯9', '♭13', 'sus2', 'sus4', 'dim', 'aug'];
  return `<div class="chord-assist" hidden><span>🎼 Acorde detectado · selecione um símbolo ou formate o trecho:</span><div class="chord-assist-tools">${symbols.map(symbol => `<button type="button" class="chord-assist-button" data-action="insert-chord-symbol" data-symbol="${esc(symbol)}">${esc(symbol)}</button>`).join('')}<button type="button" class="chord-assist-button chord-format-button" data-action="format-chord-text" data-format="bold" aria-label="Negrito"><strong>B</strong></button><label class="chord-color-control" title="Escolher cor do texto">A<input type="color" class="chord-text-color" value="#1452df" aria-label="Escolher cor do texto"></label></div></div>`;
}

function richTextPlainText(value = '') {
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichText(value);
  return container.textContent || '';
}

function chordDetected(value) {
  const textValue = String(value || '').replace(/<[^>]*>/g, ' ');
  const note = '[A-G](?:[#♯b♭])?(?:(?:maj|min|m|dim|aug|sus\\d*|add\\d*|\\d+))?(?:\\/[A-G](?:[#♯b♭])?)?';
  return new RegExp(`(?:^|\\s)${note}(?:\\s+${note})+(?:$|\\s)`, 'i').test(textValue)
    || /(?:^|\s)[A-G](?:[#♯b♭](?:maj|min|m|dim|aug|sus\d*|add\d*|\d+)?|(?:maj|min|dim|aug|sus\d*|add\d*)\d*|[0-9]{1,2})(?:$|\s)/i.test(textValue);
}

function updateChordAssist(row) {
  const editor = row.querySelector('.question-prompt');
  const assist = row.querySelector('.chord-assist');
  if (editor && assist) assist.hidden = !chordDetected(editor.textContent);
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, location.href);
    return ['https:', 'http:', 'blob:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function currentProfile() {
  return model.profile;
}

async function accountRequest(path, options = {}, token = accountToken) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Inicie o Notarium com node server.js ou confira a hospedagem.');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('O servidor não respondeu com JSON. Acesse o Notarium pelo servidor oficial, não pelo Live Server.'); }
  if (!response.ok) {
    const error = new Error(result.error || `A solicitação falhou (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function downloadCatalogMedia(mediaId) {
  const item = catalogItems.find(entry => entry.mediaId === mediaId);
  if (!item || !accountToken) throw new Error('Não foi possível localizar a partitura ou sua sessão expirou.');

  let response;
  try {
    response = await fetch(apiUrl(`/api/media/${encodeURIComponent(mediaId)}`), {
      headers: { Authorization: `Bearer ${accountToken}` }
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor para baixar a partitura.');
  }
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || `O download falhou (${response.status}).`);
  }
  if (response.headers.get('Content-Type')?.split(';')[0] !== item.mediaType) {
    throw new Error('O servidor retornou um arquivo inesperado em vez da partitura.');
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = item.title.endsWith('.mxl') ? item.title : `${item.title}.mxl`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Partitura baixada.');
}

function saveAccountToken(token) {
  accountToken = token || '';
  if (accountToken) localStorage.setItem('notarium-session', accountToken);
  else localStorage.removeItem('notarium-session');
  sessionStorage.removeItem('notarium-session');
}

function onlineUserModel(source, user) {
  const result = validateModel(source);
  const localTheme = model?.profile.theme;
  result.profile.role = user.role;
  result.profile.displayName = user.name;
  result.profile.username = user.username;
  const savedTheme = localStorage.getItem('notarium-theme');
  result.profile.theme = savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : localTheme === 'dark' || localTheme === 'light' ? localTheme : result.profile.theme;
  return result;
}

function lessonIsPublished(lesson) {
  return lesson?.published === true || lesson?.status === 'published';
}

function setThemePreference(theme, announce = true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('notarium-theme', nextTheme);
  if (model) {
    model.profile.theme = nextTheme;
    model = saveModel(model);
  }
  document.documentElement.dataset.theme = nextTheme;
  const toggle = root.querySelector('#theme-toggle');
  if (toggle) toggle.textContent = nextTheme === 'dark' ? '☼ Tema claro' : '☾ Tema escuro';
  root.querySelectorAll('#theme-preference, #quick-theme-preference').forEach(select => {
    select.value = nextTheme;
  });
  if (announce) toast(`Tema ${nextTheme === 'dark' ? 'escuro' : 'claro'} ativado.`);
}

function queueRemoteModelSave({ silent = false } = {}) {
  if (accountSession?.role !== 'teacher') return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(() => {
    const body = JSON.stringify({ model });
    remoteModelSaveQueue = remoteModelSaveQueue.catch(() => {}).then(async () => {
      await accountRequest('/api/model', { method: 'PUT', body });
      if (!silent) toast('Conteúdo sincronizado com o servidor.');
    }).catch(error => {
      toast(`As alterações locais foram salvas, mas não sincronizadas: ${error.message}`, 'error');
    });
  }, 350);
}

async function syncOnlineMedia(mediaId) {
  if (accountSession?.role !== 'teacher') return;
  let existing;
  try {
    existing = await fetch(apiUrl(`/api/media/${encodeURIComponent(mediaId)}`), {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${accountToken}` }
    });
  } catch {
    throw new Error('Não foi possível verificar a mídia no servidor.');
  }
  if (existing.ok) return;
  if (existing.status !== 404) {
    throw new Error(`Não foi possível verificar a mídia no servidor (${existing.status}).`);
  }
  const file = await getMediaFile(mediaId);
  const dataUrl = await mediaAsDataUrl(mediaId);
  await accountRequest('/api/media', {
    method: 'POST',
    body: JSON.stringify({ id: mediaId, name: file.name, type: file.type, dataUrl })
  });
}

async function getScoreMediaFile(question) {
  try {
    return await getMediaFile(question.musicMediaId);
  } catch (localError) {
    if (!accountToken) throw localError;
    let response;
    try {
      response = await fetch(apiUrl(`/api/media/${encodeURIComponent(question.musicMediaId)}`), {
        headers: { Authorization: `Bearer ${accountToken}` }
      });
    } catch {
      throw new Error('A partitura não está salva neste navegador e não foi possível conectar ao servidor.');
    }
    if (!response.ok) {
      let result;
      try { result = await response.json(); }
      catch { throw new Error(`Não foi possível carregar a partitura (${response.status}).`); }
      throw new Error(result.error || `Não foi possível carregar a partitura (${response.status}).`);
    }
    const type = response.headers.get('Content-Type')?.split(';')[0]
      || question.musicMediaType
      || 'application/octet-stream';
    const name = question.musicMediaName || 'partitura.mxl';
    return new File([await response.blob()], name, { type });
  }
}

function museScoreScoreUrl(value) {
  const url = safeUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  if (parsed.hostname !== 'musescore.com' && !parsed.hostname.endsWith('.musescore.com')) return '';
  return /\/(?:scores?|official_scores)\/\d+(?:\/|$)/i.test(parsed.pathname) ? url : '';
}

async function loadQuestionMusicXml(question) {
  const source = question.scoreSource || (question.musicMediaId || question.musicXml ? 'upload' : 'link');
  const xml = source === 'upload' && question.musicMediaId
    ? await readMusicXmlFile(await getScoreMediaFile(question))
    : source === 'link' && safeUrl(question.musicUrl)
      ? await readMusicXmlUrl(question.musicUrl)
      : question.musicXml || '';
  if (!xml) throw new Error('Partitura não anexada ou link não informado.');
  return xml;
}

async function loadPromptScoreXml(question) {
  const source = question.promptScoreSource || (question.promptScoreMediaId ? 'upload' : 'link');
  if ((source === 'upload' || !safeUrl(question.promptScoreUrl)) && question.promptScoreMediaId) {
    let file;
    try {
      file = await getMediaFile(question.promptScoreMediaId);
    } catch (localError) {
      if (!accountToken) throw localError;
      let response;
      try {
        response = await fetch(apiUrl(`/api/media/${encodeURIComponent(question.promptScoreMediaId)}`), {
          headers: { Authorization: `Bearer ${accountToken}` }
        });
      } catch {
        throw new Error('A partitura não está salva neste navegador e não foi possível conectar ao servidor.');
      }
      if (!response.ok) throw new Error(`Não foi possível carregar a partitura (${response.status}).`);
      file = new File([await response.blob()], question.promptScoreMediaName || 'partitura.mxl', {
        type: response.headers.get('Content-Type')?.split(';')[0] || question.promptScoreMediaType || 'application/octet-stream'
      });
    }
    return readMusicXmlFile(file);
  }
  if (source === 'link' && safeUrl(question.promptScoreUrl) && !museScoreScoreUrl(question.promptScoreUrl)) {
    return readMusicXmlUrl(question.promptScoreUrl);
  }
  throw new Error('Adicione um arquivo MusicXML/MXL ou um link direto para a partitura.');
}

async function syncReferencedMedia() {
  if (accountSession?.role !== 'teacher') return;
  const ids = new Set();
  for (const lesson of model.lessons) for (const block of lesson.content || []) {
    if (block.mediaSource === 'upload' && block.mediaId) ids.add(block.mediaId);
  }
  for (const exercise of model.exercises) for (const question of exercise.questions || []) {
    if (question.mediaSource === 'upload' && question.mediaId) ids.add(question.mediaId);
    if (question.musicMediaId) ids.add(question.musicMediaId);
    if (question.promptMediaId) ids.add(question.promptMediaId);
    if (question.promptScoreMediaId) ids.add(question.promptScoreMediaId);
    if (question.audioMediaId) ids.add(question.audioMediaId);
  }
  const failures = [];
  for (const id of ids) {
    try { await syncOnlineMedia(id); }
    catch (error) { failures.push(`${id}: ${error.message}`); }
  }
  if (failures.length) {
    throw new Error(`Não foi possível sincronizar ${failures.length} arquivo(s): ${failures.join('; ')}`);
  }
}

async function getAccountMediaUrl(mediaId) {
  try {
    return await getMediaUrl(mediaId);
  } catch (localError) {
    if (!accountToken) throw localError;
    if (remoteMediaUrls.has(mediaId)) return remoteMediaUrls.get(mediaId);
    let response;
    try {
      response = await fetch(apiUrl(`/api/media/${encodeURIComponent(mediaId)}`), {
        headers: { Authorization: `Bearer ${accountToken}` }
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor para carregar este arquivo.');
    }
    if (!response.ok) {
      let result;
      try { result = await response.json(); }
      catch { throw new Error(`Não foi possível carregar o arquivo (${response.status}).`); }
      throw new Error(result.error || `Não foi possível carregar o arquivo (${response.status}).`);
    }
    const url = URL.createObjectURL(await response.blob());
    remoteMediaUrls.set(mediaId, url);
    return url;
  }
}

function questionMediaData(row, prefix, saved) {
  row.dataset[`${prefix}MediaId`] = saved.id;
  row.dataset[`${prefix}MediaName`] = saved.name;
  row.dataset[`${prefix}MediaType`] = saved.type;
  row.dataset[`${prefix}MediaSize`] = String(saved.size);
}

async function saveQuestionMedia(row, file, prefix, status, dialog) {
  if (!file.type.startsWith(prefix === 'audio' || prefix === 'response' ? 'audio/' : 'image/')
      && !(prefix === 'prompt' && (file.type === 'application/pdf'
        || file.type.startsWith('text/') || file.type.startsWith('application/')))) {
    throw new Error(prefix === 'audio' ? 'Escolha um arquivo de áudio válido.' : 'Escolha uma imagem ou documento válido.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo deve ter até 20 MB.');
  row.dataset[`${prefix}Uploading`] = 'true';
  status.textContent = `Salvando “${file.name}”...`;
  let saved;
  try {
    saved = await saveMediaFile(file);
    questionMediaData(row, prefix, saved);
    await syncOnlineMedia(saved.id);
    status.textContent = `Arquivo pronto: ${saved.name}${accountSession?.role === 'teacher' ? ' · salvo também no servidor' : ''}.`;
    if (prefix === 'audio') {
      row.dataset.audioFrequency = row.querySelector('.question-audio-frequency')?.value || '';
      const preview = row.querySelector('.question-audio-preview');
      if (preview) {
        preview.innerHTML = uploadedMediaMarkup(saved.id, saved.name, saved.type, '', '', row.dataset.audioFrequency);
        hydrateMedia(preview);
      }
    }
    row.dataset[`${prefix}Uploading`] = 'false';
    if (dialog) showDialogNotice(dialog, `Arquivo “${saved.name}” salvo${accountSession?.role === 'teacher' ? ' e sincronizado' : ''}.`);
    return saved;
  } catch (error) {
    row.dataset[`${prefix}Uploading`] = saved && accountSession?.role === 'teacher' ? 'true' : 'false';
    status.textContent = error.message;
    throw error;
  }
}

async function startQuestionRecording(row, prefix, dialog = null) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Este navegador não permite gravar áudio. Envie um arquivo de áudio.', 'error');
    return;
  }
  const questionId = row.dataset.questionId || row.dataset.question;
  if (!questionId) {
    toast('Não foi possível identificar a questão para anexar a gravação.', 'error');
    return;
  }
  if (questionRecorders.has(questionId)) {
    toast('Esta questão já está gravando.', 'error');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const status = row.querySelector(prefix === 'audio' ? '.question-audio-status' : '.answer-audio-status');
    const startAction = prefix === 'audio' ? 'record-audio' : 'record-response-audio';
    const stopAction = prefix === 'audio' ? 'stop-audio-recording' : 'stop-response-audio';
    const startButton = row.querySelector(`[data-action="${startAction}"]`);
    const stopButton = row.querySelector(`[data-action="${stopAction}"]`);
    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.disabled = false;
    if (status) status.textContent = 'Gravando… pressione Parar quando terminar.';
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      questionRecorders.delete(questionId);
      if (startButton) startButton.disabled = false;
      if (stopButton) stopButton.disabled = true;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) {
        if (status) status.textContent = 'A gravação ficou vazia. Tente novamente.';
        return;
      }
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `gravacao-${Date.now()}.${extension}`, { type: blob.type });
      try {
        const saved = await saveQuestionMedia(row, file, prefix, status, dialog);
        if (prefix === 'response') {
          row.dataset.responseAudioId = saved.id;
          row.dataset.responseAudioName = saved.name;
          row.dataset.responseAudioType = saved.type;
          row.dataset.responseAudioSize = String(saved.size);
          const preview = row.querySelector('.answer-audio-preview');
          if (preview) {
            preview.innerHTML = uploadedMediaMarkup(saved.id, saved.name, saved.type);
            hydrateMedia(preview);
          }
        }
      } catch (error) {
        toast(error.message, 'error');
      }
    }, { once: true });
    questionRecorders.set(questionId, { recorder, stream });
    recorder.start();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    toast(`Não foi possível iniciar a gravação: ${error.message}`, 'error');
  }
}

function stopQuestionRecording(row) {
  const active = questionRecorders.get(row.dataset.questionId || row.dataset.question);
  if (!active || active.recorder.state === 'inactive') return;
  active.recorder.stop();
}

function defaultOctave() {
  return Number.isInteger(Number(currentProfile().defaultOctave)) ? Number(currentProfile().defaultOctave) : 4;
}

function parseCurrentNote(value) {
  return parseNote(value, defaultOctave());
}

function parseCurrentNotes(value) {
  return parseNotes(value, defaultOctave());
}

function canonicalNoteToken(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function profileAvatar(profile, demo = false) {
  const displayName = profile.displayName || profile.name || 'Músico';
  const image = profile.avatarDataUrl
    ? `<img src="${esc(profile.avatarDataUrl)}" alt="">`
    : `<span aria-hidden="true">${esc(String(profile.initials || displayName.slice(0, 1)).slice(0, 2).toUpperCase())}</span>`;
  return `<span class="profile-avatar${demo ? ' demo-avatar-profile' : ''}">${image}</span>`;
}

function persist(message = 'Alterações salvas na conta.') {
  try {
    model = saveModel(model);
    queueRemoteModelSave();
    render();
    if (message) toast(accountSession?.role === 'teacher'
      ? 'Alterações sincronizadas com o servidor.'
      : message);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function toast(message, type = 'success') {
  const element = root.querySelector('#toast');
  if (!element) return;
  element.textContent = message;
  element.className = `toast ${type === 'error' ? 'toast-error' : ''} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3200);
}

function soundEnabled() {
  return localStorage.getItem('notarium-click-sounds') !== 'off';
}

function playClickSound() {
  if (!soundEnabled()) return;
  const note = localStorage.getItem('notarium-click-note') || 'C5';
  const volume = Number(localStorage.getItem('notarium-click-volume') || 300) / 100;
  const midi = parseCurrentNote(note);
  if (Number.isFinite(midi)) playNotes([midi], 0.22, 4, volume).catch(() => {});
}

function playNotificationSound() {
  const midi = parseCurrentNote('E6');
  if (Number.isFinite(midi)) playNotes([midi], 0.34).catch(() => {});
}

root.addEventListener('click', event => {
  if (event.target.closest('.piano-panel')) return;
  if (event.target.closest('[data-action="play-typed-chord"], [data-action="play-chord-reference"], [data-action="play-reference"]')) return;
  if (event.target.closest('button, a, input, select, label')) playClickSound();
}, true);

const PENDING_ATTEMPTS_KEY = 'notarium-pending-attempts';

function pendingAttempts() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_ATTEMPTS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePendingAttempts(items) {
  localStorage.setItem(PENDING_ATTEMPTS_KEY, JSON.stringify(items));
}

async function uploadStudentMedia(attachment) {
  let existing;
  try {
    existing = await fetch(apiUrl(`/api/media/${encodeURIComponent(attachment.id)}`), {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${accountToken}` }
    });
  } catch {
    throw new Error('Não foi possível verificar o arquivo no servidor.');
  }
  if (existing.ok) return;
  if (existing.status !== 404) {
    throw new Error(`Não foi possível verificar o arquivo no servidor (${existing.status}).`);
  }
  await accountRequest('/api/media', {
    method: 'POST',
    body: JSON.stringify({
      id: attachment.id,
      name: attachment.name,
      dataUrl: await mediaAsDataUrl(attachment.id)
    })
  });
}

function enqueuePendingAttempt(attempt) {
  const items = pendingAttempts().filter(item => item.id !== attempt.id);
  items.push(attempt);
  savePendingAttempts(items);
}

async function flushPendingAttempts() {
  if (!accountSession || accountSession.role !== 'student' || !navigator.onLine) return;
  const items = pendingAttempts();
  if (!items.length) return;
  const remaining = [];
  let firstFailure = '';
  for (const attempt of items) {
    try {
      for (const attachment of attempt.attachments || []) await uploadStudentMedia(attachment);
      for (const answer of attempt.answers || []) {
        if (answer.audioAttachment) await uploadStudentMedia(answer.audioAttachment);
      }
      const saved = await accountRequest('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ attempt })
      });
      model.attempts = model.attempts.filter(item => item.id !== attempt.id && item.id !== saved.attempt.id);
      model.attempts.push(saved.attempt);
      model = saveModel(model);
    } catch (error) {
      remaining.push(attempt);
      if (!firstFailure) firstFailure = error.message;
    }
  }
  savePendingAttempts(remaining);
  if (items.length && !remaining.length) {
    toast('Tentativas salvas offline foram enviadas ao professor.');
    render();
  } else if (firstFailure) {
    toast(`Não foi possível enviar ${remaining.length} tentativa(s) salvas offline: ${firstFailure}`, 'error');
  }
}

window.addEventListener('online', () => {
  toast('Conexão restabelecida. Sincronizando...');
  flushPendingAttempts().catch(error => toast(`Não foi possível sincronizar tentativas: ${error.message}`, 'error'));
});

async function copyText(value, successMessage) {
  if (!navigator.clipboard?.writeText) {
    toast('Seu navegador não permite copiar automaticamente. Selecione e copie o texto exibido.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast(successMessage);
  } catch {
    toast('Não foi possível copiar automaticamente. Selecione e copie o texto exibido.', 'error');
  }
}

function empty(title, description, action, icon = '♫') {
  return `<section class="empty-state"><span class="empty-glyph" aria-hidden="true">${icon}</span><h2>${esc(title)}</h2><p>${esc(description)}</p>${action || ''}</section>`;
}

function pageHeading(kicker, title, description, actions = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p class="page-description">${esc(description)}</p></div><div class="page-actions">${actions}</div></header>`;
}

function button(label, action, style = 'secondary', extra = '') {
  return `<button type="button" class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
}

function visibleLessons() {
  return model.lessons.filter(lesson => currentProfile().role === 'teacher' || lessonIsPublished(lesson));
}

function visibleExercises() {
  return model.exercises.filter(exercise => !exercise.assessment
    && (currentProfile().role === 'teacher'
      || exerciseStatus(exercise) === 'published'
      || (exercise.accessLocked === true && exercise.published === true)));
}

function exerciseStatus(exercise) {
  if (exercise.status === 'draft' && exercise.published === true) return 'published';
  return ['draft', 'published', 'closed', 'archived'].includes(exercise.status)
    ? exercise.status
    : exercise.published ? 'published' : 'draft';
}

function learningProgressFor(contentType, contentId) {
  return learningProgress.find(item => item.contentType === contentType && item.contentId === contentId);
}

function learningComplete(contentType, contentId) {
  return Boolean(learningProgressFor(contentType, contentId));
}

function playlistColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#7658c8';
}

async function setLearningComplete(contentType, contentId, completed) {
  if (!accountSession || accountSession.role !== 'student') {
    toast('Entre na conta de aluno para salvar seu histórico.', 'error');
    return;
  }
  try {
    const result = await accountRequest(`/api/progress/${contentType}/${encodeURIComponent(contentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ completed })
    });
    learningProgress = learningProgress.filter(item =>
      item.contentType !== contentType || item.contentId !== contentId);
    if (result.progress) learningProgress.push(result.progress);
    render();
    toast(completed ? 'Conteúdo marcado como concluído.' : 'Conteúdo removido dos concluídos.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function isMediaBlock(block) {
  return ['image', 'video', 'link', 'pdf', 'audio'].includes(block.type);
}

function getBlock(id) {
  return model.blocks.find(block => block.id === id);
}

function getExerciseBlock(id) {
  return model.exerciseBlocks.find(block => block.id === id);
}

function getLesson(id) {
  return model.lessons.find(lesson => lesson.id === id);
}

function getExercise(id) {
  return model.exercises.find(exercise => exercise.id === id);
}

function ordered(items) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function navItem(id, label, icon) {
  const active = view === id
    || (id === 'playlists' && view === 'playlists')
    || (id === 'grupo' && view === 'resultados')
    || (id === 'trilha' && view === 'trilha')
    || (id === 'avaliacoes' && view === 'avaliacoes')
    || (id === 'aulas' && view === 'aula')
    || (id === 'exercicios' && view === 'exercicio');
  const badge = id === 'notificacoes' && notificationsCache.some(item => !item.readAt)
    ? `<span class="notification-count">${notificationsCache.filter(item => !item.readAt).length}</span>`
    : '';
  return `<button class="nav-item${active ? ' active' : ''}" type="button" data-view="${id}">${icons[icon]}<span>${label}</span>${badge}</button>`;
}

function shellMarkup() {
  const teacher = currentProfile().role === 'teacher';
  return `<div class="app-shell">
    <header class="app-header">
      <a class="brand" href="#" data-view="inicio" aria-label="Notarium, início"><span class="brand-image"><img src="icone.png" alt=""></span><span class="brand-copy"><strong>Notarium</strong><small>Estudo, prática e música em conjunto</small></span></a>
      <nav class="primary-nav" aria-label="Navegação principal">
        ${navItem('inicio', 'Visão geral', 'home')}
        ${navItem('aulas', 'Aulas', 'lessons')}
        ${navItem('exercicios', 'Exercícios', 'exercises')}
        ${navItem('playlists', 'Playlists', 'exercises')}
        ${teacher ? '' : navItem('historico', 'Meu histórico', 'results')}
        ${navItem('avaliacoes', 'Avaliações', 'results')}
        ${navItem('trilha', 'Trilha', 'trail')}
        ${navItem('grupo', 'Grupo', 'group')}
        ${navItem('notificacoes', 'Notificações', 'bell')}
        ${teacher ? navItem('alunos', 'Alunos', 'group') : ''}
      </nav>
      <div class="header-actions">
        <span class="local-pill"><i></i> Conta online</span>
        <div class="settings-menu">
          <button class="button secondary settings-gear" type="button" data-action="settings" aria-label="Abrir menu de configurações" aria-haspopup="true" aria-expanded="false" aria-controls="settings-menu-panel">${icons.settings}</button>
          <div class="settings-menu-panel" id="settings-menu-panel" role="menu" hidden>
            <p class="eyebrow">CONFIGURAÇÕES</p>
            <button type="button" class="settings-menu-item" data-action="accessibility" role="menuitem">${icons.settings}<span>Acessibilidade</span></button>
            <button type="button" class="settings-menu-item" data-action="open-configurations" role="menuitem"><span aria-hidden="true">⚙</span><span>Todas as configurações</span></button>
          </div>
        </div>
        <button class="button theme-button" type="button" data-action="theme" id="theme-toggle" aria-label="Alternar tema"></button>
        <button class="profile-button" type="button" data-action="profile" aria-label="Perfil de ${esc(currentProfile().displayName || 'Músico')}, ${teacher ? 'Professor' : 'Aluno'}${currentProfile().username ? `, @${esc(currentProfile().username)}` : ''}">${profileAvatar(currentProfile())}<span class="profile-copy"><strong>${esc(currentProfile().displayName || 'Músico')}</strong><small>${teacher ? 'Professor' : 'Aluno'}</small>${currentProfile().username ? `<span class="profile-handle">@${esc(currentProfile().username)}</span>` : ''}</span><span class="chevron" aria-hidden="true">⌄</span></button>
      </div>
    </header>
    <main class="main-content" id="app-main" tabindex="-1">
      <div class="breadcrumb"><span>Notarium</span><span aria-hidden="true">/</span><strong id="current-crumb"></strong><span class="local-note">Conta e conteúdo sincronizados pelo servidor</span></div>
      <div class="app-content" id="app-content"></div>
    </main>
    <footer class="app-footer"><strong>NOTARIUM</strong><span>Estudo, prática e música em conjunto</span><span class="footer-year">2026</span></footer>
    <div id="dialog-root"></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <input id="import-file" type="file" accept="application/json,.json" hidden>
  </div>`;
}

function blockCard(block) {
  const lessons = model.lessons.filter(lesson => lesson.blockId === block.id);
  const decorations = { notes: '♫', stars: '✦', petals: '❀', moon: '☾' };
  const decoration = decorations[block.decoration] ? block.decoration : 'notes';
  const locked = currentProfile().role === 'student' && block.accessLocked;
  return `<article class="block-card color-${esc(block.color || 'blue')} decoration-${decoration}${locked ? ' access-locked' : ''}"><div class="block-top"><span class="block-icon">${locked ? '🔒' : decorations[decoration]}</span><span class="count-pill">${lessons.length} ${lessons.length === 1 ? 'aula' : 'aulas'}</span></div><h3>${esc(block.title)}</h3><p>${esc(block.description || 'Conteúdos e práticas musicais organizados por você.')}</p><div class="card-bottom"><span>${locked ? 'Bloqueado pelo professor' : `${lessons.filter(lessonIsPublished).length} publicadas`}</span><button type="button" class="button primary small-button" data-action="open-block" data-id="${esc(block.id)}" ${locked ? 'disabled' : ''}>${locked ? 'Aguarde a liberação' : 'Abrir aulas'} <span aria-hidden="true">${locked ? '🔒' : '→'}</span></button></div>${currentProfile().role === 'teacher' ? `<button type="button" class="card-edit" data-action="edit-block" data-id="${esc(block.id)}" aria-label="Editar bloco ${esc(block.title)}">•••</button>` : ''}</article>`;
}

function lessonCard(lesson) {
  const block = getBlock(lesson.blockId);
  const related = (lesson.exerciseIds || []).length;
  const hasAttempt = model.attempts.some(attempt => attempt.exerciseId && lesson.exerciseIds?.includes(attempt.exerciseId) && attempt.profileName === currentProfile().displayName);
  const locked = currentProfile().role === 'student' && lesson.accessLocked;
  const completed = learningComplete('lesson', lesson.id);
  const published = lessonIsPublished(lesson);
  return `<article class="lesson-card${locked ? ' access-locked' : ''}${completed ? ' learning-completed' : ''}"><div class="lesson-cover"><span class="lesson-cover-note">${locked ? '🔒' : '𝄞'}</span><span class="count-pill">${esc(block?.title || 'Aula')}</span></div><div class="lesson-card-body"><div class="card-tags"><span class="status-tag ${locked ? 'draft' : published ? 'published' : 'draft'}">${locked ? 'Bloqueada' : published ? 'Publicada' : 'Rascunho'}</span>${completed ? '<span class="status-tag completed">Concluída</span>' : hasAttempt ? '<span class="status-tag">Em andamento</span>' : ''}</div><h3>${esc(lesson.title)}</h3><p>${esc(locked ? 'O professor ainda não liberou esta aula para você.' : lesson.subtitle || lesson.description || 'Uma nova etapa do seu percurso musical.')}</p><div class="card-meta"><span>${related} exercícios</span><span>Ordem ${Number(lesson.order) || 1}</span></div><button type="button" class="button secondary card-open" data-action="open-lesson" data-id="${esc(lesson.id)}" ${locked ? 'disabled' : ''}>${locked ? 'Aguarde a liberação 🔒' : 'Abrir aula'} ${locked ? '' : '<span aria-hidden="true">→</span>'}</button>${currentProfile().role === 'student' ? `<button type="button" class="button ${completed ? 'completed-progress-button' : 'secondary'} card-open progress-toggle" data-action="toggle-learning-progress" data-type="lesson" data-id="${esc(lesson.id)}" ${locked ? 'disabled' : ''}>${completed ? '✓ Concluída · Desmarcar' : 'Marcar aula como concluída'}</button>` : ''}${currentProfile().role === 'teacher' ? `<button type="button" class="card-edit" data-action="edit-lesson" data-id="${esc(lesson.id)}" aria-label="Editar aula ${esc(lesson.title)}">•••</button>` : ''}</div></article>`;
}

function exerciseCard(exercise) {
  const count = (exercise.questions || []).length;
  const attempts = model.attempts.filter(attempt => attempt.exerciseId === exercise.id && attempt.profileName === currentProfile().displayName);
  const demoAttempts = model.attempts.filter(attempt => attempt.exerciseId === exercise.id && attempt.isDemo);
  const relatedLessons = (exercise.lessonIds || []).map(getLesson).filter(Boolean);
  const status = exerciseStatus(exercise);
  const locked = currentProfile().role === 'student' && exercise.accessLocked;
  const completed = learningComplete('exercise', exercise.id);
  const title = exercise.title || (status === 'draft' ? 'Rascunho sem título' : 'Exercício');
  const summary = exercise.instructions || richTextPlainText(exercise.questions?.[0]?.prompt || '')
    || (status === 'draft' ? 'Continue editando este rascunho quando estiver pronto.' : 'Exercício de prática musical.');
  const statusLabels = { draft: 'Rascunho', published: 'Publicado', closed: 'Encerrado', archived: 'Arquivado' };
  const visibleStatus = currentProfile().role === 'teacher'
    ? `<span class="status-tag ${status}">${statusLabels[status]}</span>`
    : `<span class="status-tag ${locked ? 'draft' : completed ? 'completed' : attempts.length ? 'published' : 'published'}">${locked ? 'Bloqueado 🔒' : completed ? 'Concluído' : attempts.length ? 'Em andamento' : esc(exercise.difficulty || 'Prática')}</span>`;
  const avatars = currentProfile().role === 'teacher' && demoAttempts.length
    ? `<div class="demo-participant-strip"><span class="demo-avatars">${demoAttempts.slice(0, 5).map(attempt => `<span class="demo-avatar" title="${esc(attempt.profileName)}">${esc(attempt.profileName.slice(0, 1))}</span>`).join('')}</span><small>${demoAttempts.length} respostas · demonstração</small></div>`
    : '';
  const openAction = currentProfile().role === 'teacher' && status === 'draft' ? 'edit-exercise' : 'open-exercise';
  const openLabel = locked ? 'Aguarde a liberação 🔒' : status === 'draft' ? 'Continuar edição' : status === 'closed' || status === 'archived' ? 'Ver exercício' : 'Começar exercício';
  const lessonLinks = relatedLessons.length
    ? relatedLessons.map(lesson => lesson.accessLocked && currentProfile().role === 'student'
      ? `<span class="related-lesson-link locked">🔒 ${esc(lesson.title)}</span>`
      : `<button type="button" class="related-lesson-link" data-action="open-lesson" data-id="${esc(lesson.id)}">← Aula: ${esc(lesson.title)}</button>`).join('')
    : '<span>Sem aula relacionada</span>';
  const primaryType = exercise.questions?.[0]?.type || exercise.questionTypes?.[0];
  return `<article class="exercise-card${locked ? ' access-locked' : ''}${completed ? ' learning-completed' : ''}${currentProfile().role === 'teacher' && status === 'draft' ? ' exercise-card-draft' : ''}" data-exercise-id="${esc(exercise.id)}" data-created-at="${esc(exercise.updatedAt || exercise.createdAt || '')}"><div class="exercise-card-head"><span class="exercise-icon">${locked ? '🔒' : exercise.questions?.some(q => q.type === 'chord') ? '♬' : exercise.questions?.some(q => q.type === 'score') ? '𝄞' : '✓'}</span>${visibleStatus}</div><p class="exercise-type">${esc(types[primaryType] || 'Exercício')}</p><h3>${esc(title)}</h3><p>${esc(locked ? 'O professor ainda não liberou esta atividade para você.' : summary)}</p><div class="exercise-relations">${lessonLinks}</div>${avatars}<div class="card-meta"><span>${locked ? `${count || exercise.questionCount || 0} questões · Bloqueado` : `${count} ${count === 1 ? 'questão' : 'questões'}`}</span><span>${esc(exercise.difficulty || 'Geral')}</span></div><button type="button" class="button primary card-open" data-action="${openAction}" data-id="${esc(exercise.id)}" ${locked ? 'disabled' : ''}>${openLabel}${locked ? '' : ' <span aria-hidden="true">→</span>'}</button>${currentProfile().role === 'student' ? `<button type="button" class="button ${completed ? 'completed-progress-button' : 'secondary'} card-open progress-toggle" data-action="toggle-learning-progress" data-type="exercise" data-id="${esc(exercise.id)}" ${locked ? 'disabled' : ''}>${completed ? '✓ Concluída · Desmarcar' : 'Marcar atividade como concluída'}</button>` : ''}${currentProfile().role === 'teacher' ? `${status === 'draft' ? `<button type="button" class="button secondary card-open publish-draft-button" data-action="publish-exercise" data-id="${esc(exercise.id)}">Publicar exercício</button>` : ''}<button type="button" class="button secondary card-open results-card-button" data-action="show-exercise-results" data-id="${esc(exercise.id)}">Ver respostas e gráficos ↗</button><button type="button" class="button secondary card-open move-exercise-button" data-action="move-exercise" data-id="${esc(exercise.id)}">Mover para bloco ↗</button><div class="exercise-order-actions"><button type="button" data-action="exercise-order-up" data-id="${esc(exercise.id)}" aria-label="Mover exercício para cima">↑</button><button type="button" data-action="exercise-order-down" data-id="${esc(exercise.id)}" aria-label="Mover exercício para baixo">↓</button></div><button type="button" class="card-edit" data-action="edit-exercise" data-id="${esc(exercise.id)}" aria-label="Editar exercício ${esc(title)}">•••</button>` : ''}</article>`;
}

function exerciseBlockCard(block, count, unassigned = false) {
  const actionId = unassigned ? 'unassigned' : block.id;
  const locked = !unassigned && currentProfile().role === 'student' && block.accessLocked;
  return `<article class="exercise-block-card color-${esc(block?.color || 'blue')} decoration-${esc(block?.decoration || 'notes')}${locked ? ' access-locked' : ''}"><span class="exercise-block-icon">${locked ? '🔒' : unassigned ? '♫' : ({ notes: '♫', stars: '✦', petals: '❀', moon: '☾' }[block.decoration] || '♫')}</span><div class="exercise-block-copy"><p class="eyebrow">BLOCO DE EXERCÍCIOS</p><h2>${esc(block?.title || 'Exercícios sem bloco')}</h2><p>${esc(locked ? 'Algumas atividades deste bloco estão bloqueadas.' : block?.description || (unassigned ? 'Atividades antigas que ainda não foram organizadas.' : 'Atividades organizadas por conteúdo.'))}</p><small>${count} ${count === 1 ? 'exercício' : 'exercícios'}${locked ? ' · inclui atividades bloqueadas' : ''}</small></div><div class="exercise-block-actions"><button class="button primary small-button" type="button" data-action="open-exercise-block" data-id="${esc(actionId)}">${unassigned ? 'Organizar' : locked ? 'Ver atividades 🔒' : 'Abrir bloco'} →</button>${!unassigned && currentProfile().role === 'teacher' ? `<button class="card-edit" type="button" data-action="edit-exercise-block" data-id="${esc(block.id)}" aria-label="Editar bloco ${esc(block.title)}">•••</button>` : ''}</div></article>`;
}

function exercisePlaylistCard(playlist) {
  const entries = playlistSequenceEntries(playlist).filter(playlistEntryAvailable);
  const activityCount = entries.reduce((total, entry) => {
    if (entry.type === 'lesson' || entry.type === 'exercise') return total + 1;
    return total + visibleExercises().filter(exercise => exercise.exerciseBlockId === entry.contentId).length;
  }, 0);
  return `<article class="exercise-playlist-card" style="--playlist-color:${playlistColor(playlist.color)}" data-playlist-id="${esc(playlist.id)}"><button class="playlist-record-button" type="button" data-action="open-exercise-playlist" data-id="${esc(playlist.id)}" aria-label="Abrir playlist ${esc(playlist.title)}"><span class="playlist-record"><span class="playlist-record-center">${esc(playlist.symbol || '♫')}</span></span></button><div class="playlist-copy"><p class="eyebrow">PLAYLIST MUSICAL</p><h2>${esc(playlist.title)}</h2><p>${esc(playlist.description || 'Blocos e exercícios organizados para estudar.')}</p><small>${entries.length} ${entries.length === 1 ? 'conteúdo' : 'conteúdos'} · ${activityCount} ${activityCount === 1 ? 'atividade' : 'atividades'}</small><div class="playlist-actions"><button class="button primary small-button" type="button" data-action="open-exercise-playlist" data-id="${esc(playlist.id)}">Abrir playlist →</button>${currentProfile().role === 'teacher' ? `<button class="button secondary small-button" type="button" data-action="edit-exercise-playlist" data-id="${esc(playlist.id)}">Personalizar</button>` : ''}</div></div></article>`;
}

function renderHome() {
  const profile = currentProfile();
  const teacher = profile.role === 'teacher';
  const lessons = visibleLessons();
  const exercises = visibleExercises();
  const attempts = model.attempts.filter(item => item.profileName === profile.displayName);
  const actions = teacher
    ? `${button('＋ Criar bloco', 'new-block', 'primary')}${button('Criar exercício', 'new-exercise', 'secondary')}`
    : button('Ver exercícios', 'go-exercises', 'primary');
  const blockList = teacher ? model.blocks : [...new Set(lessons.map(lesson => lesson.blockId))].map(getBlock).filter(Boolean);
  const shownBlocks = blockList.slice(0, 3).map(blockCard).join('');
  const recentExercises = exercises.slice(0, 3).map(exerciseCard).join('');
  const catalogMarkup = catalogItems.map(item => `<article class="catalog-card"><span class="catalog-card-icon" aria-hidden="true">${esc(item.icon)}</span><div class="catalog-card-copy"><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><button class="button secondary small-button" type="button" data-action="${esc(item.action)}"${item.mediaId ? ` data-media-id="${esc(item.mediaId)}"` : ''}>${esc(item.actionLabel)} <span aria-hidden="true">→</span></button></div></article>`).join('');
  return `${pageHeading(teacher ? 'SEU ESTÚDIO DE APRENDIZAGEM' : 'SUA JORNADA MUSICAL', `Olá, ${profile.displayName.split(' ')[0] || 'músico'}`, teacher ? 'Organize conteúdos e prepare atividades no seu ritmo.' : 'Continue estudando música no seu próprio ritmo.', actions)}
    <section class="hero-panel"><div class="hero-copy"><p class="eyebrow">MÚSICA EM MOVIMENTO</p><h2>Aprender música é encontrar novas conexões.</h2><p>Suas aulas, exercícios e ferramentas de estudo em um só lugar.</p><button class="hero-action" type="button" data-action="${teacher ? 'go-lessons' : 'go-exercises'}">${teacher ? 'Explorar aulas' : 'Retomar meus estudos'} <span>→</span></button></div><div class="hero-art" aria-hidden="true"><span class="staff-lines"></span><span class="hero-note">♫</span><span class="hero-spark">✦</span></div></section>
    <section class="section-block"><div class="section-heading"><div><p class="eyebrow">CATÁLOGO</p><h2>Por onde você quer começar?</h2><p>Escolha uma área para continuar sua jornada musical.</p></div></div><div class="catalog-grid">${catalogMarkup}</div></section>
    <section class="stat-grid" aria-label="Resumo"><article class="stat-card"><span class="stat-icon">▤</span><span class="stat-label">${teacher ? 'Blocos de aulas' : 'Aulas disponíveis'}</span><strong>${teacher ? model.blocks.length : new Set(lessons.map(item => item.blockId)).size}</strong></article><article class="stat-card"><span class="stat-icon">♫</span><span class="stat-label">Aulas</span><strong>${lessons.length}</strong></article><article class="stat-card"><span class="stat-icon">✓</span><span class="stat-label">${teacher ? 'Exercícios publicados' : 'Exercícios disponíveis'}</span><strong>${exercises.length}</strong></article><article class="stat-card"><span class="stat-icon">◷</span><span class="stat-label">${teacher ? 'Respostas recebidas' : 'Atividades concluídas'}</span><strong>${teacher ? model.attempts.length : attempts.length}</strong></article></section>
    <section class="section-block"><div class="section-heading"><div><p class="eyebrow">${teacher ? 'CONTEÚDO' : 'SEU PERCURSO'}</p><h2>${teacher ? 'Seus blocos de aulas' : 'Continue sua trilha'}</h2><p>${teacher ? 'Organize seus conteúdos em unidades claras.' : 'Acesse as aulas que foram publicadas neste espaço.'}</p></div><button type="button" class="text-link" data-action="go-lessons">Ver todas <span>→</span></button></div>${shownBlocks ? `<div class="block-grid">${shownBlocks}</div>` : empty(teacher ? 'Você ainda não criou nenhuma aula.' : 'Sua trilha está vazia por enquanto.', teacher ? 'Comece organizando seus conteúdos musicais em blocos.' : 'Quando uma aula for publicada, ela aparecerá aqui.', teacher ? button('＋ Criar primeiro bloco', 'new-block', 'primary') : '', '𝄞')}</section>
    ${!teacher ? '' : `<section class="section-block"><div class="section-heading"><div><p class="eyebrow">PRÁTICA</p><h2>Exercícios recentes</h2><p>Atividades independentes ou relacionadas a uma aula.</p></div><button type="button" class="text-link" data-action="go-exercises">Abrir exercícios <span>→</span></button></div>${recentExercises ? `<div class="exercise-grid">${recentExercises}</div>` : empty('Crie seu primeiro exercício.', 'Prepare uma atividade musical para acompanhar suas aulas.', button('＋ Criar exercício', 'new-exercise', 'primary'), '♫')}</section>`}`;
}

function renderLessons() {
  const teacher = currentProfile().role === 'teacher';
  const actions = teacher ? button('＋ Criar bloco', 'new-block', 'primary') : '';
  if (selectedBlockId) {
    const block = getBlock(selectedBlockId);
    if (!block) { selectedBlockId = null; return renderLessons(); }
    const items = ordered(visibleLessons().filter(lesson => lesson.blockId === block.id)).map(lessonCard).join('');
    return `${pageHeading('AULAS', block.title, block.description || 'Aulas e materiais deste bloco de conteúdo.', `<button class="button secondary" type="button" data-action="back-blocks">← Todos os blocos</button>${teacher ? button('＋ Nova aula', 'new-lesson', 'primary') : ''}`)}
      <div class="block-banner"><span class="block-banner-icon">♫</span><div><strong>${esc(block.title)}</strong><small>${model.lessons.filter(lesson => lesson.blockId === block.id).length} aulas nesta unidade</small></div>${teacher ? button('Editar bloco', 'edit-block', 'secondary', `data-id="${esc(block.id)}"`) : ''}</div>
      ${items ? `<div class="lesson-grid">${items}</div>` : empty(teacher ? 'Este bloco ainda não tem aulas.' : 'Nenhuma aula publicada neste bloco.', teacher ? 'Adicione uma aula para começar a estruturar o conteúdo.' : 'Aulas não publicadas ficam ocultas para o estudante.', teacher ? button('＋ Criar primeira aula', 'new-lesson', 'primary') : '', '▤')}`;
  }
  const blocks = (teacher ? model.blocks : [...new Set(visibleLessons().map(lesson => lesson.blockId))].map(getBlock).filter(Boolean));
  const cards = blocks.map(blockCard).join('');
  return `${pageHeading(teacher ? 'ORGANIZAÇÃO DO CURSO' : 'CONTEÚDO DISPONÍVEL', 'Aulas', teacher ? 'Crie blocos e organize neles suas aulas.' : 'Explore as aulas publicadas pelo professor.', actions)}
    <div class="filter-row"><label class="search-control"><span>⌕</span><input id="lesson-search" type="search" placeholder="Buscar bloco ou aula..."></label><span class="result-count">${blocks.length} ${blocks.length === 1 ? 'bloco' : 'blocos'}</span></div>
    ${cards ? `<div class="block-grid" id="block-grid">${cards}</div>` : empty(teacher ? 'Você ainda não criou nenhuma aula.' : 'Nenhum conteúdo disponível.', teacher ? 'Comece organizando seus conteúdos musicais em blocos.' : 'Os blocos aparecerão aqui quando uma aula estiver publicada.', teacher ? button('＋ Criar bloco', 'new-block', 'primary') : '', '𝄞')}`;
}

function renderExercises() {
  const teacher = currentProfile().role === 'teacher';
  const exercises = visibleExercises();
  const kindOptions = Object.entries(types).map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
  const practiceRequest = !teacher
    ? `<section class="practice-request"><div><p class="eyebrow">PRÁTICA PERSONALIZADA</p><h2>Treinar por aula</h2><p>Monte uma lista aleatória com até 10 questões que já pertencem a uma aula.</p></div><label class="field-label">Escolha o conteúdo<select id="practice-lesson-select">${model.lessons.filter(lesson => lessonIsPublished(lesson) && !lesson.accessLocked).map(lesson => `<option value="${esc(lesson.id)}">${esc(lesson.title)}</option>`).join('')}</select></label><button class="button primary" type="button" data-action="request-practice-list" ${model.lessons.some(lesson => lessonIsPublished(lesson) && !lesson.accessLocked) ? '' : 'disabled'}>Montar lista</button></section>`
    : '';
  const filters = `<div class="filter-row exercise-filters"><label class="search-control"><span>⌕</span><input id="exercise-search" type="search" placeholder="Buscar exercício..."></label><select class="filter-select" id="exercise-type-filter" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>${kindOptions}</select><select class="filter-select" id="exercise-block-filter" aria-label="Filtrar por bloco"><option value="">Todos os blocos</option>${model.exerciseBlocks.map(block => `<option value="${esc(block.id)}">${esc(block.title)}</option>`).join('')}</select><select class="filter-select" id="exercise-difficulty-filter" aria-label="Filtrar por dificuldade"><option value="">Todas as dificuldades</option><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select><select class="filter-select" id="exercise-sort" aria-label="Ordenar"><option value="date">Mais recentes</option><option value="title">Título</option></select></div>`;
  if (selectedExerciseBlockId) {
    const selectedBlock = selectedExerciseBlockId === 'unassigned' ? null : getExerciseBlock(selectedExerciseBlockId);
    if (!selectedBlock && selectedExerciseBlockId !== 'unassigned') {
      selectedExerciseBlockId = null;
      return renderExercises();
    }
    const groupedExercises = exercises.filter(exercise => selectedExerciseBlockId === 'unassigned'
      ? !exercise.exerciseBlockId
      : exercise.exerciseBlockId === selectedExerciseBlockId);
    const parentPlaylist = selectedBlock?.playlistId ? model.playlists.find(item => item.id === selectedBlock.playlistId) : null;
    const title = selectedBlock?.title || 'Exercícios sem bloco';
    const actions = `${button('← Todos os blocos', 'back-exercise-blocks', 'secondary')}${selectedBlock && teacher ? button('Editar bloco', 'edit-exercise-block', 'secondary', `data-id="${esc(selectedBlock.id)}"`) : ''}${selectedBlock && teacher ? button('＋ Criar exercício', 'new-exercise', 'primary', `data-exercise-block-id="${esc(selectedBlock.id)}"`) : ''}`;
    return `${pageHeading(parentPlaylist ? `PLAYLIST · ${parentPlaylist.title}` : 'ATIVIDADES DO BLOCO', title, selectedBlock?.description || 'Atividades organizadas neste bloco.', actions)}${filters}${groupedExercises.length ? `<div class="exercise-grid" id="exercise-grid">${ordered(groupedExercises).map(exerciseCard).join('')}</div>` : empty(selectedBlock ? 'Este bloco ainda não tem exercícios.' : 'Organize estas atividades em um bloco.', selectedBlock ? 'Adicione exercícios para começar.' : 'Peça ao professor para organizar as atividades.', selectedBlock && teacher ? button('＋ Criar exercício', 'new-exercise', 'primary', `data-exercise-block-id="${esc(selectedBlock.id)}"`) : '', '♫')}`;
  }
  const blockCards = model.exerciseBlocks.map(block => exerciseBlockCard(block,
    exercises.filter(exercise => exercise.exerciseBlockId === block.id).length));
  const unassigned = exercises.filter(exercise => !exercise.exerciseBlockId);
  if (unassigned.length) blockCards.push(exerciseBlockCard(null, unassigned.length, true));
  const actions = teacher ? button('＋ Criar bloco', 'new-exercise-block', 'primary') : '';
  return `${pageHeading('PRÁTICA MUSICAL', teacher ? 'Blocos de exercícios' : 'Exercícios', teacher ? 'Organize suas atividades em blocos, como antes.' : 'Escolha um bloco para continuar sua prática musical.', actions)}${practiceRequest}${blockCards.length ? `<div class="exercise-block-grid">${blockCards.join('')}</div>` : empty(teacher ? 'Crie seu primeiro bloco de exercícios.' : 'Ainda não há blocos de exercícios.', teacher ? 'Acesse Playlists para montar uma sequência de estudo com seus blocos.' : 'O professor ainda está organizando os exercícios.', teacher ? button('＋ Criar bloco', 'new-exercise-block', 'primary') : '', '♫')}`;
}

function playlistEntryAvailable(entry) {
  if (currentProfile().role === 'teacher') return true;
  if (entry.type === 'lesson') return visibleLessons().some(lesson => lesson.id === entry.contentId);
  if (entry.type === 'exercise') return visibleExercises().some(exercise => exercise.id === entry.contentId);
  const block = getExerciseBlock(entry.contentId);
  return Boolean(block && (visibleExercises().some(exercise => exercise.exerciseBlockId === block.id) || block.accessLocked === true));
}

function playlistSequenceEntries(playlist) {
  const entries = Array.isArray(playlist.entries) ? playlist.entries.filter(entry =>
    entry && ['lesson', 'exerciseBlock', 'exercise'].includes(entry.type)
      && (entry.type === 'lesson' ? getLesson(entry.contentId)
        : entry.type === 'exercise' ? getExercise(entry.contentId)
        : getExerciseBlock(entry.contentId))) : [];
  const referencedBlocks = new Set(entries.filter(entry => entry.type === 'exerciseBlock').map(entry => entry.contentId));
  const legacyBlocks = model.exerciseBlocks
    .filter(block => block.playlistId === playlist.id && !referencedBlocks.has(block.id))
    .map(block => ({ id: `legacy-${block.id}`, type: 'exerciseBlock', contentId: block.id, dividerText: 'Próxima etapa' }));
  return [...entries, ...legacyBlocks];
}

function ensurePlaylistEntries(playlist) {
  if (!Array.isArray(playlist.entries)) playlist.entries = [];
  const referencedBlocks = new Set(playlist.entries
    .filter(entry => entry.type === 'exerciseBlock').map(entry => entry.contentId));
  for (const block of model.exerciseBlocks) {
    if (block.playlistId === playlist.id && !referencedBlocks.has(block.id)) {
      playlist.entries.push({
        id: `legacy-${block.id}`,
        type: 'exerciseBlock',
        contentId: block.id,
        dividerText: 'Próxima etapa'
      });
    }
  }
  return playlist.entries;
}

function openPlaylistEntryEditor(type) {
  const playlist = model.playlists.find(item => item.id === selectedExercisePlaylistId);
  if (!playlist || !['lesson', 'exerciseBlock', 'exercise'].includes(type)) return;
  const entries = playlistSequenceEntries(playlist);
  const used = new Set(entries.filter(entry => entry.type === type).map(entry => entry.contentId));
  const items = type === 'lesson'
    ? model.lessons.filter(lesson => currentProfile().role === 'teacher' || lessonIsPublished(lesson))
      .filter(lesson => !used.has(lesson.id))
      .map(lesson => ({ id: lesson.id, title: lesson.title, group: getBlock(lesson.blockId)?.title || 'Aula independente' }))
    : type === 'exercise'
      ? model.exercises.filter(exercise => !exercise.assessment && !used.has(exercise.id))
        .map(exercise => ({ id: exercise.id, title: exercise.title || 'Exercício sem título', group: getExerciseBlock(exercise.exerciseBlockId)?.title || 'Sem bloco' }))
      : model.exerciseBlocks.filter(block => !used.has(block.id))
        .map(block => ({ id: block.id, title: block.title, group: 'Bloco de exercícios' }));
  if (!items.length) {
    toast(type === 'lesson' ? 'Não há aulas disponíveis para adicionar.' : type === 'exercise' ? 'Não há exercícios disponíveis para adicionar.' : 'Não há blocos de exercícios disponíveis para adicionar.', 'error');
    return;
  }
  const label = type === 'lesson' ? 'aula' : type === 'exercise' ? 'exercício' : 'bloco de exercícios';
  const dialog = openDialog(`<p class="eyebrow">SEQUÊNCIA DA PLAYLIST</p><h2>Adicionar ${label}</h2><p class="dialog-intro">O conteúdo será apenas relacionado à playlist; o item original não será alterado.</p><form id="playlist-entry-form" class="stack-form"><label class="field-label">Escolha o conteúdo<select name="contentId" required>${items.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · ${esc(item.group)}</option>`).join('')}</select></label><div class="dialog-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancelar</button><button class="button primary" type="submit">Adicionar à playlist</button></div></form>`);
  dialog.querySelector('#playlist-entry-form').addEventListener('submit', event => {
    event.preventDefault();
    const contentId = String(new FormData(event.currentTarget).get('contentId') || '');
    if (!items.some(item => item.id === contentId)) {
      showDialogNotice(dialog, 'Escolha um conteúdo disponível.');
      return;
    }
    const playlistEntries = ensurePlaylistEntries(playlist);
    playlistEntries.push({
      id: createId(),
      type,
      contentId,
      dividerText: 'Próxima etapa'
    });
    dialog.close();
    persist('Conteúdo adicionado à sequência.');
  });
}

function openPlaylistDividerEditor(entryId) {
  const playlist = model.playlists.find(item => item.id === selectedExercisePlaylistId);
  if (!playlist) return;
  const entry = ensurePlaylistEntries(playlist).find(item => item.id === entryId);
  if (!entry) return;
  const dialog = openDialog(`<p class="eyebrow">SEPARADOR MUSICAL</p><h2>Editar texto do separador</h2><form id="playlist-divider-form" class="stack-form"><label class="field-label">Texto entre os conteúdos<input name="dividerText" maxlength="60" value="${esc(entry.dividerText || 'Próxima etapa')}" placeholder="Ex.: Ouça e pratique"></label><div class="dialog-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancelar</button><button class="button primary" type="submit">Salvar separador</button></div></form>`);
  dialog.querySelector('#playlist-divider-form').addEventListener('submit', event => {
    event.preventDefault();
    entry.dividerText = String(new FormData(event.currentTarget).get('dividerText') || '').trim() || 'Próxima etapa';
    dialog.close();
    persist('Separador atualizado.');
  });
}

function renderPlaylistEntry(entry, index) {
  const teacher = currentProfile().role === 'teacher';
  const divider = index === 0 ? '' : `<div class="playlist-music-divider"><span class="music-divider-line" aria-hidden="true">♫ ─── ♬ ─── ♫</span><span class="music-divider-label">${esc(entry.dividerText || 'Próxima etapa')}</span>${teacher ? button('Editar separador', 'edit-playlist-divider', 'secondary small-button', `data-entry-id="${esc(entry.id)}"`) : ''}</div>`;
  if (entry.type === 'lesson') {
    const lesson = getLesson(entry.contentId);
    if (!lesson || (currentProfile().role !== 'teacher' && !visibleLessons().includes(lesson))) return '';
    const block = getBlock(lesson.blockId);
    return `${divider}<section class="playlist-sequence-entry"><p class="eyebrow">BLOCO DE AULA · ${esc(block?.title || 'Aula')}</p>${lessonCard(lesson)}${teacher ? `<div class="playlist-entry-actions">${button('↑', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="-1" aria-label="Mover item para cima"`)}${button('↓', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="1" aria-label="Mover item para baixo"`)}${button('Remover da playlist', 'remove-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}"`)}</div>` : ''}</section>`;
  }
  if (entry.type === 'exercise') {
    const exercise = getExercise(entry.contentId);
    if (!exercise || (!teacher && !visibleExercises().includes(exercise))) return '';
    const parent = getExerciseBlock(exercise.exerciseBlockId);
    return `${divider}<section class="playlist-sequence-entry"><p class="eyebrow">EXERCÍCIO${parent ? ' · ' + esc(parent.title) : ''}</p>${exerciseCard(exercise)}${teacher ? `<div class="playlist-entry-actions">${button('↑', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="-1" aria-label="Mover item para cima"`)}${button('↓', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="1" aria-label="Mover item para baixo"`)}${button('Remover da playlist', 'remove-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}"`)}</div>` : ''}</section>`;
  }
  const block = getExerciseBlock(entry.contentId);
  if (!block) return '';
  const visibleCount = visibleExercises().filter(exercise => exercise.exerciseBlockId === block.id).length;
  if (currentProfile().role !== 'teacher' && !visibleCount && block.accessLocked !== true) return '';
  return `${divider}<section class="playlist-sequence-entry"><p class="eyebrow">BLOCO DE EXERCÍCIOS</p><div class="exercise-block-grid">${exerciseBlockCard(block, visibleCount)}</div>${teacher ? `<div class="playlist-entry-actions">${button('↑', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="-1" aria-label="Mover item para cima"`)}${button('↓', 'move-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}" data-direction="1" aria-label="Mover item para baixo"`)}${button('Remover da playlist', 'remove-playlist-entry', 'secondary small-button', `data-entry-id="${esc(entry.id)}"`)}</div>` : ''}</section>`;
}

function renderPlaylists() {
  const teacher = currentProfile().role === 'teacher';
  if (!selectedExercisePlaylistId) {
    const playlists = ordered(model.playlists).map(exercisePlaylistCard).join('');
    const actions = teacher ? button('＋ Criar playlist', 'new-exercise-playlist', 'primary') : '';
    return `${pageHeading('ORGANIZAÇÃO MUSICAL', 'Playlists', teacher ? 'Crie sequências de aulas e exercícios para seus alunos.' : 'Escolha uma playlist e continue sua jornada musical.', actions)}${playlists ? `<section class="playlist-grid">${playlists}</section>` : empty(teacher ? 'Crie sua primeira playlist.' : 'Ainda não há playlists disponíveis.', teacher ? 'Adicione aulas e blocos de exercícios em uma sequência vertical.' : 'O professor ainda está organizando as playlists.', teacher ? button('＋ Criar playlist', 'new-exercise-playlist', 'primary') : '', '♫')}`;
  }
  const playlist = model.playlists.find(item => item.id === selectedExercisePlaylistId);
  if (!playlist) {
    selectedExercisePlaylistId = null;
    return renderPlaylists();
  }
  const entries = playlistSequenceEntries(playlist);
  const actions = `${button('← Todas as playlists', 'back-exercise-playlists', 'secondary')}${teacher ? button('＋ Adicionar aula', 'add-playlist-entry', 'secondary', 'data-entry-type="lesson"') : ''}${teacher ? button('＋ Adicionar exercício', 'add-playlist-entry', 'secondary', 'data-entry-type="exercise"') : ''}${teacher ? button('＋ Adicionar bloco de exercícios', 'add-playlist-entry', 'primary', 'data-entry-type="exerciseBlock"') : ''}${teacher ? button('Personalizar', 'edit-exercise-playlist', 'secondary', `data-id="${esc(playlist.id)}"`) : ''}`;
  const availableEntries = entries.filter(playlistEntryAvailable);
  const sequence = availableEntries.map(renderPlaylistEntry).filter(Boolean).join('');
  const emptySequence = teacher ? `<section class="empty-state"><span class="empty-glyph">♫</span><h2>Comece sua sequência</h2><p>Adicione uma aula, um exercício ou um bloco de exercícios. Os originais continuam intactos.</p><div class="playlist-empty-actions">${button('＋ Adicionar aula', 'add-playlist-entry', 'secondary', 'data-entry-type="lesson"')}${button('＋ Adicionar exercício', 'add-playlist-entry', 'secondary', 'data-entry-type="exercise"')}${button('＋ Adicionar bloco de exercícios', 'add-playlist-entry', 'primary', 'data-entry-type="exerciseBlock"')}</div></section>` : empty('Esta playlist ainda não tem conteúdos.', 'O professor ainda está montando a sequência.', '', '♫');
  return `<header class="playlist-sequence-heading" style="--playlist-color:${playlistColor(playlist.color)}"><p class="eyebrow">PLAYLIST MUSICAL</p><h1>${esc(playlist.title)}</h1><p>${esc(playlist.description || 'Uma sequência musical para aprender passo a passo.')}</p><span class="playlist-title-symbol" aria-hidden="true">${esc(playlist.symbol || '♫')}</span>${actions.length ? `<div class="page-actions">${actions}</div>` : ''}</header><div class="playlist-sequence-content" style="--playlist-color:${playlistColor(playlist.color)}"><div class="playlist-opening-divider" aria-hidden="true">♬ ━━━━━━━━━ ♫ ━━━━━━━━━ ♬</div>${sequence || emptySequence}</div>`;
}

function renderLearningHistory() {
  const entries = learningProgress.map(progress => {
    const item = progress.contentType === 'lesson'
      ? getLesson(progress.contentId)
      : getExercise(progress.contentId);
    if (!item) return null;
    return { ...progress, title: item.title || 'Atividade', typeLabel: progress.contentType === 'lesson' ? 'Aula' : 'Exercício' };
  }).filter(Boolean).sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  const list = entries.map(item => `<article class="learning-history-card"><span class="learning-history-check">✓</span><div><p class="eyebrow">${item.typeLabel} · CONCLUÍDA</p><h2>${esc(item.title)}</h2><small>${new Date(item.completedAt).toLocaleString('pt-BR')}</small></div><button class="button secondary small-button" type="button" data-action="open-history-content" data-type="${item.contentType}" data-id="${esc(item.contentId)}">Abrir ${item.contentType === 'lesson' ? 'aula' : 'exercício'} →</button></article>`).join('');
  return `${pageHeading('SEU PROGRESSO', 'Meu histórico', 'Aulas assistidas e atividades que você marcou como concluídas.', '')}${list ? `<div class="learning-history-list">${list}</div>` : empty('Seu histórico ainda está vazio.', 'Marque uma aula ou atividade como concluída para encontrá-la aqui.', button('Ver playlists', 'go-exercises', 'primary'), '✓')}`;
}

async function requestPracticeList() {
  const lessonId = root.querySelector('#practice-lesson-select')?.value;
  const lesson = getLesson(lessonId);
  if (!lesson) { toast('Escolha uma aula publicada para montar a lista.', 'error'); return; }
  try {
    let exercise;
    if (accountSession?.role === 'student') {
      const result = await accountRequest('/api/practice/request', {
        method: 'POST', body: JSON.stringify({ lessonId })
      });
      exercise = result.exercise;
    } else {
      const pool = model.exercises.filter(item => item.published && !item.assessment && !item.personalizedFor
        && (item.lessonIds || []).includes(lessonId))
        .flatMap(item => item.questions.map(question => ({
          ...question, sourceExerciseId: item.id, sourceExerciseTitle: item.title,
          sourceLessonId: lesson.id, sourceLessonTitle: lesson.title, sourceBlockId: lesson.blockId
        })))
        .sort(() => Math.random() - 0.5).slice(0, 10);
      if (!pool.length) throw new Error('Esta aula ainda não tem questões publicadas relacionadas.');
      exercise = {
        id: createId(), title: `Prática · ${lesson.title}`,
        instructions: `Lista personalizada com questões de ${lesson.title}.`,
        difficulty: 'Geral', status: 'published', published: true, showAnswers: false,
        lessonIds: [], questions: pool.map(question => ({ ...question, id: createId() })),
        personalizedFor: currentProfile().displayName, sourceLessonId: lesson.id,
        createdAt: new Date().toISOString()
      };
    }
    model.exercises.push(exercise);
    model = saveModel(model);
    activeExerciseId = exercise.id;
    navigate('exercicio');
    toast(`Sua lista ficou pronta com ${exercise.questions.length} questão(ões).`);
  } catch (error) { toast(error.message, 'error'); }
}

function renderNotifications() {
  if (!accountSession) {
    return `${pageHeading('ATIVIDADE DA TURMA', 'Notificações', 'Acompanhe respostas, conteúdos publicados e atualizações da trilha.', '')}${empty('Entre na conta online para receber notificações.', 'Os avisos entre professor e alunos ficam disponíveis quando o servidor do Notarium está ativo.', button('Entrar ou criar conta', 'account-login', 'primary'), '♧')}`;
  }
  const unread = notificationsCache.filter(item => !item.readAt).length;
  const cards = notificationsCache.map(item => `<article class="notification-card${item.readAt ? '' : ' unread'}"><span class="notification-mark">${item.type === 'response-submitted' ? '♫' : item.type === 'response-reviewed' ? '✓' : '✦'}</span><div class="notification-copy"><p class="eyebrow">${item.readAt ? 'NOTIFICAÇÃO' : 'NOVA'}</p><h2>${esc(item.title)}</h2><p>${esc(item.message)}</p><small>${new Date(item.createdAt).toLocaleString('pt-BR')}</small></div><button class="button secondary small-button" type="button" data-action="open-notification" data-id="${esc(item.id)}">${item.type === 'response-submitted' ? 'Ver resposta' : item.type === 'response-reviewed' ? 'Ver atividade' : item.type === 'exam-released' ? 'Fazer prova' : item.type === 'exam-reopen-request' ? 'Analisar pedido' : 'Abrir'}</button></article>`).join('');
  return `${pageHeading('ATIVIDADE DA TURMA', 'Notificações', `${unread} não lida(s) · avisos pessoais e da turma.`, '')}${cards ? `<div class="notification-list">${cards}</div>` : empty('Tudo em dia por aqui.', 'Novas respostas e conteúdos aparecerão nesta lista.', '', '✦')}`;
}

function renderAssessments() {
  const teacher = currentProfile().role === 'teacher';
  const assessments = model.exercises.filter(item => item.assessment);
  const cards = assessments.map(exercise => {
    const releaseAt = Date.parse(exercise.assessment.releaseAt || '');
    const deadlineAt = Date.parse(exercise.assessment.deadlineAt || '');
    const scheduled = Number.isFinite(releaseAt) && releaseAt > Date.now();
    const expired = Number.isFinite(deadlineAt) && deadlineAt > 0 && deadlineAt <= Date.now();
    const closed = ['closed', 'archived'].includes(exercise.status);
    const lockedForStudent = currentProfile().role === 'student' && exercise.accessLocked;
    const released = exercise.published && !scheduled && !expired && !closed && !lockedForStudent;
    const state = lockedForStudent ? 'Bloqueada' : !exercise.published ? 'Rascunho' : closed || expired ? 'Encerrada' : scheduled ? 'Agendada' : 'Liberada';
    const lock = released ? '◇' : '◆';
    return `<article class="assessment-card ${released ? 'released' : 'locked'}"><div class="assessment-lock">${lock}</div><div class="assessment-copy"><div class="card-tags"><span class="status-tag ${released ? 'published' : 'draft'}">${state}</span></div><h2>${esc(exercise.title)}</h2><p>${esc(lockedForStudent ? 'O professor ainda não liberou esta avaliação para você.' : exercise.instructions || 'Avaliação musical')}</p><div class="card-meta"><span>${exercise.assessment.durationMinutes} min</span><span>${exercise.questionCount || exercise.questions.length} questões</span></div>${exercise.assessment.deadlineAt ? `<small>Prazo até ${new Date(exercise.assessment.deadlineAt).toLocaleString('pt-BR')}</small>` : ''}</div>${teacher ? button('Editar avaliação', 'edit-exercise', 'secondary', `data-id="${esc(exercise.id)}"`) : released ? button('Abrir avaliação', 'open-exercise', 'primary', `data-id="${esc(exercise.id)}"`) : '<span class="assessment-locked-label">Aguarde a liberação 🔒</span>'}</article>`;
  }).join('');
  return `${pageHeading('PROVAS E AVALIAÇÕES', 'Avaliações', teacher ? 'Prepare provas com prazo, tempo e liberação controlada.' : 'Acompanhe as provas liberadas pelo professor.', teacher ? button('＋ Criar avaliação', 'new-assessment', 'primary') : '')}${cards ? `<div class="assessment-list">${cards}</div>` : empty('Nenhuma avaliação cadastrada.', teacher ? 'Crie uma prova usando o construtor de questões.' : 'As avaliações aparecerão aqui quando forem publicadas.', teacher ? button('＋ Criar avaliação', 'new-assessment', 'primary') : '', '◆')}`;
}

function renderAssessmentCountdown() {
  const exercise = getExercise(assessmentAccess?.examId);
  return `<main class="assessment-countdown"><span class="assessment-countdown-lock">◇</span><p class="eyebrow">AVALIAÇÃO · ${esc(exercise?.title || 'PROVA')}</p><h1>Boa sorte!</h1><p>Respire fundo. A prova começa em</p><strong>${assessmentCountdownValue}</strong><p>Você terá ${Number(exercise?.assessment?.durationMinutes) || 30} minutos para responder.</p></main>`;
}

function renderAssessmentLocked() {
  const exercise = getExercise(assessmentAccess?.examId);
  return `<main class="assessment-locked-page"><section><span class="assessment-countdown-lock">◆</span><p class="eyebrow">AVALIAÇÃO TRANCADA</p><h1>${esc(exercise?.title || 'Prova')}</h1><p>O acesso foi interrompido por mais de 3 minutos. Explique o motivo para solicitar a reabertura ao professor.</p><form id="exam-reopen-form" class="stack-form"><label class="field-label">Motivo<textarea id="exam-reopen-reason" rows="4" maxlength="500" required minlength="5" placeholder="Conte brevemente o que aconteceu"></textarea></label><button class="button primary" type="submit">Solicitar reabertura</button></form></section></main>`;
}

async function openAssessment(id) {
  const teacher = currentProfile().role === 'teacher';
  const exercise = getExercise(id);
  if (!exercise?.assessment) return;
  if (teacher) { activeExerciseId = id; navigate('exercicio'); return; }
  if (exercise.accessLocked) {
    toast('O professor ainda não liberou esta avaliação para você.', 'error');
    return;
  }
  try {
    let response = { exercise, session: null, locked: false };
    if (accountSession?.role === 'student') {
      response = await accountRequest(`/api/exams/${encodeURIComponent(id)}/open`, { method: 'POST', body: '{}' });
    }
    if (response.notReleased) {
      toast(`Esta avaliação será liberada em ${new Date(response.releaseAt).toLocaleString('pt-BR')}.`, 'error');
      return;
    }
    if (response.locked) {
      assessmentAccess = { examId: id, session: response.session, locked: true };
      view = 'assessment-locked';
      render();
      return;
    }
    assessmentAccess = { examId: id, exercise: response.exercise, session: response.session, locked: false };
    view = 'assessment-countdown';
    assessmentCountdownValue = 10;
    render();
    await new Promise(resolve => {
      assessmentClockTimer = setInterval(() => {
        assessmentCountdownValue -= 1;
        if (assessmentCountdownValue <= 0) {
          clearInterval(assessmentClockTimer);
          resolve();
        } else render();
      }, 1000);
    });
    if (accountSession?.role === 'student') {
      const started = await accountRequest(`/api/exams/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' });
      assessmentAccess.session = started.session;
      assessmentHeartbeatTimer = setInterval(() => accountRequest(`/api/exams/${encodeURIComponent(id)}/heartbeat`, {
        method: 'POST', body: '{}'
      }).catch(() => {
        clearInterval(assessmentHeartbeatTimer);
        assessmentAccess.locked = true;
        navigate('avaliacoes');
      }), 20_000);
    } else {
      assessmentAccess.session = { startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
    }
    const securedExercise = response.exercise;
    model.exercises = model.exercises.filter(item => item.id !== id).concat(securedExercise);
    activeExerciseId = id;
    navigate('exercicio');
    startAssessmentClock(securedExercise);
  } catch (error) { toast(error.message, 'error'); }
}

function openExamReopenRequest(notification) {
  const dialog = openDialog(`<p class="eyebrow">SOLICITAÇÃO DE ALUNO</p><h2>Reabrir avaliação?</h2><p class="dialog-intro">${esc(notification.studentName)} · ${esc(notification.examTitle)}</p><p>${esc(notification.reason || notification.message)}</p><div class="dialog-actions">${button('Liberar novamente', 'unlock-exam', 'primary', `data-exam-id="${esc(notification.examId)}" data-student-id="${esc(notification.studentId)}"`)}${button('Manter bloqueada', 'close-dialog', 'secondary')}</div>`);
  return dialog;
}

function startAssessmentClock(exercise) {
  clearInterval(assessmentClockTimer);
  const durationSeconds = Math.max(1, Number(exercise.assessment?.durationMinutes) || 30) * 60;
  const startedAt = Date.parse(assessmentAccess?.session?.startedAt || '');
  const update = () => {
    const remaining = Math.max(0, durationSeconds - Math.floor((Date.now() - startedAt) / 1000));
    const timer = root.querySelector('[data-assessment-clock]');
    if (timer) timer.textContent = formatDuration(remaining);
    if (!remaining) {
      clearInterval(assessmentClockTimer);
      const submit = root.querySelector('#exercise-attempt [type="submit"]');
      if (submit) submit.disabled = true;
      toast('O tempo desta avaliação terminou.', 'error');
    }
  };
  update();
  assessmentClockTimer = setInterval(update, 1000);
}

async function requestExamReopen(id) {
  const reason = root.querySelector('#exam-reopen-reason')?.value.trim() || '';
  try {
    await accountRequest(`/api/exams/${encodeURIComponent(id)}/request-reopen`, {
      method: 'POST', body: JSON.stringify({ reason })
    });
    await refreshNotifications(false);
    render();
    toast('Solicitação enviada. Aguarde o professor liberar a avaliação.');
  } catch (error) { toast(error.message, 'error'); }
}

document.addEventListener('visibilitychange', async () => {
  if (view !== 'exercicio' || !accountSession || !getExercise(activeExerciseId)?.assessment) return;
  if (document.hidden) {
    clearInterval(assessmentHeartbeatTimer);
    return;
  }
  try {
    const result = await accountRequest(`/api/exams/${encodeURIComponent(activeExerciseId)}/open`, { method: 'POST', body: '{}' });
    if (result.locked) {
      assessmentAccess = { examId: activeExerciseId, session: result.session, locked: true };
      view = 'assessment-locked';
      render();
      return;
    }
    assessmentAccess.session = result.session || assessmentAccess.session;
    clearInterval(assessmentHeartbeatTimer);
    assessmentHeartbeatTimer = setInterval(() => accountRequest(`/api/exams/${encodeURIComponent(activeExerciseId)}/heartbeat`, {
      method: 'POST', body: '{}'
    }).catch(() => {
      clearInterval(assessmentHeartbeatTimer);
      assessmentAccess.locked = true;
      view = 'assessment-locked';
      render();
    }), 20_000);
  } catch (error) { toast(error.message, 'error'); }
});

function markdownList(value, orderedList) {
  const lines = String(value || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const items = lines.map(line => `<li>${text(line.replace(/^[-*•]\s*/, ''))}</li>`).join('');
  return `<${orderedList ? 'ol' : 'ul'}>${items}</${orderedList ? 'ol' : 'ul'}>`;
}

function uploadedMediaMarkup(mediaId, name, type, title = '', alt = '', frequency = '') {
  if (!mediaId) return '';
  return `<div class="uploaded-media" data-media-id="${esc(mediaId)}" data-media-type="${esc(type || '')}" data-media-name="${esc(name || 'material')}" data-media-title="${esc(title)}" data-media-alt="${esc(alt)}" data-media-frequency="${esc(frequency)}"><span class="media-loading">Carregando ${esc(name || 'material')}…</span></div>`;
}

function mediaMarkup(url, type, name, title = '', alt = '', frequency = '') {
  const label = title || name;
  if (type.startsWith('image/')) return `<figure class="lesson-image"><button class="media-preview-trigger" type="button" data-action="open-media-viewer" data-viewer-url="${esc(url)}" data-viewer-type="${esc(type)}" data-viewer-name="${esc(label || name)}" aria-label="Ampliar ${esc(label || name)}"><img src="${esc(url)}" alt="${esc(alt || label)}" loading="lazy"></button>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
  if (type.startsWith('audio/')) return `<figure class="audio-block"><div class="audio-block-heading"><figcaption>${esc(label || 'Exemplo sonoro')}</figcaption>${frequency ? `<span class="frequency-badge">Frequência · ${esc(frequency)} Hz</span>` : ''}</div><audio controls preload="none" src="${esc(url)}">Seu navegador não suporta áudio.</audio><button class="button secondary small-button audio-stop-button" type="button" data-action="stop-audio" aria-label="Parar áudio">■ Parar</button><a class="media-download" href="${esc(url)}" download="${esc(name)}">Baixar áudio</a></figure>`;
  if (type.startsWith('video/')) return `<figure class="uploaded-video"><video controls preload="metadata" src="${esc(url)}">Seu navegador não suporta vídeo.</video>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}<a class="media-download" href="${esc(url)}" download="${esc(name)}">Baixar vídeo</a></figure>`;
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return `<div class="uploaded-pdf"><div class="uploaded-pdf-head"><strong>PDF · ${esc(label || name)}</strong><button class="button secondary small-button" type="button" data-action="open-media-viewer" data-viewer-url="${esc(url)}" data-viewer-type="application/pdf" data-viewer-name="${esc(label || name)}">Ampliar / tela cheia</button><a class="button secondary small-button" href="${esc(url)}" download="${esc(name)}">Baixar</a></div><iframe src="${esc(url)}" title="${esc(label || name)}" loading="lazy"></iframe></div>`;
  if (type.startsWith('text/') || type === 'application/xml') return `<div class="uploaded-pdf"><div class="uploaded-pdf-head"><strong>${esc(label || name)}</strong><button class="button secondary small-button" type="button" data-action="open-media-viewer" data-viewer-url="${esc(url)}" data-viewer-type="${esc(type)}" data-viewer-name="${esc(label || name)}">Ampliar / tela cheia</button><a class="button secondary small-button" href="${esc(url)}" download="${esc(name)}">Baixar</a></div><iframe src="${esc(url)}" title="${esc(label || name)}" loading="lazy"></iframe></div>`;
  return `<button class="resource-link media-file-preview" type="button" data-action="open-media-viewer" data-viewer-url="${esc(url)}" data-viewer-type="${esc(type)}" data-viewer-name="${esc(label || name)}"><span>▣</span>${esc(label || name)} <span>Visualizar</span></button>`;
}

async function hydrateMedia(container) {
  for (const element of container.querySelectorAll('[data-media-id]')) {
    try {
      const url = await getAccountMediaUrl(element.dataset.mediaId);
      if (!element.isConnected) continue;
      element.innerHTML = mediaMarkup(url, element.dataset.mediaType || '', element.dataset.mediaName || 'material', element.dataset.mediaTitle || '', element.dataset.mediaAlt || '', element.dataset.mediaFrequency || '');
    } catch (error) {
      if (element.isConnected) element.innerHTML = `<span class="media-missing">${esc(error.message)}</span>`;
    }
  }
}

function openMediaViewer(url, type, name) {
  const isImage = type.startsWith('image/');
  const preview = isImage
    ? `<div class="media-viewer-canvas"><img class="media-viewer-image" src="${esc(url)}" alt="${esc(name)}" draggable="false"></div><div class="media-viewer-tools"><button class="button secondary" type="button" data-action="media-zoom-out" aria-label="Reduzir">−</button><button class="button secondary" type="button" data-action="media-zoom-reset">Ajustar</button><button class="button secondary" type="button" data-action="media-zoom-in" aria-label="Ampliar">＋</button></div>`
    : type === 'application/pdf' || type.startsWith('text/') || type === 'application/xml' || /\.pdf$/i.test(name)
      ? `<iframe class="media-viewer-frame" src="${esc(url)}" title="${esc(name)}"></iframe>`
      : `<div class="media-viewer-download"><span aria-hidden="true">▣</span><strong>${esc(name)}</strong><p>Este tipo de arquivo não pode ser exibido neste navegador.</p><a class="button primary" href="${esc(url)}" download="${esc(name)}">Baixar arquivo</a></div>`;
  const dialog = openDialog(`<div class="media-viewer-header"><h2>${esc(name)}</h2><button class="button secondary" type="button" data-action="toggle-media-fullscreen">Tela cheia</button></div><div class="media-viewer-content">${preview}</div>`, 'media-viewer-modal');
  dialog.dataset.viewerScale = '1';
  const image = dialog.querySelector('.media-viewer-image');
  if (image) {
    let drag = null;
    image.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY, left: image.offsetLeft, top: image.offsetTop };
      image.setPointerCapture(event.pointerId);
      image.classList.add('is-dragging');
    });
    image.addEventListener('pointermove', event => {
      if (!drag) return;
      image.style.left = `${drag.left + event.clientX - drag.x}px`;
      image.style.top = `${drag.top + event.clientY - drag.y}px`;
    });
    const stopDrag = () => { drag = null; image.classList.remove('is-dragging'); };
    image.addEventListener('pointerup', stopDrag);
    image.addEventListener('pointercancel', stopDrag);
    dialog.querySelector('.media-viewer-canvas').addEventListener('wheel', event => {
      event.preventDefault();
      setViewerScale(dialog, (Number(dialog.dataset.viewerScale) || 1) * (event.deltaY < 0 ? 1.15 : 0.87));
    }, { passive: false });
  }
}

function setViewerScale(dialog, scale) {
  if (!dialog) return;
  const image = dialog.querySelector('.media-viewer-image');
  if (!image) return;
  const next = Math.min(5, Math.max(0.5, scale));
  dialog.dataset.viewerScale = String(next);
  image.style.transform = `translate(-50%, -50%) scale(${next})`;
}

function renderContentBlock(block) {
  const url = safeUrl(block.url || '');
  const alignment = ['left', 'center', 'right', 'justify'].includes(block.align) ? block.align : 'left';
  if (isMediaBlock(block) && block.mediaSource === 'upload' && block.mediaId) {
    return uploadedMediaMarkup(block.mediaId, block.mediaName, block.mediaType, block.title, block.alt);
  }
  if (block.type === 'heading') return `<h2 class="lesson-content-heading" style="text-align:${alignment}">${esc(block.text || 'Seção')}</h2>`;
  if (block.type === 'list') return `<div style="text-align:${alignment}">${markdownList(block.text, block.ordered)}</div>`;
  if (block.type === 'postit') {
    const position = block.position === 'left' ? 'left' : 'right';
    return `<aside class="lesson-postit lesson-postit-${position}"><strong>Post-it</strong><p>${richTextMarkup(block.text || '')}</p></aside>`;
  }
  if (block.type === 'tip' || block.type === 'example' || block.type === 'warning') {
    const accent = /^#[\da-f]{6}$/i.test(block.accentColor || '') ? block.accentColor : '';
    const label = block.type === 'example' ? 'Exemplo musical' : '';
    const title = block.title ? `${label ? `${label} · ` : ''}${esc(block.title)}` : label;
    return `<aside class="content-callout callout-${block.type}" style="text-align:${alignment}${accent && block.type !== 'example' ? `;--callout-color:${accent}` : ''}">${block.type === 'tip' ? '<span class="callout-tip-icon" aria-hidden="true">🔦</span>' : ''}${title ? `<strong>${title}</strong>` : ''}<p>${richTextMarkup(block.text || '')}</p></aside>`;
  }
  if (block.type === 'image' && url) return mediaMarkup(url, 'image/remote', block.title || 'Imagem de apoio', block.title, block.alt);
  if (block.type === 'video' && url) {
    const parsed = new URL(url);
    const videoId = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    const embed = parsed.hostname.includes('youtube.com') ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId || '')}` : parsed.hostname === 'youtu.be' ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId || '')}` : '';
    return embed ? `<div class="video-frame"><iframe src="${embed}" title="${esc(block.title || 'Vídeo de apoio')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : `<a class="resource-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">▶ ${esc(block.title || 'Abrir vídeo')} ↗</a>`;
  }
  if ((block.type === 'link' || block.type === 'pdf') && url) return `<a class="resource-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span>${block.type === 'pdf' ? 'PDF' : '↗'}</span>${esc(block.title || url)} <span>Abrir ↗</span></a>`;
  if (block.type === 'audio' && url) return `<figure class="audio-block"><figcaption>${esc(block.title || 'Exemplo sonoro')}</figcaption><audio controls preload="none" src="${esc(url)}">Seu navegador não suporta áudio.</audio></figure>`;
  return block.text ? `<div class="lesson-paragraph" style="text-align:${alignment}">${richTextMarkup(block.text)}</div>` : '';
}

function renderLesson(id) {
  const lesson = getLesson(id);
  if (!lesson || (currentProfile().role === 'student' && !lessonIsPublished(lesson))) {
    toast('Esta aula não está disponível.');
    view = 'aulas';
    activeLessonId = null;
    return renderLessons();
  }
  if (currentProfile().role === 'student' && lesson.accessLocked) {
    toast('O professor ainda não liberou esta aula para você.', 'error');
    view = 'aulas';
    activeLessonId = null;
    return renderLessons();
  }
  const related = (lesson.exerciseIds || []).map(getExercise).filter(exercise => exercise && (currentProfile().role === 'teacher' || exerciseStatus(exercise) === 'published'));
  const block = getBlock(lesson.blockId);
  const content = (lesson.content || []).map(renderContentBlock).join('');
  const completed = learningComplete('lesson', lesson.id);
  return `${pageHeading('AULA', lesson.title, lesson.subtitle || lesson.description || 'Conteúdo musical para explorar com calma.', `<button class="button secondary" type="button" data-action="back-blocks">← Voltar às aulas</button>${currentProfile().role === 'student' ? button(completed ? '✓ Concluída · Desmarcar' : 'Marcar como concluída', 'toggle-learning-progress', completed ? 'completed-progress-button' : 'secondary', `data-type="lesson" data-id="${esc(lesson.id)}"`) : ''}${currentProfile().role === 'teacher' ? button('Editar aula', 'edit-lesson', 'primary', `data-id="${esc(lesson.id)}"`) : ''}`)}
    <div class="lesson-context"><span class="context-icon">♫</span><span>${esc(block?.title || 'Aula independente')}</span><span class="context-dot">·</span><span>${Number(lesson.order) || 1}ª aula</span></div>
    ${lesson.coverUrl && safeUrl(lesson.coverUrl) ? `<div class="lesson-hero-image"><img src="${esc(safeUrl(lesson.coverUrl))}" alt=""></div>` : ''}
    <article class="lesson-reader">${content || empty('Esta aula ainda não tem conteúdo.', currentProfile().role === 'teacher' ? 'Edite a aula para adicionar textos, exemplos, partituras e materiais.' : 'O professor ainda está preparando este conteúdo.', '')}</article>
    <section class="related-exercises"><div class="section-heading"><div><p class="eyebrow">APLIQUE O QUE APRENDEU</p><h2>Exercícios relacionados</h2><p>Atividades associadas a esta aula pelo identificador.</p></div>${currentProfile().role === 'teacher' ? button('＋ Criar exercício relacionado', 'new-related-exercise', 'secondary', `data-id="${esc(lesson.id)}"`) : ''}</div>
      ${related.length ? `<div class="exercise-grid">${related.map(exerciseCard).join('')}</div>` : empty('Nenhum exercício relacionado ainda.', currentProfile().role === 'teacher' ? 'Associe uma atividade existente ou crie uma nova para esta aula.' : 'Não há atividades associadas a esta aula.', currentProfile().role === 'teacher' ? button('Associar exercício', 'edit-lesson', 'secondary', `data-id="${esc(lesson.id)}"`) : '', '✓')}</section>`;
}

function renderExercise(id) {
  const exercise = getExercise(id);
  if (!exercise || (currentProfile().role === 'student' && exerciseStatus(exercise) !== 'published')) {
    toast('Este exercício não está disponível.');
    view = 'exercicios';
    activeExerciseId = null;
    return renderExercises();
  }
  if (currentProfile().role === 'student' && exercise.accessLocked) {
    toast('O professor ainda não liberou esta atividade para você.', 'error');
    view = 'exercicios';
    activeExerciseId = null;
    return renderExercises();
  }
  const attempt = model.attempts
    .filter(item => item.exerciseId === id && item.profileName === currentProfile().displayName)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const priorAttempts = model.attempts.filter(item => item.exerciseId === id
    && (accountSession?.role === 'student' ? item.studentId === accountSession.id : item.profileName === currentProfile().displayName));
  const questionCount = (exercise.questions || []).length;
  const questions = (exercise.questions || []).map((question, index) => {
    const points = Math.max(0, Number(question.points ?? 1));
    let response = '';
    if (question.type === 'choice') {
      response = (question.options || []).map((option, optionIndex) => `<label class="answer-choice"><input type="radio" name="answer-${index}" value="${esc(option)}"><span>${esc(option)}</span></label>`).join('');
    } else if (question.type === 'boolean') {
      response = `<div class="answer-choice-list"><label class="answer-choice"><input type="radio" name="answer-${index}" value="Verdadeiro"><span>Verdadeiro</span></label><label class="answer-choice"><input type="radio" name="answer-${index}" value="Falso"><span>Falso</span></label></div>`;
    } else if (question.type === 'chord') {
      const stepCount = (question.assemblyOrder?.length || question.expectedNotes?.length || question.expectedIntervals?.length || 0);
      response = `<p class="question-hint">Monte o acorde no piano ou digite as notas. Separe as notas com espaços; a oitava é opcional e usa C${defaultOctave()} como padrão.</p><p class="chord-step-hint" data-chord-progress="${esc(question.id)}" data-step-count="${stepCount}" data-step-hints="${esc(JSON.stringify(question.assemblyHints || []))}">${stepCount ? `Etapa 1 de ${stepCount}${question.assemblyHints?.[0] ? ` · ${esc(question.assemblyHints[0])}` : ''}` : 'O professor ainda não definiu as notas esperadas.'}</p>${question.referenceNotes?.length ? `<div class="reference-player"><button class="button secondary" type="button" data-action="play-chord-reference" data-question="${esc(question.id)}">♫ Ouvir acorde de referência</button><span>Compare seu acorde com este exemplo.</span></div>` : ''}<div class="typed-chord-entry"><label class="field-label" for="answer-${index}">Notas do acorde<input id="answer-${index}" class="text-answer music-note-answer" name="answer-${index}" type="text" autocomplete="off" placeholder="C E G ou C4 E4 G4"></label><button class="button secondary small-button" type="button" data-action="play-typed-chord" data-question="${esc(question.id)}" data-index="${index}">♫ Tocar notas digitadas</button></div>${pianoMarkup({ id: `piano-${question.id}`, defaultOctave: defaultOctave() })}`;
    } else if (question.type === 'ear') {
      response = `<div class="reference-player"><button class="button secondary" type="button" data-action="play-reference" data-question="${esc(question.id)}">♫ Ouvir acorde de referência</button><span>Escute e escreva o nome do acorde.</span></div><label class="field-label" for="answer-${index}">Sua resposta</label><input id="answer-${index}" class="text-answer" name="answer-${index}" type="text" autocomplete="off" placeholder="Ex.: Dó maior">`;
    } else if (question.type === 'rhythm') {
      const attemptsUsed = priorAttempts.reduce((total, item) => total + (item.answers || [])
        .filter(answer => answer.questionId === question.id)
        .reduce((count, answer) => count + (Array.isArray(answer.value?.plays) ? answer.value.plays.length : 1), 0), 0);
      const retryLimit = Math.min(10, Math.max(1, Number(question.retryLimit) || 3));
      const eventMarkup = (question.rhythmEvents || []).map((item, eventIndex) => {
        const duration = Number(item.durationBeats) || 0;
        const symbol = duration >= 4 ? '𝅝' : duration >= 2 ? '𝅗𝅥' : duration >= 1 ? '♩' : duration >= 0.5 ? '♪' : '♬';
        const label = duration >= 4 ? 'semibreve' : duration >= 2 ? 'mínima' : duration >= 1 ? 'semínima' : duration >= 0.5 ? 'colcheia' : 'semicolcheia';
        return `<span class="rhythm-beat-marker" data-index="${eventIndex}" aria-label="${label} ${eventIndex + 1}"><span aria-hidden="true">${symbol}</span><small>${eventIndex + 1}</small></span>`;
      }).join('');
      response = `<div class="rhythm-score-layout"><div class="score-render" data-score="${esc(question.id)}"><span class="score-loading">Carregando partitura…</span></div><section class="rhythm-activity" id="rhythm-${esc(question.id)}" data-rhythm-question="${esc(question.id)}" data-events="${esc(JSON.stringify(question.rhythmEvents || []))}" data-tempo="${Number(question.rhythmTempo) || 80}" data-tolerance="${Math.min(500, Math.max(60, Number(question.toleranceMs) || 220))}" data-max-attempts="${retryLimit}" data-used-attempts="${attemptsUsed}" data-rhythm-report=""><p class="eyebrow">LEITURA RÍTMICA</p><p class="rhythm-status" data-rhythm-status aria-live="polite">${attemptsUsed >= retryLimit ? `Limite de ${retryLimit} execuções atingido.` : 'Leia a partitura. Depois da contagem, toque no botão uma vez para cada batida.'}</p><div class="rhythm-note-strip">${eventMarkup}</div><button class="rhythm-tap-button" type="button" data-action="tap-rhythm" data-rhythm-question="${esc(question.id)}" disabled aria-label="Tocar uma batida">TOCAR</button><button class="button primary rhythm-start" type="button" data-action="start-rhythm" data-id="${esc(question.id)}" ${attemptsUsed >= retryLimit ? 'disabled' : ''}>${attemptsUsed ? 'Estou pronto · tentar novamente' : 'Estou pronto'}</button><small class="form-help">${Math.max(0, retryLimit - attemptsUsed)} execução(ões) restante(s) · tolerância ±${Math.min(500, Math.max(60, Number(question.toleranceMs) || 220))} ms</small></section></div>`;
    } else if (question.type === 'score') {
      response = `<div class="score-shell"><div class="score-question-score"><div class="score-render" data-score="${esc(question.id)}"><span class="score-loading">Carregando partitura…</span></div><button class="button secondary small-button" type="button" data-action="play-score" data-question="${esc(question.id)}" disabled>♫ Ouvir partitura</button></div><div class="measure-prompt"><span class="measure-badge">Compasso ${esc(question.measure || '?')}</span><p>${richTextMarkup(question.prompt || 'Analise este trecho da partitura.')}</p><label class="field-label" for="answer-${index}">Sua resposta</label><input id="answer-${index}" class="text-answer" name="answer-${index}" type="text" placeholder="Escreva sua análise"></div></div>`;
    } else if (question.type === 'material') {
      const material = question.mediaSource === 'upload' && question.mediaId
        ? uploadedMediaMarkup(question.mediaId, question.mediaName, question.mediaType)
        : question.referenceUrl && safeUrl(question.referenceUrl)
          ? `<a class="resource-link" href="${esc(safeUrl(question.referenceUrl))}" target="_blank" rel="noopener noreferrer">Abrir material de apoio ↗</a>`
          : '';
      response = `${material}<label class="field-label" for="answer-${index}">Sua resposta</label><textarea class="text-answer" id="answer-${index}" name="answer-${index}" rows="3" placeholder="Escreva sua resposta"></textarea>`;
    } else if (question.type === 'custom') {
      response = `<label class="field-label" for="answer-${index}">Sua resposta musical</label><textarea class="text-answer" id="answer-${index}" name="answer-${index}" rows="3" placeholder="Responda da forma solicitada"></textarea>`;
    } else {
      response = `<label class="field-label" for="answer-${index}">Sua resposta</label><input id="answer-${index}" class="text-answer" name="answer-${index}" type="text" autocomplete="off" placeholder="Digite sua resposta">`;
    }
    const promptMedia = question.promptMediaId
      ? `<div class="question-prompt-attachment">${uploadedMediaMarkup(question.promptMediaId, question.promptMediaName, question.promptMediaType, 'Material do enunciado')}</div>`
      : '';
    const promptScoreSource = question.promptScoreSource || (question.promptScoreMediaId ? 'upload' : 'link');
    const promptScoreOnMuseScore = promptScoreSource === 'link' && museScoreScoreUrl(question.promptScoreUrl);
    const promptScore = question.promptScoreMediaId || safeUrl(question.promptScoreUrl)
      ? `<div class="question-prompt-score"><div class="score-render prompt-score-render" data-prompt-score="${esc(question.id)}"><span class="score-loading">Carregando partitura…</span></div>${promptScoreOnMuseScore ? '' : `<button class="button secondary small-button" type="button" data-action="play-prompt-score" data-cache-key="prompt-score:${esc(question.id)}" data-question="${esc(question.id)}" disabled>♫ Ouvir partitura</button>`}</div>`
      : '';
    const referenceAudio = question.audioMediaId
      ? `<div class="question-reference-audio">${uploadedMediaMarkup(question.audioMediaId, question.audioMediaName, question.audioMediaType, 'Áudio de referência', '', question.audioFrequency || '')}</div>`
      : '';
    const audioResponse = question.allowAudioResponse
      ? `<div class="answer-audio-widget" data-question-id="${esc(question.id)}" data-audio-required="${question.requireAudioResponse ? 'true' : 'false'}"><p class="eyebrow">RESPOSTA EM ÁUDIO${question.requireAudioResponse ? ' · OBRIGATÓRIA' : ' · OPCIONAL'}</p><div class="recording-actions"><button class="button secondary small-button" type="button" data-action="record-response-audio">● Gravar resposta</button><button class="button secondary small-button" type="button" data-action="stop-response-audio" disabled>■ Parar gravação</button><label class="button secondary small-button answer-audio-upload">Enviar áudio<input class="answer-audio-file" type="file" accept="audio/*" hidden></label></div><small class="form-help answer-audio-status">Grave uma resposta ou envie um arquivo de áudio.</small><div class="answer-audio-preview"></div></div>`
      : '';
    const sourceReference = question.sourceLessonTitle
      ? `<button class="question-source" type="button" data-action="open-lesson" data-id="${esc(question.sourceLessonId)}">Referência: ${esc(question.sourceExerciseTitle || 'Exercício')} · ${esc(question.sourceLessonTitle)} ↗</button>`
      : '';
    return `<section class="quiz-question" data-question="${esc(question.id)}" data-index="${index}" data-type="${esc(question.type)}"><div class="question-title-row"><span class="question-number">${String(index + 1).padStart(2, '0')}</span><div><h3>${richTextMarkup(question.prompt || 'Questão')}</h3><span>${points} ${points === 1 ? 'ponto' : 'pontos'} · ${esc(types[question.type] || 'Questão')}</span>${sourceReference}</div></div>${promptMedia}${promptScore}${referenceAudio}${response}${audioResponse}</section>`;
  }).join('');
  const resultMarkup = attempt ? renderAttemptResult(attempt, exercise) : '';
  const historyMarkup = priorAttempts.length
    ? `<section class="attempt-history"><div class="section-heading"><div><p class="eyebrow">HISTÓRICO</p><h2>Tentativas registradas</h2></div><span class="status-tag completed">${priorAttempts.length} ${priorAttempts.length === 1 ? 'tentativa' : 'tentativas'}</span></div><ol>${priorAttempts.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map((item, index) => {
        const points = Number(item.score) || 0;
        const total = Number(item.maxScore) || (item.answers || []).reduce((sum, answer) => sum + (Number(answer.points) || 0), 0);
        return `<li><strong>Tentativa ${priorAttempts.length - index}</strong><span>${new Date(item.createdAt).toLocaleString('pt-BR')}</span><span>${item.gradedAt || item.reviewedAt ? 'Corrigida' : 'Aguardando correção'}</span><b>${points}/${total || '—'} pts</b>${renderAttemptHistoryAnswers(item, exercise)}</li>`;
      }).join('')}</ol></section>`
    : '';
  const relatedLessons = (exercise.lessonIds || []).map(getLesson).filter(Boolean);
  const completed = learningComplete('exercise', exercise.id);
  const assessmentTimer = exercise.assessment && currentProfile().role === 'student'
    ? `<div class="assessment-live-timer"><span>Tempo restante</span><strong data-assessment-clock>--:--</strong></div>`
    : '';
  const relationButtons = relatedLessons.map(lesson => lesson.accessLocked && currentProfile().role === 'student'
    ? `<span class="related-lesson-link locked">🔒 Aula: ${esc(lesson.title)}</span>`
    : button(`← Aula: ${esc(lesson.title)}`, 'open-lesson', 'secondary', `data-id="${esc(lesson.id)}"`)).join('');
  return `${pageHeading('EXERCÍCIO', exercise.title, exercise.instructions || 'Responda às questões e confira seu resultado.', `<button class="button secondary" type="button" data-action="go-exercises">← Playlists</button>${relationButtons}${currentProfile().role === 'student' ? button(completed ? '✓ Concluída · Desmarcar' : 'Marcar como concluída', 'toggle-learning-progress', completed ? 'completed-progress-button' : 'secondary', `data-type="exercise" data-id="${esc(exercise.id)}"`) : ''}${currentProfile().role === 'teacher' ? button('Editar exercício', 'edit-exercise', 'primary', `data-id="${esc(exercise.id)}"`) : ''}`)}
    <div class="exercise-intro"><span class="status-tag ${exerciseStatus(exercise)}">${esc({ draft: 'Rascunho', published: 'Publicado', closed: 'Encerrado', archived: 'Arquivado' }[exerciseStatus(exercise)])}</span><span class="difficulty-pill">${esc(exercise.difficulty || 'Geral')}</span><span>${questionCount} ${questionCount === 1 ? 'questão' : 'questões'}</span>${(exercise.lessonIds || []).length ? `<span>Relacionado a ${exercise.lessonIds.map(getLesson).filter(Boolean).map(lesson => esc(lesson.title)).join(', ')}</span>` : '<span>Exercício independente</span>'}</div>${assessmentTimer}
    ${currentProfile().role === 'teacher' ? `<div class="local-notice">Pré-visualização do professor. Esta conta pode visualizar o gabarito e editar a atividade antes da publicação.</div>` : ''}
    <form class="exercise-attempt" id="exercise-attempt" data-started-at="${Date.now()}">${questions}<section class="attempt-attachment"><p class="eyebrow">ANEXOS DO ALUNO</p><label class="field-label" for="exercise-attachments">Enviar imagem ou arquivo <span class="optional-label">Opcional</span><input id="exercise-attachments" name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.zip,.mp3,.wav,.m4a,.ogg"></label><small class="form-help">Você pode anexar vários arquivos, até 20 arquivos por tentativa.</small></section><div class="attempt-footer"><span>Leia com calma e revise antes de enviar.</span><button class="button primary" type="submit" data-action="submit-attempt">Enviar respostas</button></div></form>${resultMarkup}${historyMarkup}`;
}

function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
}

function answerMatches(question, value) {
  if (question.type === 'rhythm') return Array.isArray(value?.plays) && value.plays.length > 0
    && Number(value.bestAccuracy) >= 80;
  if (question.type === 'chord') {
    const expected = question.expectedNotes?.length ? parseCurrentNotes(question.expectedNotes) : [];
    const submittedTokens = Array.isArray(value)
      ? value.map(note => Number.isFinite(note) ? canonicalNoteToken(note) : String(note))
      : String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
    const expectedTokens = question.expectedNotes || [];
    const submittedMidi = Array.isArray(value)
      ? value.map(note => Number.isFinite(note) ? note : parseCurrentNote(note))
      : parseCurrentNotes(value);
    if (question.manual || (!expected.length && !question.expectedIntervals?.length)) return null;
    const normalizeOctaves = notes => notes.map(note => question.ignoreOctave ? ((note % 12) + 12) % 12 : note);
    const chordOrder = question.chordOrder || (question.assemblyOrder?.length ? 'sequence' : 'any');
    const sequence = chordOrder === 'inversion'
      ? expected
      : question.assemblyOrder?.length ? parseCurrentNotes(question.assemblyOrder) : expected;
    const sequenceTokens = chordOrder === 'inversion'
      ? expectedTokens
      : question.assemblyOrder?.length ? question.assemblyOrder : expectedTokens;
    if (question.correctionCriterion === 'intervals') {
      const intervalCycle = notes => notes.length < 2 ? []
        : notes.map((note, index) => (((notes[(index + 1) % notes.length] % 12) - (note % 12) + 12) % 12) || 12);
      const expectedIntervals = question.expectedIntervals?.length
        ? question.expectedIntervals
        : intervalCycle(sequence);
      const actualIntervals = intervalCycle(submittedMidi);
      if (expectedIntervals.length !== actualIntervals.length || !expectedIntervals.length) return false;
      return chordOrder === 'any'
        ? actualIntervals.some((_, offset) => expectedIntervals.every((interval, index) => interval === actualIntervals[(index + offset) % actualIntervals.length]))
        : expectedIntervals.every((interval, index) => interval === actualIntervals[index]);
    }
    if (chordOrder === 'sequence' || chordOrder === 'inversion') {
      if (question.acceptEnharmonic === false) {
        const spelling = notes => notes.map(note => {
          const parsed = parseNoteSpelling(note, defaultOctave());
          return parsed ? `${parsed.letter}${parsed.accidental}${question.ignoreOctave ? '' : parsed.octave}` : '';
        });
        return sequenceTokens.length === submittedTokens.length
          && JSON.stringify(spelling(sequenceTokens)) === JSON.stringify(spelling(submittedTokens));
      }
      return sequence.length === submittedMidi.length
        && JSON.stringify(normalizeOctaves(sequence)) === JSON.stringify(normalizeOctaves(submittedMidi));
    }
    if (question.acceptEnharmonic === false) {
      const spelling = notes => notes.map(note => {
        const parsed = parseNoteSpelling(note, defaultOctave());
        return parsed ? `${parsed.letter}${parsed.accidental}${question.ignoreOctave ? '' : parsed.octave}` : '';
      }).sort();
      return expectedTokens.length === submittedTokens.length
        && JSON.stringify(spelling(expectedTokens)) === JSON.stringify(spelling(submittedTokens));
    }
    const normalize = notes => normalizeOctaves(notes).sort((a, b) => a - b);
    return expected.length > 0 && JSON.stringify(normalize(expected)) === JSON.stringify(normalize(submittedMidi));
  }
  if (question.manual) return null;
  const valid = [question.answer, ...(question.acceptedAnswers || [])].filter(item => item !== undefined && String(item).trim() !== '');
  if (!valid.length) return null;
  const submittedNote = parseCurrentNote(value);
  return valid.some(item => {
    const expectedNote = parseCurrentNote(item);
    return Number.isFinite(submittedNote) && Number.isFinite(expectedNote)
      ? submittedNote === expectedNote
      : normalizeAnswer(item) === normalizeAnswer(value);
  });
}

function formatAttemptAnswer(answer) {
  if (Array.isArray(answer.value)) {
    return answer.value.map(note => formatNote(Number.isFinite(note) ? note : parseCurrentNote(note))).join(' · ');
  }
  if (answer.value && typeof answer.value === 'object' && Array.isArray(answer.value.plays)) {
    const plays = answer.value.plays;
    const bestAccuracy = plays.length
      ? ` · melhor ${Math.max(...plays.map(play => Number(play.accuracy) || 0))}%`
      : '';
    return `${plays.length} execução(ões)${bestAccuracy}`;
  }
  if (answer.value && typeof answer.value === 'object') return JSON.stringify(answer.value);
  return String(answer.value ?? '');
}

function renderAttemptHistoryAnswers(attempt, exercise) {
  const answers = (attempt.answers || []).map((answer, index) => {
    const question = exercise.questions.find(item => item.id === answer.questionId) || {};
    const prompt = answer.prompt || question.prompt || 'Questão';
    const value = formatAttemptAnswer(answer);
    const audio = answer.audioAttachment
      ? uploadedMediaMarkup(answer.audioAttachment.id, answer.audioAttachment.name, answer.audioAttachment.type, 'Resposta em áudio')
      : '';
    const status = answer.manual && !attempt.gradedAt
      ? 'Aguardando correção'
      : answer.correct ? 'Correta' : answer.manual ? 'Corrigida manualmente' : 'Incorreta';
    return `<article class="attempt-history-answer"><strong>Questão ${index + 1}</strong><div>${richTextMarkup(prompt)}</div><p><span>Resposta do aluno:</span> ${esc(value || 'Sem resposta')}</p>${audio}<small>${esc(status)} · ${Number(answer.points) || 0} pts</small></article>`;
  }).join('');
  return `<details class="attempt-history-responses"><summary>Ver perguntas e respostas (${(attempt.answers || []).length})</summary><div>${answers || '<p>Nenhuma resposta registrada nesta tentativa.</p>'}</div></details>`;
}

function renderAttemptResult(attempt, exercise) {
  const pending = (attempt.answers || []).filter(answer => answer.manual && !attempt.gradedAt);
  const maxScore = (attempt.answers || []).reduce((total, answer) => total + (answer.manual && !attempt.gradedAt ? 0 : Number(answer.points) || 0), 0);
  const awarded = Number(attempt.score) || 0;
  const percent = maxScore ? Math.round((awarded / maxScore) * 100) : 0;
  const rows = (attempt.answers || []).map((answer, index) => {
    const question = exercise.questions.find(item => item.id === answer.questionId) || exercise.questions[index] || {};
    const correct = answer.correct === true;
    const status = answer.manual ? attempt.gradedAt ? 'Corrigida manualmente' : 'Aguardando correção' : correct ? 'Correta' : 'Incorreta';
    const detail = answer.manual
      ? attempt.gradedAt ? `Sua resposta recebeu ${Number(answer.manualScore) || 0} de ${Number(answer.points) || 0} pontos.` : 'Sua resposta foi encaminhada ao professor e não foi contada como errada.'
      : correct ? 'Isso mesmo! Sua resposta está correta!'
        : 'Ainda não! Confira sua resposta e tente novamente.';
    const expected = question.answer || (question.expectedNotes || []).join(' · ') || (question.expectedIntervals || []).join(' · ') || 'definida pelo professor';
    const explanation = question.feedback ? `<p>${esc(question.feedback)}</p>` : '';
    const answerKey = exercise.showAnswers && !correct && !answer.manual ? `<p>Resposta esperada: ${esc(expected)}.</p>` : '';
    const teacherComment = answer.teacherComment ? `<p class="student-question-comment"><strong>Comentário do professor:</strong> ${esc(answer.teacherComment)}</p>` : '';
    const submittedAudio = answer.audioAttachment
      ? `<div class="answer-submitted-audio">${uploadedMediaMarkup(answer.audioAttachment.id, answer.audioAttachment.name, answer.audioAttachment.type, 'Resposta em áudio')}</div>`
      : '';
    const submittedValue = formatAttemptAnswer(answer);
    return `<li class="${answer.manual && !attempt.gradedAt ? 'answer-pending' : correct ? 'answer-correct' : 'answer-incorrect'}"><strong>Questão ${index + 1} · ${status}</strong><h3 class="result-question">${richTextMarkup(answer.prompt || question.prompt || 'Questão')}</h3><div class="result-submitted-answer"><span>Sua resposta</span><strong>${esc(submittedValue || 'Sem resposta')}</strong></div><p>${esc(detail)}</p>${submittedAudio}${answerKey}${explanation}${teacherComment}</li>`;
  }).join('');
  const teacherRating = Math.min(5, Math.max(0, Number(attempt.teacherRating) || 0));
  const ratingMarkup = attempt.reviewedAt
    ? `<div class="student-review"><span class="status-tag completed">Professor conferiu</span>${teacherRating ? `<p class="student-stars" aria-label="${teacherRating} de 5 estrelas">${'★'.repeat(teacherRating)}<span>${'★'.repeat(5 - teacherRating)}</span></p>` : ''}${attempt.teacherNote ? `<p><strong>Observação do professor:</strong> ${esc(attempt.teacherNote)}</p>` : ''}</div>`
    : '';
  const attachmentsMarkup = (attempt.attachments || []).length
    ? `<section class="attempt-submitted-files"><h3>Arquivos enviados</h3>${attempt.attachments.map(file => uploadedMediaMarkup(file.id, file.name, file.type)).join('')}</section>`
    : '';
  const teacherAttachmentsMarkup = (attempt.teacherAttachments || []).length
    ? `<section class="attempt-submitted-files"><h3>Arquivos devolvidos pelo professor</h3>${attempt.teacherAttachments.map(file => uploadedMediaMarkup(file.id, file.name, file.type)).join('')}</section>`
    : '';
  return `<section class="result-panel"><div class="result-score"><span>Seu resultado</span>${attempt.reviewedAt ? '<span class="status-tag completed">Professor conferiu</span>' : ''}<strong>${awarded} <small>/ ${maxScore || '—'}</small></strong><span>${maxScore ? `${percent}% nas questões corrigidas` : 'Aguardando correção'}</span>${pending.length ? `<span class="pending-caption">${pending.length} questão(ões) aguardando avaliação; não contadas como erro.</span>` : ''}${ratingMarkup}</div><div><h2>Revisão das respostas</h2><ol class="result-list">${rows}</ol>${attachmentsMarkup}${teacherAttachmentsMarkup}</div><p class="result-disclaimer">As tentativas e correções são registradas no servidor.</p></section>`;
}

function openAttemptReview(attemptId) {
  const attempt = model.attempts.find(item => item.id === attemptId && !item.isDemo);
  if (!attempt) {
    toast('Tentativa não encontrada.', 'error');
    return;
  }
  const exercise = getExercise(attempt.exerciseId);
  if (!exercise) {
    toast('Atividade não encontrada.', 'error');
    return;
  }
  const studentAttempts = model.attempts
    .filter(item => !item.isDemo && item.studentId === attempt.studentId && item.exerciseId === attempt.exerciseId)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const attemptIndex = studentAttempts.findIndex(item => item.id === attempt.id);
  const previous = attemptIndex > 0 ? studentAttempts[attemptIndex - 1] : null;
  const next = attemptIndex >= 0 && attemptIndex < studentAttempts.length - 1 ? studentAttempts[attemptIndex + 1] : null;
  const questionCards = (attempt.answers || []).map((answer, index) => {
    const question = exercise.questions.find(item => item.id === answer.questionId) || exercise.questions[index] || {};
    let value = String(answer.value ?? '');
    if (Array.isArray(answer.value)) value = answer.value.map(note => formatNote(Number.isFinite(note) ? note : parseCurrentNote(note))).join(' · ');
    if (answer.value && typeof answer.value === 'object' && !Array.isArray(answer.value) && Array.isArray(answer.value.plays)) {
      value = `${answer.value.plays.length} execução(ões) registrada(s)`;
    }
    const status = answer.manual && !attempt.gradedAt ? 'Aguardando correção' : answer.correct ? 'Correta' : 'Incorreta';
    const manual = answer.manual === true;
    const earned = manual ? Number(answer.manualScore) || 0 : answer.correct ? Number(answer.points) || 0 : 0;
    const submittedAudio = answer.audioAttachment
      ? `<div class="answer-submitted-audio">${uploadedMediaMarkup(answer.audioAttachment.id, answer.audioAttachment.name, answer.audioAttachment.type, 'Resposta em áudio')}</div>`
      : '';
    return `<article class="attempt-review-question"><div class="attempt-review-question-head"><span>Questão ${index + 1}</span><span class="status-tag ${answer.correct ? 'completed' : answer.manual && !attempt.gradedAt ? 'draft' : 'draft'}">${esc(status)}</span></div><h3>${richTextMarkup(answer.prompt || question.prompt || 'Questão')}</h3><div class="attempt-review-answer"><span>Resposta do aluno</span><strong>${esc(value || 'Sem resposta')}</strong></div>${submittedAudio}<div class="attempt-review-controls">${manual ? `<label class="field-label">Pontuação<input type="number" min="0" max="${Number(answer.points) || 1}" step="0.5" value="${earned}" data-grade-answer="${esc(answer.questionId)}" data-attempt="${esc(attempt.id)}"></label>` : `<label class="field-label">Pontuação obtida<input type="text" value="${earned} / ${Number(answer.points) || 0}" readonly></label>`}<label class="field-label">Comentário por questão<textarea rows="3" maxlength="1000" data-comment-answer="${esc(answer.questionId)}" data-attempt="${esc(attempt.id)}" placeholder="Escreva uma orientação ao aluno...">${esc(answer.teacherComment || '')}</textarea></label></div></article>`;
  }).join('');
  const score = reviewedAttemptScoresFor(attempt);
  const navigation = `${previous ? `<button type="button" class="button secondary" data-action="open-attempt-review" data-id="${esc(previous.id)}">← Tentativa anterior</button>` : ''}<span>Tentativa ${studentAttempts.length - attemptIndex} de ${studentAttempts.length}</span>${next ? `<button type="button" class="button secondary" data-action="open-attempt-review" data-id="${esc(next.id)}">Próxima tentativa →</button>` : ''}`;
  openDialog(`<div class="attempt-review-modal"><header class="attempt-review-header"><div><p class="eyebrow">CORREÇÃO DA ATIVIDADE</p><h2>${esc(exercise.title)}</h2><p>${esc(attempt.profileName)} · ${new Date(attempt.createdAt).toLocaleString('pt-BR')} · ${attempt.durationSeconds ? formatDuration(attempt.durationSeconds) : 'tempo não registrado'}</p></div><strong>${score.earned} / ${score.possible} pts</strong></header><nav class="attempt-review-navigation">${navigation}</nav><div class="attempt-review-questions">${questionCards || '<p>Nenhuma questão registrada nesta tentativa.</p>'}</div><footer class="attempt-review-footer">${button('Fechar', 'close-dialog', 'secondary')}<button type="button" class="button primary" data-action="save-attempt-review" data-id="${esc(attempt.id)}">Salvar correção e comentar</button></footer></div>`, 'attempt-review-modal');
  hydrateMedia(root.querySelector('#active-dialog'));
}

function renderResults() {
  const exercises = model.exercises;
  if (!resultsExerciseId || !exercises.some(item => item.id === resultsExerciseId)) {
    resultsExerciseId = exercises.find(item => model.attempts.some(attempt => attempt.exerciseId === item.id))?.id || exercises[0]?.id || null;
  }
  const selected = getExercise(resultsExerciseId);
  if (!selected)   return `${pageHeading('ACOMPANHAMENTO LOCAL', 'Respostas', 'Crie um exercício para começar a acompanhar respostas.', '')}${empty('Nenhum exercício para analisar.', 'Crie uma atividade e simule respostas para testar os indicadores.', button('＋ Criar exercício', 'new-exercise', 'primary'), '✓')}`;

  const attempts = model.attempts.filter(attempt => attempt.exerciseId === selected.id
    && (!resultsStudentId || attempt.studentId === resultsStudentId))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const demoAttempts = attempts.filter(attempt => attempt.isDemo);
  const demoResponders = new Set(demoAttempts.map(attempt => attempt.demoParticipantId).filter(Boolean)).size;
  const realAttempts = attempts.filter(attempt => !attempt.isDemo);
  const answers = attempts.flatMap(attempt => (attempt.answers || []).map(answer => ({ ...answer, attempt })));
  const pendingAnswers = answers.filter(item => item.manual && !item.attempt.gradedAt);
  const reviewedAnswers = answers.filter(item => !(item.manual && !item.attempt.gradedAt));
  const correctAnswers = reviewedAnswers.filter(item => item.correct === true).length;
  const incorrectAnswers = reviewedAnswers.length - correctAnswers;
  const pendingCount = pendingAnswers.length;
  const points = attempts.reduce((totals, attempt) => {
    for (const answer of attempt.answers || []) {
      if (answer.manual && !attempt.gradedAt) continue;
      totals.earned += answer.manual ? Number(answer.manualScore) || 0 : answer.correct ? Number(answer.points) || 0 : 0;
      totals.possible += Number(answer.points) || 0;
    }
    return totals;
  }, { earned: 0, possible: 0 });
  const reviewedAttemptScores = attempts.map(attempt => {
    let earned = 0;
    let possible = 0;
    for (const answer of attempt.answers || []) {
      if (answer.manual && !attempt.gradedAt) continue;
      possible += Number(answer.points) || 0;
      earned += answer.manual ? Number(answer.manualScore) || 0 : answer.correct ? Number(answer.points) || 0 : 0;
    }
    return possible ? { earned, possible, percent: Math.round(earned / possible * 100) } : null;
  }).filter(Boolean);
  const timelineRecords = realAttempts.map(attempt => ({ attempt, score: reviewedAttemptScoresFor(attempt) }))
    .filter(item => item.score.possible > 0)
    .sort((a, b) => String(a.attempt.createdAt || '').localeCompare(String(b.attempt.createdAt || '')));
  const averagePoints = reviewedAttemptScores.length
    ? (reviewedAttemptScores.reduce((sum, item) => sum + item.earned, 0) / reviewedAttemptScores.length).toFixed(1)
    : '—';
  const averagePercent = points.possible ? Math.round(points.earned / points.possible * 100) : null;
  const questionStats = selected.questions.map((question, index) => {
    const responses = attempts.flatMap(attempt => (attempt.answers || []).filter(answer => answer.questionId === question.id).map(answer => ({ answer, attempt })));
    const pending = responses.filter(item => item.answer.manual && !item.attempt.gradedAt).length;
    const reviewed = responses.filter(item => !(item.answer.manual && !item.attempt.gradedAt));
    const correct = reviewed.filter(item => item.answer.correct === true).length;
    return { question, index, correct, incorrect: reviewed.length - correct, pending, reviewed: reviewed.length };
  });
  const difficultQuestions = questionStats.filter(item => item.incorrect).sort((a, b) => b.incorrect - a.incorrect).slice(0, 3);
  const cards = exercises.map(exercise => `<option value="${esc(exercise.id)}" ${exercise.id === selected.id ? 'selected' : ''}>${esc(exercise.title)} · ${({ draft: 'Rascunho', published: 'Publicado', closed: 'Encerrado', archived: 'Arquivado' }[exerciseStatus(exercise)])}</option>`).join('');
  const rows = attempts.map(attempt => {
    const manual = (attempt.answers || []).filter(answer => answer.manual && !attempt.gradedAt);
    const score = reviewedAttemptScoresFor(attempt);
    const answerRows = (attempt.answers || []).map((answer, index) => {
      const state = answer.manual && !attempt.gradedAt ? 'Aguardando correção' : answer.correct ? 'Correta' : answer.manual ? 'Corrigida manualmente' : 'Incorreta';
      const question = selected.questions.find(item => item.id === answer.questionId);
      const rhythmPlays = question?.type === 'rhythm' && Array.isArray(answer.value?.plays) ? answer.value.plays : [];
      const value = formatAttemptAnswer(answer);
      const earned = answer.manual ? answer.manualScore ?? 0 : answer.correct ? answer.points : 0;
      const rhythmDetails = rhythmPlays.length ? `<details class="rhythm-attempt-details"><summary>Ver todas as execuções rítmicas</summary>${rhythmPlays.map((play, playIndex) => `<section><strong>Execução ${playIndex + 1} · ${Number(play.accuracy) || 0}% · ${play.correct || 0}/${play.total || 0} notas no tempo</strong><ul>${(play.taps || []).map((tap, tapIndex) => `<li>Batida ${tapIndex + 1}: ${tap.missed ? 'perdida' : tap.correct ? 'no tempo' : 'fora do tempo'} · ${Number(tap.errorMs) > 0 ? '+' : ''}${Number(tap.errorMs) || 0} ms</li>`).join('')}${(play.outOfOrder || []).map(item => `<li>Toque fora da sequência: batida ${Number(item.tappedIndex) + 1}, esperada ${Number(item.expectedIndex) + 1}</li>`).join('')}</ul></section>`).join('')}</details>` : '';
      const audio = answer.audioAttachment
        ? uploadedMediaMarkup(answer.audioAttachment.id, answer.audioAttachment.name, answer.audioAttachment.type, 'Resposta em áudio')
        : '';
      return `<li><div class="individual-answer-prompt"><span>Q${index + 1} · ${esc(state)}</span><strong>${richTextMarkup(answer.prompt || question?.prompt || 'Questão')}</strong></div><div class="individual-answer-submission"><span>Resposta do aluno</span><strong>${esc(value || 'Sem resposta')}</strong>${audio}</div><small>${answer.manual && !attempt.gradedAt ? 'pendente' : `${Number(earned) || 0}/${Number(answer.points) || 0} pts`}</small>${rhythmDetails}</li>`;
    }).join('');
    const reviewAction = !attempt.isDemo && currentProfile().role === 'teacher'
      ? attempt.reviewedAt
        ? '<span class="status-tag completed">Visto pelo professor</span>'
        : button('Marcar como visto', 'mark-attempt-reviewed', 'secondary small-button', `data-id="${esc(attempt.id)}"`)
      : '';
    const openReviewAction = !attempt.isDemo && currentProfile().role === 'teacher'
      ? `<button type="button" class="button primary small-button" data-action="open-attempt-review" data-id="${esc(attempt.id)}">Abrir atividade e corrigir</button>`
      : '';
    const rating = Math.min(5, Math.max(0, Number(attempt.teacherRating) || 0));
    const teacherReviewMarkup = attempt.reviewedAt
      ? `<div class="teacher-review-summary">${rating ? `<p class="teacher-review-stars">${'★'.repeat(rating)}<span>${'★'.repeat(5 - rating)}</span></p>` : ''}${attempt.teacherNote ? `<p>${esc(attempt.teacherNote)}</p>` : ''}</div>`
      : '';
    const attachmentsMarkup = (attempt.attachments || []).length
      ? `<section class="attempt-submitted-files"><h3>Arquivos enviados pelo aluno</h3>${attempt.attachments.map(file => uploadedMediaMarkup(file.id, file.name, file.type)).join('')}</section>`
      : '';
    const teacherAttachmentsMarkup = (attempt.teacherAttachments || []).length
      ? `<section class="attempt-submitted-files"><h3>Arquivos devolvidos</h3>${attempt.teacherAttachments.map(file => uploadedMediaMarkup(file.id, file.name, file.type)).join('')}</section>`
      : '';
    return `<article class="response-card${attempt.isDemo ? ' demo-response' : ''}"><div class="response-card-head"><div><span class="status-tag ${manual.length ? 'draft' : 'completed'}">${manual.length ? `${manual.length} para corrigir` : 'Entregue'}</span>${attempt.isDemo ? '<span class="demo-label">DEMONSTRAÇÃO</span>' : '<span class="response-real-label">Conta real</span>'}<h3>${esc(attempt.profileName)}</h3><p>${new Date(attempt.createdAt).toLocaleString('pt-BR')}${attempt.durationSeconds ? ` · levou ${formatDuration(attempt.durationSeconds)}` : ''}</p>${reviewAction}${openReviewAction}${teacherReviewMarkup}</div><strong>${score.earned} <small>/ ${score.possible} pts corrigidos</small></strong></div><details class="individual-answers"><summary>Ver respostas individuais (${attempt.answers.length})</summary><ul>${answerRows}</ul></details>${attachmentsMarkup}${teacherAttachmentsMarkup}${manual.length ? `<div class="manual-grade">${manual.map(answer => `<label class="field-label"><span>${richTextMarkup(answer.prompt)}</span><input type="number" min="0" max="${Number(answer.points) || 1}" step="0.5" value="${Number(answer.manualScore) || 0}" data-grade-answer="${esc(answer.questionId)}" data-attempt="${esc(attempt.id)}"></label>`).join('')}<button class="button secondary small-button" type="button" data-action="save-grade" data-id="${esc(attempt.id)}">Salvar correção manual</button></div>` : ''}</article>`;
  }).join('');
  const noAnswer = `<p class="chart-empty">Ainda não há respostas registradas para este indicador.</p>`;
  const studentFilter = accountSession?.role === 'teacher'
    ? `<label class="results-select-label">Aluno<select id="results-student-select"><option value="">Todos os alunos</option>${studentsCache.map(student => `<option value="${esc(student.id)}" ${student.id === resultsStudentId ? 'selected' : ''}>${esc(student.name)}</option>`).join('')}</select></label>`
    : '';
  return `${pageHeading('ACOMPANHAMENTO DA TURMA', 'Respostas', 'Painel por exercício: respostas, correções e desempenho registrados na conta do servidor.', `<div class="results-selects"><label class="results-select-label">Exercício<select id="results-exercise-select">${cards}</select></label>${studentFilter}</div>`)}
    <section class="results-toolbar"><div><span class="status-tag ${exerciseStatus(selected)}">${esc({ draft: 'Rascunho', published: 'Publicado', closed: 'Encerrado', archived: 'Arquivado' }[exerciseStatus(selected)])}</span><strong>${esc(selected.title)}</strong></div><div class="results-actions">${button('＋ Simular 5 participantes', 'simulate-demo', 'primary', `data-id="${esc(selected.id)}"`)}${demoAttempts.length ? button('Limpar respostas demo', 'clear-demo', 'secondary', `data-id="${esc(selected.id)}"`) : ''}</div></section>
    <div class="demo-explainer"><span aria-hidden="true">ⓘ</span><p>A turma de demonstração contém ${demoParticipants.length} participantes fictícios. Ela serve somente para testar; resultados reais da conta aparecem identificados separadamente. Questões pendentes ficam fora das taxas de erro e dos aproveitamentos.</p></div>
    <section class="results-kpis"><article><span>Participantes demo</span><strong>${demoResponders}/${demoParticipants.length}</strong><small>${demoParticipants.length - demoResponders} ainda não responderam</small></article><article><span>Tentativas reais</span><strong>${realAttempts.length}</strong><small>Registros enviados pelas contas dos alunos</small></article><article><span>Acertos · erros</span><strong>${correctAnswers} · ${incorrectAnswers}</strong><small>${reviewedAnswers.length ? `${Math.round(correctAnswers / reviewedAnswers.length * 100)}% corretas nas corrigidas` : 'Sem respostas corrigidas'}</small></article><article><span>Pendentes de correção</span><strong>${pendingCount}</strong><small>Não entram como incorretas</small></article><article><span>Média de pontos</span><strong>${averagePoints}</strong><small>${averagePercent === null ? 'Sem pontuação corrigida' : `${averagePercent}% de aproveitamento corrigido`}</small></article></section>
    <div class="results-chart-grid"><section class="results-panel"><div class="results-panel-heading"><h2>Participação · demonstração</h2><span>${demoResponders} de ${demoParticipants.length} responderam</span></div><div class="chart-wrap chart-doughnut"><canvas id="participation-chart" aria-label="Participação da turma de demonstração"></canvas></div></section><section class="results-panel"><div class="results-panel-heading"><h2>Respostas corrigidas</h2><span>${reviewedAnswers.length} avaliadas · ${pendingCount} pendentes</span></div><div class="chart-wrap chart-doughnut"><canvas id="review-chart" aria-label="Percentual de respostas corretas, incorretas e pendentes"></canvas></div></section><section class="results-panel results-panel-wide"><div class="results-panel-heading"><h2>Desempenho por questão</h2><span>Questões pendentes aparecem separadas</span></div>${questionStats.length ? '<div class="chart-wrap chart-question"><canvas id="question-chart" aria-label="Acertos, erros e pendências por questão"></canvas></div>' : noAnswer}</section><section class="results-panel results-panel-wide"><div class="results-panel-heading"><h2>Evolução das tentativas</h2><span>Somente registros reais do exercício</span></div>${timelineRecords.length >= 3 ? '<div class="chart-wrap chart-timeline"><canvas id="timeline-chart" aria-label="Evolução do aproveitamento por tentativa"></canvas></div>' : '<p class="chart-empty">Ainda não há dados suficientes para mostrar uma evolução. São necessárias pelo menos três tentativas reais corrigidas.</p>'}</section></div>
    <div class="results-lower-grid"><section class="results-panel"><div class="results-panel-heading"><h2>Questões com mais erros</h2><span>Entre respostas corrigidas</span></div>${difficultQuestions.length ? `<ol class="difficulty-list">${difficultQuestions.map(item => `<li><span><strong>Q${item.index + 1} · ${richTextMarkup(item.question.prompt)}</strong><small>${item.correct} acerto(s) · ${item.incorrect} erro(s) · ${item.pending} pendente(s)</small></span><b>${item.incorrect}</b></li>`).join('')}</ol>` : noAnswer}</section><section class="results-panel"><div class="results-panel-heading"><h2>Participantes da demonstração</h2><span>Dados fictícios</span></div><div class="demo-roster">${demoParticipants.map(participant => `<div class="demo-roster-person"><span class="demo-avatar">${participant.initials}</span><span>${esc(participant.name)}</span><span class="status-tag ${demoAttempts.some(attempt => attempt.demoParticipantId === participant.id) ? 'completed' : 'draft'}">${demoAttempts.some(attempt => attempt.demoParticipantId === participant.id) ? 'Respondeu' : 'Não respondeu'}</span></div>`).join('')}</div></section></div>
    <section class="results-panel individual-results"><div class="results-panel-heading"><div><h2>Respostas individuais</h2><p>Notas, respostas, acertos e itens aguardando correção</p></div><span>${attempts.length} tentativa(s)</span></div>${rows ? `<div class="response-list">${rows}</div>` : empty('Nenhuma resposta recebida ainda.', 'Simule participantes fictícios ou aguarde uma tentativa enviada por uma conta de aluno.', '', '✓')}</section>`;
}

function reviewedAttemptScoresFor(attempt) {
  return (attempt.answers || []).reduce((totals, answer) => {
    if (answer.manual && !attempt.gradedAt) return totals;
    totals.possible += Number(answer.points) || 0;
    totals.earned += answer.manual ? Number(answer.manualScore) || 0 : answer.correct ? Number(answer.points) || 0 : 0;
    return totals;
  }, { earned: 0, possible: 0 });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)} min ${total % 60}s`;
}

function dateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : '';
}

function renderResultCharts(container) {
  const exercise = getExercise(resultsExerciseId);
  if (!exercise) return;
  const attempts = model.attempts.filter(attempt => attempt.exerciseId === exercise.id);
  const demoAttempts = attempts.filter(attempt => attempt.isDemo);
  const responders = new Set(demoAttempts.map(attempt => attempt.demoParticipantId).filter(Boolean)).size;
  const reviewed = attempts.flatMap(attempt => (attempt.answers || [])
    .filter(answer => !(answer.manual && !attempt.gradedAt))
    .map(answer => ({ ...answer, attempt })));
  const correct = reviewed.filter(answer => answer.correct === true).length;
  const incorrect = reviewed.length - correct;
  const pending = attempts.reduce((count, attempt) => count + (attempt.answers || []).filter(answer => answer.manual && !attempt.gradedAt).length, 0);
  const questions = exercise.questions.map((question, index) => {
    const responses = attempts.flatMap(attempt => (attempt.answers || [])
      .filter(answer => answer.questionId === question.id)
      .map(answer => ({ answer, attempt })));
    const waiting = responses.filter(item => item.answer.manual && !item.attempt.gradedAt).length;
    const evaluated = responses.filter(item => !(item.answer.manual && !item.attempt.gradedAt));
    const gotRight = evaluated.filter(item => item.answer.correct === true).length;
    return { label: `Q${index + 1}`, correct: gotRight, incorrect: evaluated.length - gotRight, pending: waiting };
  });
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#17233b';
  const grid = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#e4e9f2';
  if (!window.Chart) {
    container.querySelectorAll('.chart-wrap').forEach(chart => { chart.innerHTML = '<p class="chart-empty">O gráfico não carregou. Verifique a instalação local de Chart.js e recarregue a página.</p>'; });
    toast('Chart.js não está disponível. Confira as dependências locais.', 'error');
    return;
  }
  const create = (id, config) => {
    const canvas = container.querySelector(`#${id}`);
    if (canvas) charts.push(new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, color, plugins: { legend: { labels: { color } } }, ...config.options } }));
  };
  create('participation-chart', {
    type: 'doughnut',
    data: { labels: ['Responderam', 'Não responderam'], datasets: [{ data: [responders, Math.max(0, demoParticipants.length - responders)], backgroundColor: ['#1452df', '#dce4f1'], borderWidth: 0 }] },
    options: { cutout: '68%' }
  });
  create('review-chart', {
    type: 'doughnut',
    data: { labels: ['Corretas', 'Incorretas', 'Aguardando correção'], datasets: [{ data: [correct, incorrect, pending], backgroundColor: ['#1452df', '#73a0ff', '#9bbcff'], borderWidth: 0 }] },
    options: { cutout: '68%' }
  });
  create('question-chart', {
    type: 'bar',
    data: {
      labels: questions.map(item => item.label),
      datasets: [
        { label: 'Corretas', data: questions.map(item => item.correct), backgroundColor: '#1452df', borderRadius: 5 },
        { label: 'Incorretas', data: questions.map(item => item.incorrect), backgroundColor: '#73a0ff', borderRadius: 5 },
        { label: 'Pendentes', data: questions.map(item => item.pending), backgroundColor: '#9bbcff', borderRadius: 5 }
      ]
    },
    options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { color } }, y: { stacked: true, beginAtZero: true, ticks: { color, precision: 0 }, grid: { color } } } }
  });
  const timeline = attempts.filter(attempt => !attempt.isDemo)
    .map(attempt => ({ attempt, score: reviewedAttemptScoresFor(attempt) }))
    .filter(item => item.score.possible > 0)
    .sort((a, b) => String(a.attempt.createdAt || '').localeCompare(String(b.attempt.createdAt || '')));
  create('timeline-chart', {
    type: 'line',
    data: {
      labels: timeline.map((item, index) => `${index + 1} · ${new Date(item.attempt.createdAt).toLocaleDateString('pt-BR')}`),
      datasets: [{ label: 'Aproveitamento (%)', data: timeline.map(item => Math.round(item.score.earned / item.score.possible * 100)), borderColor: '#1452df', backgroundColor: 'rgba(20,82,223,.12)', fill: true, tension: .3, pointRadius: 4 }]
    },
    options: { scales: { x: { ticks: { color }, grid: { display: false } }, y: { min: 0, max: 100, ticks: { color, callback: value => `${value}%` }, grid: { color } } } }
  });
}

function chordDemoAnswer(question, makeCorrect) {
  let notes = question.assemblyOrder?.length ? [...question.assemblyOrder] : [...(question.expectedNotes || [])];
  if (!notes.length && question.correctionCriterion === 'intervals') {
    const intervals = question.expectedIntervals || [];
    if (intervals.length) {
      const midiNotes = [60];
      for (const interval of intervals.slice(0, -1)) midiNotes.push(midiNotes[midiNotes.length - 1] + interval);
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      notes = midiNotes.map(note => `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`);
    }
  }
  if (makeCorrect) return notes;
  if (!notes.length) return ['C4'];
  const last = parseCurrentNote(notes[notes.length - 1]);
  const replacement = Number.isFinite(last) ? last + 1 : 61;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  notes[notes.length - 1] = `${names[((replacement % 12) + 12) % 12]}${Math.floor(replacement / 12) - 1}`;
  return notes;
}

function demoAnswer(question, makeCorrect, participantIndex, questionIndex) {
  if (question.type === 'choice') {
    if (makeCorrect) return question.answer;
    return question.options.find(option => option !== question.answer) || question.answer;
  }
  if (question.type === 'boolean') return makeCorrect ? question.answer : question.answer === 'Verdadeiro' ? 'Falso' : 'Verdadeiro';
  if (question.type === 'chord') return chordDemoAnswer(question, makeCorrect);
  if (question.type === 'material' || question.manual || !question.answer) return `Resposta de demonstração ${participantIndex + 1}, questão ${questionIndex + 1}.`;
  if (makeCorrect) return question.answer;
  return (question.acceptedAnswers || []).find(answer => normalizeAnswer(answer) !== normalizeAnswer(question.answer))
    || `Resposta incorreta de demonstração ${participantIndex + 1}.`;
}

function simulateDemoResponses(exercise) {
  const previous = model.attempts;
  model.attempts = model.attempts.filter(attempt => !(attempt.exerciseId === exercise.id && attempt.isDemo));
  for (const [participantIndex, participant] of demoParticipants.entries()) {
    const answers = [];
    let score = 0;
    let maxScore = 0;
    exercise.questions.forEach((question, questionIndex) => {
      const points = Math.max(0, Number(question.points) || 0);
      maxScore += points;
      const value = demoAnswer(question, (participantIndex + questionIndex) % 4 !== 0, participantIndex, questionIndex);
      const match = answerMatches(question, value);
      const manual = match === null;
      if (match) score += points;
      answers.push({ questionId: question.id, prompt: question.prompt, points, value, correct: Boolean(match), manual, manualScore: 0 });
    });
    model.attempts.push({
      id: createId(), exerciseId: exercise.id, profileName: participant.name, demoParticipantId: participant.id,
      isDemo: true, answers, score, maxScore, createdAt: new Date().toISOString()
    });
  }
  try {
    model = saveModel(model);
    resultsExerciseId = exercise.id;
    render();
    toast('Cinco respostas fictícias foram geradas para demonstração.');
  } catch (error) {
    model.attempts = previous;
    toast(error.message, 'error');
  }
}

function clearDemoResponses(exercise) {
  const previous = model.attempts;
  model.attempts = model.attempts.filter(attempt => !(attempt.exerciseId === exercise.id && attempt.isDemo));
  try {
    model = saveModel(model);
    render();
    toast('Respostas de demonstração removidas. Respostas locais reais foram preservadas.');
  } catch (error) {
    model.attempts = previous;
    toast(error.message, 'error');
  }
}

function renderOnlineStudentProfile(studentId) {
  const student = studentsCache.find(item => item.id === studentId);
  if (!student) return empty('Aluno não encontrado.', 'Atualize a lista de alunos para tentar novamente.', button('Voltar aos alunos', 'open-students', 'primary'), '♙');
  const attempts = (model.attempts || []).filter(attempt => !attempt.isDemo && attempt.studentId === student.id);
  const attemptsByExercise = attempts.map(attempt => ({
    attempt,
    exercise: getExercise(attempt.exerciseId)
  })).sort((a, b) => String(b.attempt.createdAt || '').localeCompare(String(a.attempt.createdAt || '')));
  const corrected = attemptsByExercise.reduce((total, item) => {
    const score = reviewedAttemptScoresFor(item.attempt);
    total.earned += score.earned;
    total.possible += score.possible;
    return total;
  }, { earned: 0, possible: 0 });
  const average = corrected.possible ? `${Math.round(corrected.earned / corrected.possible * 100)}%` : '—';
  const pending = attempts.reduce((total, attempt) =>
    total + (attempt.gradedAt ? 0 : (attempt.answers || []).filter(answer => answer.manual).length), 0);
  const createdAt = student.createdAt ? new Date(student.createdAt).toLocaleString('pt-BR') : 'Data não registrada';
  const lastSeenAt = student.lastSeenAt ? new Date(student.lastSeenAt).toLocaleString('pt-BR') : 'Nunca visto';
  const activity = attemptsByExercise.length
    ? `<div class="profile-activity-list">${attemptsByExercise.map(({ attempt, exercise }) => {
        const score = reviewedAttemptScoresFor(attempt);
        return `<article class="profile-activity-item"><div><span class="status-tag ${attempt.gradedAt || attempt.reviewedAt ? 'completed' : 'draft'}">${attempt.gradedAt || attempt.reviewedAt ? 'Corrigida' : 'Aguardando correção'}</span><h3>${esc(exercise?.title || 'Atividade removida')}</h3><p>${new Date(attempt.createdAt).toLocaleString('pt-BR')} · ${attempt.durationSeconds ? formatDuration(attempt.durationSeconds) : 'duração não registrada'}</p></div><strong>${score.possible ? `${score.earned}/${score.possible} pts` : `${Number(attempt.score) || 0} pts`}</strong><button type="button" class="button secondary small-button" data-action="open-student-attempt" data-id="${esc(student.id)}" data-exercise-id="${esc(attempt.exerciseId)}">Abrir respostas</button></article>`;
      }).join('')}</div>`
    : '<p class="profile-empty-copy">Este aluno ainda não enviou respostas.</p>';
  return `<button type="button" class="button secondary" data-action="back-student-list">← Voltar aos alunos</button><section class="profile-hero"><span class="student-avatar profile-avatar-large">${esc((student.name || 'A').slice(0, 1).toUpperCase())}</span><div class="profile-hero-copy"><p class="eyebrow">PERFIL DO ALUNO</p><h2>${esc(student.name)}</h2><p class="profile-handle">@${esc(student.username)} · Conta autenticada</p><small>Conta criada em ${esc(createdAt)}</small></div></section><section class="results-kpis student-profile-kpis"><article><span>Tentativas enviadas</span><strong>${attempts.length}</strong><small>Atividades respondidas</small></article><article><span>Aproveitamento</span><strong>${average}</strong><small>Correções disponíveis</small></article><article><span>Pendências</span><strong>${pending}</strong><small>Questões aguardando correção</small></article><article><span>Último acesso</span><strong>${esc(lastSeenAt)}</strong><small>${esc(studentPresenceLabel(student.lastSeenAt, student.online))}</small></article></section><section class="profile-panel"><div class="section-heading"><div><p class="eyebrow">ATIVIDADES</p><h2>Respostas enviadas</h2></div><span class="status-tag ${attempts.length ? 'completed' : 'draft'}">${attempts.length} ${attempts.length === 1 ? 'tentativa' : 'tentativas'}</span></div>${activity}</section>`;
}

function renderSettings() {
  const profile = currentProfile();
  const ownAttempts = model.attempts.filter(attempt => !attempt.isDemo && (accountSession
    ? accountSession.role === 'student' && attempt.studentId === accountSession.id
    : attempt.profileName === profile.displayName));
  const header = pageHeading(accountSession ? 'CONTA ONLINE' : 'PERFIL', 'Meu perfil', accountSession ? 'Edite seu nome de exibição e nome de usuário da conta.' : 'Edite suas informações da conta.', '');
  const hero = `<section class="profile-hero">${profileAvatar(profile)}<div class="profile-hero-copy"><p class="eyebrow">${accountSession ? 'CONTA DO NOTARIUM' : 'PERFIL DESTE NAVEGADOR'}</p><h2>${esc(profile.displayName)}</h2><p class="profile-handle">${profile.username ? `@${esc(profile.username)}` : '@usuario-local'} <span>· Perfil público · ${accountSession ? 'conta autenticada' : 'demonstração local'}</span></p><p>${esc(profile.bio || 'Ainda sem biografia. Edite seu perfil para contar um pouco sobre sua jornada musical.')}</p><small>${profile.role === 'teacher' ? 'Professor' : 'Aluno'} · ${accountSession ? 'conta online' : 'visto somente nesta instalação'}</small></div></section>`;
  if (selectedProfileId) return `${header}${renderMemberProfile(selectedProfileId)}<section class="profile-demo-note">Perfis, relações e estados desta área são fictícios. Nenhuma mensagem, presença ou permissão é transmitida ou verificada por um servidor.</section>`;
  const tabMarkup = '';
  let section = '';
  if (profileTab === 'profile') {
    const activity = ownAttempts.length
      ? `<ul class="profile-activity-list">${ownAttempts.slice(-5).reverse().map(attempt => `<li><span>♫</span><div><strong>${esc(getExercise(attempt.exerciseId)?.title || 'Exercício removido')}</strong><small>${Number(attempt.score) || 0} pts · ${new Date(attempt.createdAt).toLocaleString('pt-BR')}</small></div></li>`).join('')}</ul>`
      : '<p class="profile-empty-copy">Nenhuma atividade concluída foi encontrada nesta conta.</p>';
    const roleControl = accountSession
      ? `<div class="profile-public-note">Função da conta: ${profile.role === 'teacher' ? 'Professor' : 'Aluno'}. Ela é definida pelo acesso online e não pode ser alterada pelo perfil.</div>`
      : `<label class="field-label">Visualizar como<select name="role"><option value="teacher" ${profile.role === 'teacher' ? 'selected' : ''}>Professor — criar e organizar conteúdo</option><option value="student" ${profile.role === 'student' ? 'selected' : ''}>Aluno — ver conteúdo publicado e praticar</option></select></label>`;
    section = `<div class="profile-content-grid"><section class="profile-panel"><div class="section-heading"><div><p class="eyebrow">INFORMAÇÕES PESSOAIS</p><h2>Editar perfil</h2></div></div><form id="profile-form" class="stack-form profile-edit-form"><label class="field-label">Foto ou avatar<input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"><small class="form-help">PNG, JPEG ou WebP; até 5 MB. ${accountSession ? 'O arquivo permanece neste navegador.' : 'A imagem é reduzida antes de ser guardada.'}</small></label><div class="profile-avatar-preview">${profileAvatar(profile)}<div><strong>Prévia do avatar</strong><small>Escolha uma imagem ou mantenha as iniciais.</small></div>${profile.avatarDataUrl ? button('Remover foto', 'clear-avatar', 'secondary', 'data-form-input="avatarFile"') : ''}</div><label class="field-label">Nome de exibição<input name="displayName" maxlength="60" required value="${esc(profile.displayName)}"></label><label class="field-label">Nome de usuário${accountSession ? '' : ' local'}<input name="username" maxlength="30" ${accountSession ? 'minlength="3" required' : ''} value="${esc(profile.username)}" placeholder="ex.: nome.usuario"><small class="form-help">Sem espaços; o @ é exibido automaticamente. ${accountSession ? 'Este é o usuário usado para entrar.' : 'Válido neste navegador.'}</small></label><label class="field-label">Biografia<textarea name="bio" maxlength="500" rows="3" placeholder="Conte sobre seus estudos musicais">${esc(profile.bio || '')}</textarea></label><div class="profile-public-note">Seu perfil é público para manter a colaboração e a visualização das trilhas.</div>${roleControl}<small class="profile-form-error" data-profile-error role="status"></small><button class="button primary" type="submit">Salvar alterações do perfil</button></form><small class="privacy-note">${accountSession ? 'Nome e usuário são atualizados na conta do servidor. Avatar e biografia permanecem neste navegador.' : 'O perfil e os dados permanecem neste navegador; não há contas autenticadas nem sincronização em nuvem.'}</small></section><div class="profile-side-column"><section class="profile-panel"><p class="eyebrow">ATIVIDADE MUSICAL</p><h2>Suas atividades</h2>${activity}</section><section class="profile-panel"><p class="eyebrow">PUBLICAÇÕES</p><h2>Nenhuma publicação</h2><p class="profile-empty-copy">A aplicação local ainda não tem um mural de publicações.</p></section></div></div>`;
  } else {
    section = '';
  }
  return `${header}${hero}${accountSession ? `<div class="profile-page-actions">${button('Sair da conta', 'logout', 'danger')}</div>` : ''}${tabMarkup}${section}`;
}

function renderConfigurations() {
  const clickNote = localStorage.getItem('notarium-click-note') || 'C5';
  const clickVolume = Math.min(300, Math.max(80, Number(localStorage.getItem('notarium-click-volume')) || 300));
  const clickNotes = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'].map(note => `<option value="${note}" ${clickNote === note ? 'selected' : ''}>${note} · ${formatNote(parseCurrentNote(note))}</option>`).join('');
  const octaveOptions = Array.from({ length: 10 }, (_, index) => index - 1)
    .map(octave => `<option value="${octave}" ${defaultOctave() === octave ? 'selected' : ''}>Oitava ${octave} · C${octave}</option>`).join('');
  const theme = currentProfile().theme === 'dark' ? 'dark' : 'light';
  return `${pageHeading('PREFERÊNCIAS', 'Configurações', 'Acessibilidade, aparência e sons em um só lugar.', '')}
    <div class="settings-grid"><section class="settings-card"><p class="eyebrow">ACESSIBILIDADE E APARÊNCIA</p><h2>Personalize seu espaço</h2>
      <label class="field-label">Tema<select id="theme-preference"><option value="light" ${theme === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Escuro</option></select></label>
      <label class="field-label">Oitava padrão para notas digitadas<select id="default-octave-preference">${octaveOptions}</select></label>
      <label class="checkbox-line"><input id="click-sounds-toggle" type="checkbox" ${soundEnabled() ? 'checked' : ''}> Tocar uma nota ao clicar</label>
      <label class="field-label">Nota do clique<select id="click-sound-note">${clickNotes}</select></label>
      <label class="field-label">Volume do clique <output id="click-volume-output">${clickVolume}%</output><input id="click-sound-volume" type="range" min="80" max="300" step="10" value="${clickVolume}"></label>
      <p class="form-help">O som de notificações permanece fixo e independente do som de clique.</p></section>
      <section class="settings-card"><p class="eyebrow">SALVAMENTO AUTOMÁTICO</p><h2>Conta online</h2><p>Conteúdo, respostas, alunos e avaliações são sincronizados automaticamente e salvos no servidor.</p><small class="privacy-note">Não há opções de cópia de segurança nesta tela.</small></section></div>`;
}

function renderAccountLogin() {
  const setup = accountSetupNeeded;
  return `<main class="account-login-page"><section class="account-login-card"><img class="account-login-logo" src="icone.png" alt=""><p class="eyebrow">NOTARIUM · ACESSO ONLINE</p><h1>${setup ? 'Configure sua conta de professor' : 'Entre na sua conta'}</h1><p class="page-description">${setup ? 'Crie a primeira conta para administrar a turma e cadastrar acessos individuais para seus alunos.' : 'Use o usuário e a senha que o professor criou para você.'}</p><form id="account-access-form" class="stack-form account-access-form">${setup ? `<label class="field-label">Nome de exibição<input name="name" maxlength="60" required autocomplete="name" placeholder="Como você será identificado"></label>` : ''}<label class="field-label">Nome de usuário<input name="username" minlength="3" maxlength="30" required autocomplete="username" placeholder="ex.: ana.silva"></label><label class="field-label">Senha<input name="password" type="password" minlength="${setup ? '10' : '1'}" maxlength="256" required autocomplete="${setup ? 'new-password' : 'current-password'}"></label>${setup ? '<small class="form-help">Use de 3 a 30 caracteres no usuário e uma senha de pelo menos 10 caracteres.</small>' : ''}<p class="account-form-error" role="alert">${esc(accountError || accountNotice)}</p><button class="button primary" type="submit">${setup ? 'Criar conta de professor' : 'Entrar'}</button></form><small class="privacy-note">As contas são armazenadas automaticamente no servidor. O acesso exige uma conta válida.</small></section></main>`;
}

function renderStudents() {
  const heading = pageHeading('GESTÃO DA TURMA', 'Alunos', 'Crie acessos individuais e acompanhe quem pode entrar no Notarium.', '');
  if (!accountSession) {
    return `${heading}<section class="account-info-card"><span class="account-info-icon">${icons.group}</span><div><h2>Contas online do professor e dos alunos</h2><p>Configure a primeira conta de professor ou entre em uma conta existente. Depois, crie um usuário e uma senha para cada aluno.</p><small>Requer o servidor Notarium ativo. As contas não são criadas no modo de demonstração local.</small><div class="settings-actions">${button('Configurar ou entrar online', 'account-login', 'primary')}</div></div></section>`;
  }
  if (accountSession.role !== 'teacher') {
    return `${heading}${empty('Acesso reservado ao professor.', 'Entre com a conta de professor para criar e administrar os acessos dos alunos.', button('Trocar de conta', 'logout', 'primary'), '♙')}`;
  }
  const portal = accountPortalUrl || `${location.origin}${location.pathname}?login=1`;
  const created = lastCreatedStudentAccess
    ? `<section class="created-access-card"><div><p class="eyebrow">ACESSO CRIADO · COMPARTILHE UMA ÚNICA VEZ</p><h2>${esc(lastCreatedStudentAccess.name)}</h2><p>Envie este endereço e as credenciais diretamente ao aluno. A senha não é exibida novamente depois que você sair desta página.</p><dl><div><dt>Endereço</dt><dd><a href="${esc(lastCreatedStudentAccess.portalUrl)}">${esc(lastCreatedStudentAccess.portalUrl)}</a></dd></div><div><dt>Usuário</dt><dd>${esc(lastCreatedStudentAccess.username)}</dd></div><div><dt>Senha inicial</dt><dd>${esc(lastCreatedStudentAccess.password)}</dd></div></dl><button type="button" class="button secondary" data-action="copy-student-access">Copiar dados de acesso</button></div><button type="button" class="icon-button" data-action="dismiss-student-access" aria-label="Ocultar credenciais">×</button></section>`
    : '';
  const students = studentsCache.length
    ? `<div class="student-account-list">${studentsCache.map(student => {
        const created = student.createdAt && !Number.isNaN(new Date(student.createdAt).getTime())
          ? new Date(student.createdAt).toLocaleDateString('pt-BR')
          : 'data não registrada';
        return `<article class="student-account-card"><button type="button" class="student-account-profile" data-action="open-online-student" data-id="${esc(student.id)}"><span class="student-avatar">${esc((student.name || 'A').slice(0, 1).toUpperCase())}</span><div class="student-account-copy"><strong>${esc(student.name)}</strong><small>@${esc(student.username)} · ${studentPresenceLabel(student.lastSeenAt, student.online)}</small><small>Conta criada em ${esc(created)}</small></div></button><div class="student-account-actions"><button type="button" class="button secondary small-button" data-action="edit-student" data-id="${esc(student.id)}">Editar</button><button type="button" class="button danger small-button" data-action="remove-student" data-id="${esc(student.id)}">Remover</button></div></article>`;
      }).join('')}</div>`
    : '<div class="student-list-empty"><strong>Nenhum aluno cadastrado ainda.</strong><p>Crie o primeiro acesso pelo formulário ao lado.</p></div>';
  return `${heading}<section class="account-portal-card"><div><p class="eyebrow">PORTAL DOS ALUNOS</p><h2>Compartilhe o endereço do Notarium</h2><p>Os alunos entram com o nome de usuário e a senha que você criar abaixo.</p><code>${esc(portal)}</code></div><button type="button" class="button secondary" data-action="copy-portal-link">Copiar endereço</button></section>${created}<div class="student-management-grid"><section class="profile-panel"><p class="eyebrow">NOVO ACESSO</p><h2>Criar aluno</h2><p>O nome é exibido no perfil. O nome de usuário é separado e será usado para entrar.</p><form id="student-create-form" class="stack-form"><label class="field-label">Nome de exibição<input name="name" maxlength="60" required autocomplete="name" placeholder="Nome do aluno"></label><label class="field-label">Nome de usuário<input name="username" minlength="3" maxlength="30"   pattern="[A-Za-z0-9._\\-]{3,30}" required autocomplete="off" placeholder="ex.: maria.silva"><small class="form-help">De 3 a 30 caracteres; use letras, números, ponto, traço ou sublinhado.</small></label><label class="field-label">Senha inicial<input name="password" type="password" minlength="10" maxlength="256" required autocomplete="new-password"><small class="form-help">No mínimo 10 caracteres. Ela será mostrada uma vez para você compartilhar.</small></label><p class="account-form-error" data-student-error role="alert"></p><button class="button primary" type="submit">Criar acesso</button></form></section><section class="profile-panel"><div class="student-list-heading"><div><p class="eyebrow">CONTAS DA TURMA</p><h2>Alunos cadastrados <span class="count-pill">${studentsCache.length}</span></h2></div><button type="button" class="button secondary small-button" data-action="refresh-students">Atualizar</button></div>${students}</section></div><div class="settings-actions">${button('Sair / trocar de conta', 'logout', 'secondary')}</div>`;
}

function openQuickSettings() {
  const theme = currentProfile().theme === 'dark' ? 'dark' : 'light';
  openDialog(`<section class="accessibility-settings"><p class="eyebrow">ACESSIBILIDADE</p><h2>Preferências de acessibilidade</h2><p class="dialog-intro">Ajuste o tema da tela e o som dos cliques.</p><label class="field-label">Tema da tela<select id="quick-theme-preference"><option value="light" ${theme === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Escuro</option></select></label><label class="checkbox-line"><input id="quick-click-sounds-toggle" type="checkbox" ${soundEnabled() ? 'checked' : ''}> Tocar som ao clicar</label><div class="quick-settings-actions">${button('Todas as configurações', 'open-configurations', 'secondary')}</div></section>`, 'accessibility-settings-modal');
}

function toggleSettingsMenu(forceClose = false) {
  const trigger = root.querySelector('.settings-menu > [data-action="settings"]');
  const menu = root.querySelector('#settings-menu-panel');
  if (!trigger || !menu) return;
  const open = !forceClose && menu.hidden;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
}

const welcomeQuotes = [
  { text: 'Cada voz encontra seu lugar quando escutamos com atenção.', author: 'Inspirado em Johann Sebastian Bach', period: 'Barroco' },
  { text: 'A curiosidade transforma cada estudo em uma pequena descoberta.', author: 'Inspirado em Wolfgang Amadeus Mozart', period: 'Classicismo' },
  { text: 'A persistência também é uma forma de compor.', author: 'Inspirado em Ludwig van Beethoven', period: 'Classicismo e Romantismo' },
  { text: 'Deixe a imaginação colorir cada som que você aprende.', author: 'Inspirado em Claude Debussy', period: 'Impressionismo' },
  { text: 'A música pode carregar a memória inteira de um lugar.', author: 'Inspirado em Heitor Villa-Lobos', period: 'Modernismo brasileiro' },
  { text: 'Um novo ritmo começa com a coragem de experimentar.', author: 'Inspirado em Chiquinha Gonzaga', period: 'Romantismo brasileiro' }
];

function renderActivityLoading() {
  return `<main class="activity-loading" role="status" aria-live="polite"><div class="activity-loading-mark" aria-hidden="true"><span>♪</span><span>♫</span><span>♩</span></div><p class="eyebrow">PREPARANDO A ATIVIDADE</p><h1>${esc(activityLoadingTitle || 'Organizando seu exercício')}</h1><p>Respire, ajuste o volume e prepare sua atenção.</p><div class="activity-loading-track"><span></span></div></main>`;
}

function showActivityLoading(title, callback) {
  activityLoadingTitle = title || 'Organizando seu exercício';
  view = 'activity-loading';
  render();
  clearTimeout(activityLoadingTimer);
  activityLoadingTimer = setTimeout(() => {
    try {
      callback();
    } catch (error) {
      console.error('Não foi possível abrir a atividade:', error);
      view = 'exercicios';
      render();
      toast(`Não foi possível abrir o exercício: ${error.message}`, 'error');
    }
  }, 850);
}

function renderWelcomeLoading() {
  const quote = loadingQuote || welcomeQuotes[0];
  return `<main class="welcome-loading" role="status" aria-live="polite" aria-busy="true"><div class="welcome-loading-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♬</span></div><p class="eyebrow">NOTARIUM · SEU ESPAÇO MUSICAL</p><h1>Preparando seu estúdio, ${esc(currentProfile().displayName)}...</h1><p class="welcome-loading-caption">Sincronizando sua conta e organizando sua jornada.</p><blockquote>${esc(quote.text)}</blockquote><p class="welcome-loading-author">${esc(quote.author)} <span>· ${esc(quote.period)}</span></p><div class="welcome-loading-track" aria-hidden="true"><span></span></div><small>Carregando todos os dados da sua conta</small></main>`;
}

function showLoginLoading() {
  let index = Math.floor(Math.random() * welcomeQuotes.length);
  loadingQuote = welcomeQuotes[index];
  view = 'loading';
  render();
  clearInterval(loadingQuoteTimer);
  loadingQuoteTimer = setInterval(() => {
    index = (index + 1) % welcomeQuotes.length;
    loadingQuote = welcomeQuotes[index];
    if (view === 'loading') render();
  }, 5000);
}

function finishLoginLoading() {
  clearInterval(loadingQuoteTimer);
  loadingQuoteTimer = null;
  loadingQuote = null;
}

async function showAccountLogin() {
  accountError = '';
  try {
    const setup = await accountRequest('/api/setup', {}, '');
    accountSetupNeeded = !setup.teacherExists;
  } catch (error) {
    accountSetupNeeded = false;
    accountError = error.message;
  }
  view = 'login';
  render();
}

async function establishOnlineSession(response, localModel, restoring = false) {
  if (response.token) saveAccountToken(response.token);
  accountSession = response.user;
  accountPortalUrl = response.portalUrl || `${location.origin}${location.pathname}?login=1`;
  accountError = '';
  accountNotice = '';
  notificationsCache = [];
  notificationsLoaded = false;
  showLoginLoading();
  studentsLoaded = false;
  const remoteHasContent = response.model.blocks.length + response.model.lessons.length + response.model.exercises.length > 0;
  const localHasContent = localModel.blocks.length + localModel.lessons.length + localModel.exercises.length > 0;
  const syncWarnings = [];
  if (response.user.role === 'teacher' && !remoteHasContent && localHasContent) {
    model = onlineUserModel(localModel, response.user);
    try { await accountRequest('/api/model', { method: 'PUT', body: JSON.stringify({ model }) }); }
    catch (error) { syncWarnings.push(`O conteúdo local não foi enviado: ${error.message}`); }
  } else {
    model = onlineUserModel(response.model, response.user);
  }
  model = saveModel(model);
  if (response.user.role === 'teacher') {
    learningProgress = [];
    try { await syncReferencedMedia(); }
    catch (error) { syncWarnings.push(`Alguns materiais não foram sincronizados: ${error.message}`); }
  } else {
    try {
      const progressResult = await accountRequest('/api/progress');
      learningProgress = progressResult.progress || [];
    } catch (error) {
      learningProgress = [];
      syncWarnings.push(`O histórico de aprendizagem não foi carregado: ${error.message}`);
    }
  }
  finishLoginLoading();
  view = 'inicio';
  history.replaceState(null, '', location.pathname);
  render();
  startPresenceHeartbeat();
  if (!restoring) {
    toast(syncWarnings.length
      ? `Acesso iniciado para ${response.user.name}. ${syncWarnings.join(' ')}`
      : `Acesso online iniciado para ${response.user.name}.`, syncWarnings.length ? 'error' : 'success');
  } else if (syncWarnings.length) {
    toast(`Sessão retomada para ${response.user.name}. ${syncWarnings.join(' ')}`, 'error');
  }
  flushPendingAttempts().catch(error => toast(`Não foi possível sincronizar tentativas salvas: ${error.message}`, 'error'));
}

async function startOnlineSession(endpoint, payload) {
  const localModel = JSON.parse(JSON.stringify(model));
  try {
    const response = await accountRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, '');
    await establishOnlineSession(response, localModel);
  } catch (error) {
    finishLoginLoading();
    accountError = error.message;
    view = 'login';
    render();
  }
}

async function logoutAccount() {
  if (!accountSession) {
    await showAccountLogin();
    return;
  }
  let serverLogoutFailed = false;
  try { await accountRequest('/api/auth/logout', { method: 'POST', body: '{}' }); }
  catch { serverLogoutFailed = true; }
  saveAccountToken('');
  clearInterval(presenceTimer);
  presenceTimer = null;
  accountSession = null;
  learningProgress = [];
    notificationsCache = [];
    notificationsLoaded = false;
  accountPortalUrl = '';
  studentsCache = [];
  studentsLoaded = false;
  lastCreatedStudentAccess = null;
  model.profile.role = 'teacher';
  await showAccountLogin();
  toast(serverLogoutFailed
    ? 'Sessão encerrada neste navegador. O servidor não respondeu; a sessão será descartada quando ele reiniciar.'
    : 'Sessão encerrada. Entre novamente com sua conta.');
}

async function refreshStudents() {
  try {
    const result = await accountRequest('/api/students');
    studentsCache = result.students;
    studentsLoaded = true;
    render();
    toast('Lista de alunos atualizada.');
  } catch (error) { toast(error.message, 'error'); }
}

function releaseStudentMarkup(fieldName, selectedIds = []) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const options = studentsCache.map(student =>
    `<label class="checkbox-line"><input type="checkbox" name="${esc(fieldName)}" value="${esc(student.id)}" ${selected.has(student.id) ? 'checked' : ''}><span><strong>${esc(student.name)}</strong><small>${esc(student.username)}</small></span></label>`
  ).join('');
  const emptyMessage = studentsLoaded
    ? 'Nenhum aluno cadastrado. Cadastre contas em Alunos.'
    : 'Carregando a lista de alunos...';
  return `<div class="release-student-list" data-release-list="${esc(fieldName)}">${options || `<p class="muted small">${emptyMessage}</p>`}</div>`;
}

function releaseSettingsMarkup(item, prefix) {
  const fieldName = `${prefix}StudentIds`;
  const mode = item?.releaseMode === 'selected' ? 'selected' : 'all';
  return `<section class="builder-section release-settings"><div class="builder-heading"><div><h3>Liberação para alunos</h3><p>Escolha quem pode acessar. Uma liberação específica na aula ou atividade pode abrir aquele item mesmo se o bloco estiver bloqueado.</p></div></div><label class="field-label">Quem pode acessar?<select name="releaseMode"><option value="all" ${mode === 'all' ? 'selected' : ''}>Todos os alunos (respeitando o bloco)</option><option value="selected" ${mode === 'selected' ? 'selected' : ''}>Somente alunos selecionados</option></select></label>${releaseStudentMarkup(fieldName, item?.releasedStudentIds)}</section>`;
}

async function loadStudentsForRelease(dialog, listName) {
  if (accountSession?.role !== 'teacher') return;
  studentsLoaded = false;
  try {
    const result = await accountRequest('/api/students');
    studentsCache = result.students;
    studentsLoaded = true;
    const list = dialog.querySelector(`[data-release-list="${listName}"]`);
    const checked = new Set([...dialog.querySelectorAll(`[name="${listName}"]:checked`)].map(input => input.value));
    if (list) {
      list.innerHTML = studentsCache.map(student =>
        `<label class="checkbox-line"><input type="checkbox" name="${esc(listName)}" value="${esc(student.id)}" ${checked.has(student.id) ? 'checked' : ''}><span><strong>${esc(student.name)}</strong><small>${esc(student.username)}</small></span></label>`
      ).join('') || '<p class="muted small">Nenhum aluno cadastrado. Cadastre contas em Alunos.</p>';
    }
  } catch (error) {
    studentsLoaded = false;
    const list = dialog.querySelector(`[data-release-list="${listName}"]`);
    if (list) list.innerHTML = `<p class="muted small">${esc(error.message)}</p>`;
  }
}

function studentPresenceLabel(lastSeenAt, online = false) {
  if (!lastSeenAt) return 'ainda não entrou';
  const timestamp = new Date(lastSeenAt);
  if (!Number.isFinite(timestamp.getTime())) return 'presença não informada';
  return online ? 'online agora' : `visto por último ${timestamp.toLocaleString('pt-BR')}`;
}

async function refreshNotifications(redraw = true) {
  if (!accountSession) return [];
  const previousIds = new Set(notificationsCache.map(item => item.id));
  const shouldNotify = notificationsLoaded;
  const result = await accountRequest('/api/notifications');
  notificationsCache = result.notifications || [];
  notificationsLoaded = true;
  if (shouldNotify && notificationsCache.some(item => !item.readAt && !previousIds.has(item.id))) playNotificationSound();
  updateNotificationBadge();
  if (redraw) render();
  return notificationsCache;
}

function updateNotificationBadge() {
  const nav = root.querySelector('.primary-nav [data-view="notificacoes"]');
  if (!nav) return;
  const count = notificationsCache.filter(item => !item.readAt).length;
  let badge = nav.querySelector('.notification-count');
  if (!count) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'notification-count';
    nav.append(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
}

async function refreshStudentContent({ redraw = true } = {}) {
  if (accountSession?.role !== 'student') return false;
  if (studentContentRefreshPromise) return studentContentRefreshPromise;
  studentContentRefreshPromise = (async () => {
    try {
      const result = await accountRequest('/api/model');
      const nextModel = onlineUserModel(result.model, accountSession);
      if (JSON.stringify(nextModel) === JSON.stringify(model)) {
        studentContentRefreshWarningShown = false;
        return false;
      }
      model = saveModel(nextModel);
      studentContentRefreshWarningShown = false;
      if (redraw && !root.querySelector('#active-dialog, #exercise-attempt')) render();
      return true;
    } catch (error) {
      if (!studentContentRefreshWarningShown) {
        toast(`Não foi possível atualizar o conteúdo liberado: ${error.message}`, 'error');
        studentContentRefreshWarningShown = true;
      }
      return false;
    } finally {
      studentContentRefreshPromise = null;
    }
  })();
  return studentContentRefreshPromise;
}

function startPresenceHeartbeat() {
  clearInterval(presenceTimer);
  if (!accountSession) return;
  const updatePresence = async () => {
    try { await accountRequest('/api/presence', { method: 'POST', body: '{}' }); } catch { }
    await refreshStudentContent();
    try {
      await refreshNotifications(false);
      if (view === 'notificacoes') render();
    } catch { }
  };
  updatePresence();
  presenceTimer = setInterval(updatePresence, 45_000);
}

window.addEventListener('focus', () => {
  if (document.visibilityState === 'visible') refreshStudentContent();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshStudentContent();
});

async function openNotification(id) {
  const notification = notificationsCache.find(item => item.id === id);
  if (!notification || !accountSession) return;
  if (!notification.readAt) {
    try {
      const result = await accountRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' });
      notification.readAt = result.notification.readAt;
      await refreshNotifications(false);
    } catch (error) { toast(error.message, 'error'); }
  }
  const refreshContent = async () => {
    const result = await accountRequest('/api/model');
    model = saveModel(onlineUserModel(result.model, accountSession));
  };
  if (notification.type === 'response-submitted' && accountSession.role === 'teacher') {
    try {
      const result = await accountRequest('/api/model');
      model = saveModel(onlineUserModel(result.model, accountSession));
      resultsExerciseId = notification.exerciseId;
      navigate('resultados');
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'response-reviewed' && notification.exerciseId) {
    try {
      await refreshContent();
      activeExerciseId = notification.exerciseId;
      navigate('exercicio');
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'exam-reopen-request' && accountSession.role === 'teacher') {
    openExamReopenRequest(notification);
  } else if (notification.type === 'exam-released' && accountSession.role === 'student') {
    try {
      await refreshContent();
      openAssessment(notification.examId);
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'exam-reopened' && accountSession.role === 'student') {
    try {
      await refreshContent();
      openAssessment(notification.examId);
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'content-released' && accountSession.role === 'student') {
    try {
      await refreshContent();
      if (notification.contentKey?.startsWith('lesson:')) {
        activeLessonId = notification.contentKey.slice('lesson:'.length);
        navigate('aula');
      } else if (notification.contentKey?.startsWith('exercise:')) {
        const exerciseId = notification.contentKey.slice('exercise:'.length);
        const exercise = getExercise(exerciseId);
        if (exercise?.assessment) openAssessment(exerciseId);
        else {
          activeExerciseId = exerciseId;
          navigate('exercicio');
        }
      } else render();
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'trail-update' && accountSession.role === 'student') {
    selectedTrailStudentId = accountSession.id;
    navigate('trilha');
  } else if (notification.type === 'new-lesson' && notification.contentKey?.startsWith('lesson:')) {
    try {
      await refreshContent();
      activeLessonId = notification.contentKey.slice('lesson:'.length);
      navigate('aula');
    } catch (error) { toast(error.message, 'error'); }
  } else if (notification.type === 'new-exercise' && notification.contentKey?.startsWith('exercise:')) {
    try {
      await refreshContent();
      activeExerciseId = notification.contentKey.slice('exercise:'.length);
      navigate('exercicio');
    } catch (error) { toast(error.message, 'error'); }
  } else {
    render();
  }
}

async function markAttemptReviewed(id) {
  const attempt = model.attempts.find(item => item.id === id);
  if (!attempt) return;
  const stars = Math.min(5, Math.max(0, Number(attempt.teacherRating) || 0));
  const starOptions = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return `<label class="teacher-star-option"><input type="radio" name="teacherRating" value="${value}" ${stars === value ? 'checked' : ''}><span aria-label="${value} estrela${value === 1 ? '' : 's'}">★</span></label>`;
  }).join('');
  const dialog = openDialog(`<p class="eyebrow">AVALIAÇÃO DO PROFESSOR</p><h2>Marcar resposta como vista</h2><p class="dialog-intro">A nota por estrelas e a observação são opcionais.</p><form id="review-attempt-form" class="stack-form"><input type="hidden" name="attemptId" value="${esc(id)}"><div class="teacher-rating" role="radiogroup" aria-label="Nota de 1 a 5 estrelas">${starOptions}</div><label class="field-label">Observação opcional<textarea name="teacherNote" rows="4" maxlength="1000" placeholder="Escreva um comentário sobre a resposta">${esc(attempt.teacherNote || '')}</textarea></label><label class="field-label">Devolver arquivo ao aluno <span class="optional-label">Opcional</span><input name="teacherAttachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.zip,.mp3,.wav,.m4a,.ogg"></label><small class="form-help">Você pode enviar PDF, imagem, áudio, documento ou arquivo compactado.</small><div class="dialog-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancelar</button><button class="button primary" type="submit">Dar visto</button></div></form>`);
  const ratingInputs = [...dialog.querySelectorAll('[name="teacherRating"]')];
  const paintStars = () => {
    const selected = Number(dialog.querySelector('[name="teacherRating"]:checked')?.value || 0);
    ratingInputs.forEach(input => {
      input.nextElementSibling.style.color = Number(input.value) <= selected ? '#1452df' : '';
    });
  };
  ratingInputs.forEach(input => input.addEventListener('change', paintStars));
  paintStars();
  return dialog;
}

async function saveAttemptReview(id, rating, note, files = []) {
  const attempt = model.attempts.find(item => item.id === id);
  if (!attempt) return;
  if (accountSession?.role === 'teacher' && attempt.studentId) {
    try {
      const attachments = [];
      for (const file of files) {
        attachments.push(await saveMediaFile(file));
      }
      for (const attachment of attachments) {
        await accountRequest('/api/media', {
          method: 'POST',
          body: JSON.stringify({
            id: attachment.id,
            name: attachment.name,
            dataUrl: await mediaAsDataUrl(attachment.id)
          })
        });
      }
      const result = await accountRequest(`/api/attempts/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: JSON.stringify({
          teacherRating: rating,
          teacherNote: note,
          attachments: attachments.map(({ id, name, type, size }) => ({ id, name, type, size }))
        })
      });
      Object.assign(attempt, result.attempt);
      await refreshNotifications(false);
      render();
      toast('Resposta marcada como vista. O aluno receberá um aviso.');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  attempt.reviewedAt = new Date().toISOString();
  attempt.teacherRating = rating;
  attempt.teacherNote = note;
  persist('Resposta marcada como vista.');
}

async function openExerciseResults(id) {
  resultsExerciseId = id;
  if (accountSession?.role === 'teacher') {
    try {
      const result = await accountRequest('/api/model');
      model = saveModel(onlineUserModel(result.model, accountSession));
    } catch (error) { toast(error.message, 'error'); return; }
  }
  navigate('resultados');
}

function memberRoleLabel(role) {
  return ({ admin: 'Administrador', moderator: 'Moderador', member: 'Membro' })[role] || 'Membro';
}

function groupDemoAttempts() {
  const memberIds = new Set(demoGroup.memberIds);
  const exerciseIds = new Set(visibleExercises().map(exercise => exercise.id));
  return model.attempts.filter(attempt => attempt.isDemo
    && memberIds.has(attempt.demoParticipantId)
    && exerciseIds.has(attempt.exerciseId));
}

function groupMemberProgress(memberId, attempts = groupDemoAttempts()) {
  const memberAttempts = attempts.filter(attempt => attempt.demoParticipantId === memberId);
  const totals = memberAttempts.reduce((result, attempt) => {
    const score = reviewedAttemptScoresFor(attempt);
    result.earned += score.earned;
    result.possible += score.possible;
    result.pending += (attempt.answers || []).filter(answer => answer.manual && !attempt.gradedAt).length;
    return result;
  }, { earned: 0, possible: 0, pending: 0 });
  return {
    ...totals,
    exercises: new Set(memberAttempts.map(attempt => attempt.exerciseId)).size,
    percent: totals.possible ? Math.round(totals.earned / totals.possible * 100) : null
  };
}

function groupMemberCard(member, attempts) {
  const progress = groupMemberProgress(member.id, attempts);
  const presenceLabel = ({ online: 'Online', away: 'Ausente', offline: 'Offline' })[member.presence] || 'Offline';
  const progressMarkup = progress.percent === null
    ? '<p class="group-member-progress-empty">Sem respostas corrigidas registradas.</p>'
    : `<div class="group-member-progress"><div><span>Progresso corrigido</span><strong>${progress.percent}%</strong></div><div class="group-progress-track" role="progressbar" aria-label="Progresso corrigido de ${esc(member.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><span style="width:${progress.percent}%"></span></div></div>`;
  const detail = member.bio;
  return `<article class="member-card group-member-card" data-member-id="${member.id}" data-presence="${member.presence}" data-group-role="${member.groupRole}" data-member-name="${esc(member.name.toLocaleLowerCase('pt-BR'))}"><div class="member-card-head"><button class="member-profile-trigger" type="button" data-action="open-member" data-member-id="${member.id}">${profileAvatar(member, true)}<span><strong>${esc(member.name)}</strong><small>@${esc(member.username)} · DEMO</small></span></button><span class="presence-tag ${member.presence}"><i></i>${presenceLabel} · demo</span></div><p>${esc(detail)}</p><div class="member-meta"><span>${memberRoleLabel(member.groupRole)} · grupo</span><span>${progress.exercises} ${progress.exercises === 1 ? 'exercício' : 'exercícios'}</span>${progress.pending ? `<span>${progress.pending} pendente(s)</span>` : ''}</div>${progressMarkup}<div class="member-card-actions">${button('Ver perfil', 'open-member', 'secondary small-button', `data-member-id="${member.id}"`)}</div></article>`;
}

function renderOnlineGroup() {
  const header = pageHeading('GESTÃO DA TURMA', 'Grupo', 'Acompanhe os alunos cadastrados e suas respostas reais.', '');
  if (accountSession?.role !== 'teacher') {
    return `${header}${empty('Grupo da turma', 'As informações reais da turma ficam disponíveis para o professor.', button('Voltar ao início', 'go-home', 'primary'), '♙')}`;
  }
  if (!studentsLoaded && studentsLoading) {
    return `${header}<section class="loading-card"><span class="loading-dot"></span><div><strong>Carregando os alunos</strong><p>Consultando os acessos cadastrados no servidor...</p></div></section>`;
  }
  if (!studentsLoaded) {
    return `${header}<section class="loading-card"><span class="loading-dot"></span><div><strong>Carregando os alunos</strong><p>Preparando os dados reais da turma...</p></div></section>`;
  }
  const attempts = (model.attempts || []).filter(attempt => !attempt.isDemo && attempt.studentId);
  const members = studentsCache.map(student => {
    const studentAttempts = attempts.filter(attempt => attempt.studentId === student.id);
    const earned = studentAttempts.reduce((sum, attempt) => sum + reviewedAttemptScoresFor(attempt).earned, 0);
    const possible = studentAttempts.reduce((sum, attempt) => sum + reviewedAttemptScoresFor(attempt).possible, 0);
    const pending = studentAttempts.reduce((sum, attempt) =>
      sum + (attempt.gradedAt ? 0 : (attempt.answers || []).filter(answer => answer.manual).length), 0);
    const percent = possible ? Math.round(earned / possible * 100) : null;
    return {
      ...student,
      attempts: studentAttempts.length,
      percent,
      pending
    };
  });
  const cards = members.length ? members.map(student => `<article class="member-card group-member-card">
    <div class="member-card-head"><span class="student-avatar">${esc((student.name || 'A').slice(0, 1).toUpperCase())}</span><span><strong>${esc(student.name)}</strong><small>@${esc(student.username)}</small></span><span class="presence-tag ${student.online ? 'online' : 'offline'}"><i></i>${esc(studentPresenceLabel(student.lastSeenAt, student.online))}</span></div>
    <div class="member-meta"><span>${student.attempts} ${student.attempts === 1 ? 'resposta' : 'respostas'}</span><span>${student.pending} pendente${student.pending === 1 ? '' : 's'}</span></div>
    ${student.percent === null ? '<p class="group-member-progress-empty">Sem respostas corrigidas registradas.</p>' : `<div class="group-member-progress"><div><span>Aproveitamento</span><strong>${student.percent}%</strong></div><div class="group-progress-track" role="progressbar" aria-label="Aproveitamento de ${esc(student.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${student.percent}"><span style="width:${student.percent}%"></span></div></div>`}
    <div class="member-card-actions">${button('Ver perfil', 'open-online-student', 'secondary small-button', `data-id="${esc(student.id)}"`)}${student.attempts ? button('Ver respostas individuais', 'open-student-responses', 'secondary small-button', `data-id="${esc(student.id)}"`) : '<span class="status-tag draft">Sem tentativas</span>'}</div>
  </article>`).join('') : `<p class="chart-empty">Nenhum aluno cadastrado. Crie os acessos da turma em <strong>Alunos</strong>.</p>`;
  const corrected = attempts.reduce((result, attempt) => {
    const score = reviewedAttemptScoresFor(attempt);
    result.earned += score.earned;
    result.possible += score.possible;
    return result;
  }, { earned: 0, possible: 0 });
  const average = corrected.possible ? `${Math.round(corrected.earned / corrected.possible * 100)}%` : '—';
  return `${header}<nav class="group-subnav" aria-label="Seções do grupo"><button type="button" data-view="grupo" aria-current="page">Visão da turma</button><button type="button" data-view="resultados">Respostas</button><button type="button" data-view="alunos">Alunos</button></nav><section class="results-kpis group-kpis"><article><span>Alunos cadastrados</span><strong>${members.length}</strong><small>Contas reais</small></article><article><span>Respostas recebidas</span><strong>${attempts.length}</strong><small>Atividades do servidor</small></article><article><span>Aproveitamento corrigido</span><strong>${average}</strong><small>${corrected.possible ? `${corrected.earned}/${corrected.possible} pontos` : 'Sem respostas corrigidas'}</small></article></section><section class="profile-panel"><div class="section-heading"><div><p class="eyebrow">CONTAS DA TURMA</p><h2>Alunos</h2></div>${button('Gerenciar acessos', 'open-students', 'secondary small-button')}</div><div class="member-grid group-member-grid">${cards}</div></section>`;
}

function renderGroup() {
  if (accountSession) {
    return renderOnlineGroup();
  }
  const members = demoMembers.filter(member => demoGroup.memberIds.includes(member.id));
  const attempts = groupDemoAttempts();
  const responders = new Set(attempts.map(attempt => attempt.demoParticipantId));
  const answers = attempts.flatMap(attempt => (attempt.answers || []).map(answer => ({ answer, attempt })));
  const pending = answers.filter(item => item.answer.manual && !item.attempt.gradedAt).length;
  const reviewed = answers.filter(item => !(item.answer.manual && !item.attempt.gradedAt));
  const correct = reviewed.filter(item => item.answer.correct === true).length;
  const incorrect = reviewed.length - correct;
  const totals = attempts.reduce((result, attempt) => {
    const score = reviewedAttemptScoresFor(attempt);
    result.earned += score.earned;
    result.possible += score.possible;
    return result;
  }, { earned: 0, possible: 0 });
  const average = totals.possible ? `${Math.round(totals.earned / totals.possible * 100)}%` : '—';
  const exerciseCount = visibleExercises().length;
  const memberCards = members.map(member => groupMemberCard(member, attempts)).join('');
  const header = pageHeading('GRUPO · DEMONSTRAÇÃO', 'Grupo', demoGroup.description, '');
  const tabs = `<nav class="group-subnav" aria-label="Seções do grupo"><button type="button" data-view="grupo" aria-current="${view === 'grupo' ? 'page' : 'false'}">Visão do grupo</button>${currentProfile().role === 'teacher' ? `<button type="button" data-view="resultados" aria-current="${view === 'resultados' ? 'page' : 'false'}">Respostas</button>` : ''}</nav>`;
  return `${header}${tabs}<div class="group-overview"${view === 'resultados' ? ' hidden' : ''}><div class="demo-explainer"><span aria-hidden="true">ⓘ</span><p>Este grupo e seus membros são fictícios. Os gráficos e indicadores usam somente respostas de demonstração registradas nos exercícios locais; questões pendentes ficam fora do aproveitamento.</p></div><section class="results-kpis group-kpis"><article><span>Membros</span><strong>${members.length}</strong><small>Participantes fictícios</small></article><article><span>Responderam</span><strong>${responders.size}/${members.length}</strong><small>${Math.max(0, members.length - responders.size)} sem resposta registrada</small></article><article><span>Aproveitamento corrigido</span><strong>${average}</strong><small>${totals.possible ? `${totals.earned}/${totals.possible} pontos avaliados` : 'Sem respostas corrigidas'}</small></article><article><span>Acertos · erros</span><strong>${correct} · ${incorrect}</strong><small>${reviewed.length ? `${Math.round(correct / reviewed.length * 100)}% de respostas corretas` : 'Sem respostas avaliadas'}</small></article><article><span>Correção pendente</span><strong>${pending}</strong><small>Não contabilizadas como erradas</small></article></section><div class="results-chart-grid group-chart-grid"><section class="results-panel"><div class="results-panel-heading"><h2>Participação por exercício</h2><span>${exerciseCount} atividade(s) visíveis</span></div>${exerciseCount ? '<div class="chart-wrap chart-question"><canvas id="group-participation-chart" aria-label="Participação dos membros por exercício"></canvas></div>' : '<p class="chart-empty">Crie um exercício para visualizar a participação do grupo.</p>'}</section><section class="results-panel"><div class="results-panel-heading"><h2>Resultado das respostas</h2><span>${reviewed.length} avaliadas · ${pending} pendentes</span></div>${answers.length ? '<div class="chart-wrap chart-doughnut"><canvas id="group-answer-chart" aria-label="Respostas corretas, incorretas e pendentes do grupo"></canvas></div>' : '<p class="chart-empty">Ainda não há respostas de demonstração. Gere respostas em Grupo › Respostas para preencher os gráficos.</p>'}</section><section class="results-panel results-panel-wide"><div class="results-panel-heading"><div><h2>Progresso por participante</h2><p>Desempenho calculado somente sobre pontos avaliados</p></div><span>${responders.size} participante(s) com registro</span></div><div class="group-member-toolbar"><label class="field-label">Pesquisar membros<input type="search" id="group-member-search" placeholder="Nome ou @usuário"></label><label class="field-label">Ordenar por<select id="group-member-sort"><option value="name" ${collaboratorSort === 'name' ? 'selected' : ''}>Nome</option><option value="activity" ${collaboratorSort === 'activity' ? 'selected' : ''}>Atividade</option></select></label></div><div class="profile-filters" role="group" aria-label="Filtrar membros do grupo">${[['all','Todos'],['online','Online'],['admin','Administradores'],['moderator','Moderadores']].map(([value,label]) => `<button type="button" class="${collaboratorFilter === value ? 'active' : ''}" data-action="collaborator-filter" data-filter="${value}" aria-pressed="${collaboratorFilter === value}">${label}</button>`).join('')}</div>${members.length ? `<div class="member-grid group-member-grid" id="profile-member-list">${memberCards}</div>` : '<p class="chart-empty">Nenhum membro neste grupo de demonstração.</p>'}</section></div><p class="profile-demo-note">Presença, funções e perfis são demonstrações visuais. A aplicação local não tem contas compartilhadas, mensagens ou gestão real de permissões.</p></div>${view === 'resultados' && currentProfile().role === 'teacher' ? renderResults() : ''}`;
}

function getTrailSettings(studentId) {
  return model.trailSettings.find(settings => settings.studentId === studentId)
    || { studentId, title: 'Sinfonia do Luar', keySignature: 'C-major', timeSignature: '4/4', clef: 'treble' };
}

function getTrailMember(studentId) {
  return demoMembers.find(member => member.id === studentId)
    || studentsCache.find(student => student.id === studentId)
    || (accountSession?.id === studentId ? { ...accountSession, initials: accountSession.name?.slice(0, 2).toUpperCase() } : null);
}

function randomTrailTitle() {
  const openings = ['Concerto', 'Sinfonia', 'Choro', 'Valsa', 'Serenata', 'Prelúdio', 'Fantasia', 'Minueto', 'Samba', 'Canção'];
  const endings = ['da Aurora', 'das Estrelas', 'do Luar', 'das Andorinhas', 'do Horizonte', 'Azul', 'da Primavera', 'dos Sonhos', 'da Floresta', 'Dourado'];
  return `${openings[Math.floor(Math.random() * openings.length)]} ${endings[Math.floor(Math.random() * endings.length)]}`;
}

function rhythmNoteMarkup(rhythm, x, y, completed = false, options = {}) {
  const openHead = rhythm === 'whole' || rhythm === 'half';
  const hasStem = rhythm !== 'whole';
  const stemUp = options.stemUp ?? y >= 101;
  const beamed = options.beamed === true;
  const color = completed ? 'var(--green)' : 'var(--ink)';
  const stemX = stemUp ? 7 : -7;
  const stemEnd = stemUp ? -48 : 48;
  const flagPath = stemUp
    ? 'M7 -48 C27 -39 26 -27 14 -16 C23 -29 19 -37 7 -41 Z'
    : 'M-7 48 C-27 39 -26 27 -14 16 C-23 29 -19 37 -7 41 Z';
  const secondFlagPath = stemUp
    ? 'M7 -31 C27 -22 26 -10 14 1 C23 -12 19 -20 7 -24 Z'
    : 'M-7 31 C-27 22 -26 10 -14 -1 C-23 12 -19 20 -7 24 Z';
  return `<g class="trail-score-note${completed ? ' done' : ''}" transform="translate(${x} ${y})" color="${color}"><ellipse class="trail-notehead${openHead ? ' open' : ''}" cx="0" cy="0" rx="8.5" ry="5.8" transform="rotate(-22)"/>${hasStem ? `<path class="trail-note-stem" d="M${stemX} 0V${stemEnd}"/>` : ''}${!beamed && (rhythm === 'eighth' || rhythm === 'sixteenth') ? `<path class="trail-note-flag" d="${flagPath}"/>` : ''}${!beamed && rhythm === 'sixteenth' ? `<path class="trail-note-flag" d="${secondFlagPath}"/>` : ''}</g>`;
}

function rhythmRestMarkup(rhythm, x, y) {
  const fill = 'currentColor';
  if (rhythm === 'whole') return `<g class="trail-score-rest" transform="translate(${x} ${y})"><path d="M-9 -4H9V3H-9Z" fill="${fill}"/></g>`;
  if (rhythm === 'half') return `<g class="trail-score-rest" transform="translate(${x} ${y})"><path d="M-9 -3H9V4H-9Z" fill="${fill}"/></g>`;
  if (rhythm === 'quarter') {
    return `<g class="trail-score-rest" transform="translate(${x} ${y})"><path d="M3 -22 11 -16 2 -7 10 1 1 9 8 18 2 22 -6 11 2 2 -6 -6 3 -14 -3 -20Z" fill="${fill}" stroke="${fill}" stroke-width="1" stroke-linejoin="round"/></g>`;
  }
  const restFlag = rhythm === 'sixteenth'
    ? 'M2 -17 C15 -12 14 -4 5 1 C12 -3 10 -9 3 -11 Z M2 -7 C15 -2 14 6 5 11 C12 7 10 1 3 -1 Z'
    : 'M2 -17 C15 -12 14 -4 5 1 C12 -3 10 -9 3 -11 Z';
  return `<g class="trail-score-rest" transform="translate(${x} ${y})"><path d="M-2 -18V15" fill="none" stroke="${fill}" stroke-width="2.5"/><path d="${restFlag}" fill="${fill}" stroke="${fill}" stroke-width=".8" stroke-linejoin="round"/></g>`;
}

function staffPositionForNote(clef, letter, octave) {
  const letterSteps = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const bottomLines = {
    treble: { letter: 'E', octave: 4 },
    alto: { letter: 'F', octave: 3 },
    bass: { letter: 'G', octave: 2 }
  };
  const bottom = bottomLines[clef] || bottomLines.treble;
  const position = (octave * 7 + letterSteps[letter]) - (bottom.octave * 7 + letterSteps[bottom.letter]);
  return 157 - position * 14;
}

function keyAccidentalYPositions(key, clef) {
  const notes = key.type === 'sharp'
    ? [['F', 5], ['C', 5], ['G', 5], ['D', 5], ['A', 4], ['E', 5], ['B', 4]]
    : [['B', 4], ['E', 5], ['A', 4], ['D', 5], ['G', 4], ['C', 5], ['F', 4]];
  return notes.slice(0, key.count).map(([letter, preferredOctave]) => {
    if (clef === 'treble') return staffPositionForNote(clef, letter, preferredOctave);
    const candidates = Array.from({ length: 5 }, (_, index) => index + 2)
      .map(octave => staffPositionForNote(clef, letter, octave))
      .filter(y => y >= 45 && y <= 157);
    return candidates.sort((a, b) => Math.abs(a - 101) - Math.abs(b - 101))[0] ?? 101;
  });
}

function trailSequence(steps, settings) {
  const seedText = `${settings.studentId}|${settings.keySignature}|${settings.timeSignature}|${settings.clef}|${steps.map(step => step.id).join('|')}`;
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  let pitch = 3 + Math.floor(random() * 3);
  let previousWasRest = false;
  const movements = [0, 0, -1, 1, -2, 2];
  return steps.map((step, index) => {
    const forcedRest = step.scoreEvent === 'rest';
    const automaticRest = step.scoreEvent !== 'note' && index > 0 && index < steps.length - 1
      && !previousWasRest && random() < 0.14;
    const isRest = forcedRest || automaticRest;
    const slurFromPrevious = !isRest && index > 0 && !previousWasRest && random() < 0.2;
    if (isRest) {
      previousWasRest = true;
      return { step, isRest, pitch, slurFromPrevious: false };
    }
    previousWasRest = false;
    const movement = movements[Math.floor(random() * movements.length)];
    pitch = Math.max(0, Math.min(8, pitch + movement));
    return { step, isRest, pitch, slurFromPrevious };
  });
}

function keyAccidentalMarkup(type, x, y) {
  const glyph = type === 'sharp'
    ? '<path d="M-2 -13V12 M4 -15V10 M-8 -3L10 -6 M-8 5L10 2"/>'
    : '<path d="M-3 -15V13 C10 6 10 -1 -3 1"/>'
      + '<path d="M-3 1C-10 5 -9 12 -3 13"/>';
  return `<g class="trail-key-accidental" transform="translate(${x} ${y})">${glyph}</g>`;
}

function trailBeamBeatGroups(numerator, denominator) {
  const measureLength = numerator * 4 / denominator;
  if (denominator === 8 && numerator >= 6 && numerator % 3 === 0) {
    return Array.from({ length: numerator / 3 }, (_, index) => ({
      start: index * 1.5,
      end: Math.min(measureLength, (index + 1) * 1.5)
    }));
  }
  const beatLength = 4 / denominator;
  return Array.from({ length: numerator }, (_, index) => ({
    start: index * beatLength,
    end: Math.min(measureLength, (index + 1) * beatLength)
  }));
}

function trailBeamGroups(events) {
  const groups = [];
  let current = [];
  const finishGroup = () => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  for (const event of events) {
    const previous = current[current.length - 1];
    const canJoin = !event.isRest
      && (event.rhythm === 'eighth' || event.rhythm === 'sixteenth')
      && event.beatGroupId
      && previous
      && previous.beatGroupId
      && previous.beatGroupId === event.beatGroupId
      && Math.abs(previous.start + previous.duration - event.start) < 0.001;
    if (!canJoin) finishGroup();
    if (!event.isRest && (event.rhythm === 'eighth' || event.rhythm === 'sixteenth')) current.push(event);
  }
  finishGroup();
  return groups;
}

function trailBeamMarkup(group) {
  const stemUp = group.reduce((sum, event) => sum + event.y, 0) / group.length >= 101;
  const stemX = stemUp ? 7 : -7;
  const beamY = group.reduce((sum, event) => sum + event.y, 0) / group.length + (stemUp ? -48 : 48);
  const startX = group[0].x + stemX;
  const endX = group[group.length - 1].x + stemX;
  const paths = [`<path d="M${startX} ${beamY}H${endX}"/>`];
  for (let index = 0; index < group.length; index += 1) {
    if (group[index].rhythm !== 'sixteenth') continue;
    const previousIsSixteenth = group[index - 1]?.rhythm === 'sixteenth';
    const nextIsSixteenth = group[index + 1]?.rhythm === 'sixteenth';
    if (nextIsSixteenth) {
      paths.push(`<path d="M${group[index].x + stemX} ${beamY + (stemUp ? 6 : -6)}H${group[index + 1].x + stemX}"/>`);
    } else if (!previousIsSixteenth) {
      const neighbor = group[index + 1] || group[index - 1];
      if (neighbor) {
        const fromX = group[index].x + stemX;
        const toX = group[index].x + (neighbor.x - group[index].x) * 0.48 + stemX;
        paths.push(`<path d="M${Math.min(fromX, toX)} ${beamY + (stemUp ? 6 : -6)}H${Math.max(fromX, toX)}"/>`);
      }
    }
  }
  return `<g class="trail-score-beam${stemUp ? ' stem-up' : ' stem-down'}">${paths.join('')}</g>`;
}

function trailStaffMarkup(steps, settings) {
  const key = trailKeySignatures.find(item => item.value === settings.keySignature) || trailKeySignatures[0];
  const [meterNumerator, meterDenominator] = settings.timeSignature.split('/').map(Number);
  const clefs = {
    treble: { glyph: '𝄞', label: 'clave de sol' },
    alto: { glyph: '𝄡', label: 'clave de dó' },
    bass: { glyph: '𝄢', label: 'clave de fá' }
  };
  const clef = clefs[settings.clef] || clefs.treble;
  const noteValues = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };
  const measureLength = meterNumerator * 4 / meterDenominator;
  const beatGroups = trailBeamBeatGroups(meterNumerator, meterDenominator);
  const sequence = trailSequence(steps, settings);
  let durationPosition = 0;
  const positionedSteps = sequence.map(item => {
    const duration = noteValues[item.step.rhythm] || 1;
    const start = durationPosition;
    durationPosition += duration;
    return { ...item, start, duration };
  });
  const keyStart = 105;
  const timeX = keyStart + key.count * 18 + 14;
  const noteStart = timeX + 52;
  const measureCount = Math.max(1, Math.ceil(durationPosition / measureLength));
  const measureWidth = Math.max(280, measureLength * 132);
  const width = Math.max(800, noteStart + measureCount * measureWidth + 34);
  const lines = [45, 73, 101, 129, 157].map(y => `<line x1="20" y1="${y}" x2="${width - 20}" y2="${y}"/>`).join('');
  const clefBottoms = { treble: { letter: 'E', octave: 4 }, alto: { letter: 'F', octave: 3 }, bass: { letter: 'G', octave: 2 } };
  const bottomLine = clefBottoms[settings.clef] || clefBottoms.treble;
  const pitchesOnStaff = Array.from({ length: 9 }, (_, index) => {
    const bottomLetterIndex = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(bottomLine.letter);
    const absoluteStep = bottomLine.octave * 7 + bottomLetterIndex + index;
    const octave = Math.floor(absoluteStep / 7);
    const letter = ['C', 'D', 'E', 'F', 'G', 'A', 'B'][absoluteStep % 7];
    return staffPositionForNote(settings.clef, letter, octave);
  });
  const rhythmByDuration = new Map(Object.entries(noteValues).map(([rhythm, duration]) => [duration, rhythm]));
  const decomposeDuration = duration => {
    const parts = [];
    let remaining = duration;
    while (remaining > 0.001) {
      const part = [...rhythmByDuration.entries()]
        .sort((a, b) => b[0] - a[0])
        .find(([value]) => value <= remaining + 0.001);
      if (!part) break;
      parts.push({ rhythm: part[1], duration: part[0] });
      remaining = Math.max(0, remaining - part[0]);
    }
    return parts;
  };
  const scoreEvents = [];
  const stepPositions = [];
  const ties = [];
  for (const item of positionedSteps) {
    let time = item.start;
    let remaining = item.duration;
    let previousFragment = null;
    let firstFragment = true;
    while (remaining > 0.001) {
      const measureIndex = Math.floor((time + 0.0001) / measureLength);
      const offsetInMeasure = time - measureIndex * measureLength;
      const available = measureLength - offsetInMeasure;
      const segmentDuration = Math.min(remaining, available);
      const crossesBar = item.duration > segmentDuration + 0.001;
      const parts = crossesBar
        ? decomposeDuration(segmentDuration)
        : [{ rhythm: item.step.rhythm, duration: segmentDuration }];
      let segmentTime = time;
      for (const part of parts) {
        const center = segmentTime + part.duration / 2;
        const x = Math.round(noteStart + (measureIndex + center / measureLength) * measureWidth);
        const noteY = pitchesOnStaff[item.pitch];
        const y = item.isRest ? (part.rhythm === 'whole' ? 133 : part.rhythm === 'half' ? 97 : 101) : noteY;
        const groupIndex = beatGroups.findIndex(group =>
          offsetInMeasure + (segmentTime - time) >= group.start - 0.001
          && offsetInMeasure + (segmentTime - time) + part.duration <= group.end + 0.001);
        scoreEvents.push({
          step: item.step,
          isRest: item.isRest,
          rhythm: part.rhythm,
          duration: part.duration,
          start: segmentTime,
          measureIndex,
          beatGroupId: groupIndex < 0 ? '' : `${measureIndex}:${groupIndex}`,
          x,
          y
        });
        if (!item.isRest) {
          if (previousFragment) {
            const tieY = previousFragment.y >= 101 ? previousFragment.y + 8 : previousFragment.y - 8;
            const middleX = (previousFragment.x + x) / 2;
            const tieControlY = previousFragment.y >= 101 ? tieY + 9 : tieY - 9;
            ties.push(`<path class="trail-tie" d="M${previousFragment.x + 8} ${tieY} Q${middleX} ${tieControlY} ${x - 8} ${tieY}"/>`);
          }
          previousFragment = { x, y };
        }
        if (firstFragment) {
          stepPositions.push({ step: item.step, x, y, isRest: item.isRest });
          firstFragment = false;
        }
        segmentTime += part.duration;
      }
      time += segmentDuration;
      remaining = Math.max(0, remaining - segmentDuration);
    }
  }
  const beamedNotes = new Map();
  const beams = trailBeamGroups(scoreEvents).map(group => {
    const stemUp = group.reduce((sum, event) => sum + event.y, 0) / group.length >= 101;
    group.forEach(event => beamedNotes.set(event, stemUp));
    return trailBeamMarkup(group);
  }).join('');
  const scoreNotes = scoreEvents.map(event => event.isRest
    ? rhythmRestMarkup(event.rhythm, event.x, event.y)
    : rhythmNoteMarkup(event.rhythm, event.x, event.y, event.step.completed, {
      beamed: beamedNotes.has(event),
      stemUp: beamedNotes.get(event)
    })).join('');
  const slurs = positionedSteps.flatMap((item, index) => {
    if (!item.slurFromPrevious) return [];
    const previous = stepPositions[index - 1];
    const current = stepPositions[index];
    if (!previous || !current || previous.isRest || current.isRest) return [];
    const left = previous.x + 10;
    const right = current.x - 10;
    if (right <= left) return [];
    const top = Math.min(previous.y, current.y) - 13;
    const middle = (left + right) / 2;
    return [`<path class="trail-phrase-slur" d="M${left} ${top} Q${middle} ${top - 14} ${right} ${top}"/>`];
  }).join('');
  const barlines = Array.from({ length: measureCount }, (_, index) => {
    const x = Math.round(noteStart + (index + 1) * measureWidth);
    return index === measureCount - 1
      ? `<line class="trail-barline final" x1="${x - 5}" y1="45" x2="${x - 5}" y2="157"/><line class="trail-barline final" x1="${x}" y1="45" x2="${x}" y2="157"/>`
      : `<line class="trail-barline" x1="${x}" y1="45" x2="${x}" y2="157"/>`;
  }).join('');
  const accidentals = keyAccidentalYPositions(key, settings.clef).map((y, index) =>
    keyAccidentalMarkup(key.type, keyStart + index * 18, y)).join('');
  const scoreBlocks = stepPositions.map(({ step, x }, index) => {
    const state = step.completed || step.status === 'completed'
      ? 'completed'
      : step.status === 'in_progress' ? 'in-progress' : 'pending';
    const labels = { completed: 'Concluído', 'in-progress': 'Andamento', pending: 'Pendente' };
    const previousGap = index ? x - stepPositions[index - 1].x : Infinity;
    const nextGap = index < stepPositions.length - 1 ? stepPositions[index + 1].x - x : Infinity;
    const blockWidth = Math.max(28, Math.min(50, Math.min(previousGap, nextGap) * 0.84));
    return `<button type="button" class="trail-score-block ${state}" style="left:${x}px;--trail-block-width:${blockWidth}px" data-action="open-trail-detail" data-id="${esc(step.id)}" title="${esc(step.title)} · ${labels[state] || labels.pending}" aria-label="${esc(step.title)}, ${labels[state] || labels.pending}"><span class="trail-score-block-title">${esc(step.title)}</span><span class="trail-score-block-status">${labels[state] || labels.pending}</span></button>`;
  }).join('');
  const connectors = stepPositions.map(({ x }) =>
    `<line class="trail-note-connector" x1="${x}" y1="164" x2="${x}" y2="190"/>`).join('');
  return `<div class="trail-staff-scroll"><div class="trail-staff-layout" style="width:${width}px"><svg class="trail-staff" viewBox="0 0 ${width} 190" style="width:${width}px" role="img" aria-label="Partitura em ${clef.label}, ${esc(key.label)}, compasso ${esc(settings.timeSignature)}, com cinco linhas e ${steps.length} etapa(s)" preserveAspectRatio="xMinYMin meet"><g class="trail-staff-lines">${lines}</g>${barlines}<text class="trail-clef" x="30" y="138" aria-hidden="true">${clef.glyph}</text><g class="trail-key-signature" aria-label="${esc(key.label)}">${accidentals}</g><g class="trail-time-signature" aria-label="Compasso ${esc(settings.timeSignature)}"><text x="${timeX}" y="94">${meterNumerator}</text><text x="${timeX}" y="121">${meterDenominator}</text></g>${connectors}${ties.join('')}${slurs}${scoreNotes}${beams}</svg><div class="trail-note-blocks" aria-label="Blocos das etapas alinhados às notas">${scoreBlocks}</div></div></div>`;
}

function renderTrail() {
  const member = currentProfile().role === 'student' && accountSession
    ? getTrailMember(accountSession.id)
    : getTrailMember(selectedTrailStudentId) || demoMembers[0];
  if (!member) return empty('Sua trilha ainda está sendo preparada.', 'Volte em alguns instantes para conferir as etapas adicionadas pelo professor.', '', '𝄞');
  selectedTrailStudentId = member.id;
  const teacher = currentProfile().role === 'teacher';
  const steps = model.trails.filter(step => step.studentId === member.id).sort((a, b) => a.order - b.order);
  const settings = getTrailSettings(member.id);
  const key = trailKeySignatures.find(item => item.value === settings.keySignature) || trailKeySignatures[0];
  const doneCount = steps.filter(step => step.completed || step.status === 'completed').length;
  const progress = steps.length ? Math.round(doneCount / steps.length * 100) : 0;
  const trailMembers = currentProfile().role === 'student' && accountSession
    ? [member]
    : [...demoMembers, ...studentsCache.filter(item => !demoMembers.some(demo => demo.id === item.id))];
  const studentOptions = trailMembers.map(item => `<option value="${esc(item.id)}" ${item.id === member.id ? 'selected' : ''}>${esc(item.name)}${demoMembers.some(demo => demo.id === item.id) ? ' · DEMO' : ''}</option>`).join('');
  const actions = teacher
    ? `${button('♫ Configurar partitura', 'configure-trail')}${model.blocks.length ? button('＋ Adicionar etapa', 'new-trail-step', 'primary', `data-student-id="${esc(member.id)}"`) : ''}`
    : '';
  const rhythmicValues = [
    ['whole', 'Semibreve'],
    ['half', 'Mínima'],
    ['quarter', 'Semínima'],
    ['eighth', 'Colcheia'],
    ['sixteenth', 'Semicolcheia']
  ];
  const legendGlyph = (rhythm, rest = false) => `<svg viewBox="0 0 36 58" aria-hidden="true"><g transform="translate(7.2 12) scale(.6)">${rest
    ? rhythmRestMarkup(rhythm, 18, rhythm === 'whole' ? 34 : rhythm === 'half' ? 24 : 30)
    : rhythmNoteMarkup(rhythm, 18, 30)}</g></svg>`;
  const notationLegend = `<div class="trail-score-legend" aria-label="Legenda de figuras e pausas"><div class="trail-score-legend-group"><strong>Figuras</strong>${rhythmicValues.map(([rhythm, label]) => `<span>${legendGlyph(rhythm)}${label}</span>`).join('')}</div><div class="trail-score-legend-group"><strong>Pausas</strong>${rhythmicValues.map(([rhythm, label]) => `<span>${legendGlyph(rhythm, true)}Pausa de ${label.toLocaleLowerCase('pt-BR')}</span>`).join('')}</div></div>`;
  return `${pageHeading('PERCURSO MUSICAL', 'Trilha', teacher ? 'Monte uma sequência personalizada de aulas para cada aluno.' : 'Acompanhe as etapas musicais preparadas para você.', actions)}<section class="trail-student-panel"><div class="trail-student-summary">${profileAvatar(member, true)}<div><span class="eyebrow">${teacher ? 'TRILHA DO ALUNO · DEMONSTRAÇÃO' : 'ALUNO DE DEMONSTRAÇÃO'}</span><h2>${esc(member.name)}</h2><p>@${esc(member.username)} · Todos os perfis são públicos</p></div></div><label class="field-label">${teacher ? 'Escolher aluno para organizar a trilha' : 'Visualizar trilha de demonstração'}<select id="trail-student-select">${studentOptions}</select></label><div class="trail-progress"><div><span>Progresso da trilha</span><strong>${doneCount}/${steps.length} etapas · ${progress}%</strong></div><div class="trail-progress-track" role="progressbar" aria-label="Progresso da trilha de ${esc(member.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div></div></section><section class="trail-score-panel"><div class="trail-score-heading"><div><p class="eyebrow">PARTITURA DA TRILHA</p><h2>${esc(settings.title || 'Sinfonia do Luar')}</h2><p class="trail-score-subtitle">${esc(key.label)} · ${esc(settings.timeSignature)} · ${esc({treble:'clave de sol',alto:'clave de dó',bass:'clave de fá'}[settings.clef] || 'clave de sol')}</p></div><span>♪ ${steps.length} ${steps.length === 1 ? 'etapa' : 'etapas'}</span></div>${trailStaffMarkup(steps, settings)}${notationLegend}<p class="trail-score-hint">Os blocos sob as notas abrem os detalhes da etapa. Colcheias e semicolcheias são agrupadas por tempo, respeitando a fórmula de compasso. As ligaduras aparecem ocasionalmente na melodia; notas longas que cruzam o compasso são divididas e ligadas.</p></section>${!steps.length ? `<section class="trail-empty"><span aria-hidden="true">𝄞</span><h2>${teacher ? 'Esta trilha ainda está vazia.' : 'Sua trilha está esperando por você.'}</h2><p>${teacher ? `Adicione etapas e escolha os blocos de aula que ${esc(member.name)} deve seguir.` : 'Seu professor ainda não adicionou etapas a esta trilha.'}</p>${teacher && !model.blocks.length ? button('＋ Criar primeiro bloco de aula', 'new-block', 'primary') : ''}</section>` : ''}<p class="profile-demo-note">As trilhas e os cinco alunos são demonstrações locais. Etapas e conclusões ficam salvas apenas neste navegador.</p>`;
}

function openTrailStepDetails(id) {
  const step = model.trails.find(item => item.id === id && item.studentId === selectedTrailStudentId);
  if (!step) return;
  const member = getTrailMember(step.studentId);
  const block = getBlock(step.blockId);
  const lesson = step.lessonId ? getLesson(step.lessonId) : null;
  const settings = getTrailSettings(step.studentId);
  const rhythms = { whole: 'Semibreve', half: 'Mínima', quarter: 'Semínima', eighth: 'Colcheia', sixteenth: 'Semicolcheia' };
  const events = { auto: 'Melodia com pausas ocasionais', note: 'Nota da melodia', rest: 'Pausa' };
  const state = step.completed || step.status === 'completed'
    ? 'completed'
    : step.status === 'in_progress' ? 'in_progress' : 'pending';
  const stateLabels = { completed: 'Concluído', in_progress: 'Em andamento', pending: 'Pendente' };
  const lessonInfo = lesson
    ? `<div><dt>Aula</dt><dd>${esc(lesson.title)}</dd></div>`
    : '';
  const statusActions = currentProfile().role === 'student'
    ? state === 'completed'
      ? button('↻ Retomar etapa', 'set-trail-step-status', 'secondary', `data-id="${esc(step.id)}" data-status="in_progress"`)
      : `${state === 'pending' ? button('▶ Começar etapa', 'set-trail-step-status', 'secondary', `data-id="${esc(step.id)}" data-status="in_progress"`) : ''}${button('✓ Marcar como concluída', 'set-trail-step-status', 'primary', `data-id="${esc(step.id)}" data-status="completed"`)}`
    : '';
  const teacherActions = currentProfile().role === 'teacher'
    ? `${button('Editar etapa', 'edit-trail-step', 'secondary', `data-id="${esc(step.id)}"`)}${button('Remover etapa', 'delete-trail-step', 'danger', `data-id="${esc(step.id)}"`)}`
    : '';
  const targetLabel = lesson ? `Ir para a aula “${lesson.title}”` : `Ir para o bloco “${block?.title || 'Bloco removido'}”`;
  openDialog(`<p class="eyebrow">ETAPA ${String(step.order).padStart(2, '0')} · ${esc(member?.name || 'Aluno')}</p><h2>${esc(step.title)}</h2><p class="dialog-intro">${esc(step.description || 'Etapa da trilha musical.')}</p><dl class="trail-detail-grid"><div><dt>Andamento</dt><dd><span class="trail-status ${state === 'completed' ? 'done' : ''}">${stateLabels[state]}</span></dd></div><div><dt>Figura rítmica</dt><dd>${rhythms[step.rhythm] || rhythms.quarter}</dd></div><div><dt>Elemento na partitura</dt><dd>${events[step.scoreEvent] || events.auto}</dd></div><div><dt>Bloco de aulas</dt><dd>${esc(block?.title || 'Bloco não disponível')}</dd></div>${lessonInfo}<div><dt>Partitura</dt><dd>${esc(settings.title || 'Sinfonia do Luar')} · ${esc(settings.timeSignature)}</dd></div></dl><div class="trail-detail-actions">${button(`↗ ${esc(targetLabel)}`, 'open-trail-target', 'primary', `data-id="${esc(step.id)}"`)}${statusActions}${teacherActions}</div>`, 'trail-modal');
}

function openTrailSettingsEditor(studentId = selectedTrailStudentId) {
  if (currentProfile().role !== 'teacher') return;
  const member = getTrailMember(studentId);
  if (!member) {
    toast('Selecione um aluno válido para configurar a partitura.', 'error');
    return;
  }
  const settings = getTrailSettings(member.id);
  const keyOptions = trailKeySignatures.map(item =>
    `<option value="${item.value}" ${item.value === settings.keySignature ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
  const timeOptions = trailTimeSignatures.map(item =>
    `<option value="${item}" ${item === settings.timeSignature ? 'selected' : ''}>${item}</option>`).join('');
  const clefOptions = [['treble', 'Clave de sol'], ['alto', 'Clave de dó'], ['bass', 'Clave de fá']].map(([value, label]) =>
    `<option value="${value}" ${(settings.clef || 'treble') === value ? 'selected' : ''}>${label}</option>`).join('');
  const dialog = openDialog(`<p class="eyebrow">PARTITURA · ${esc(member.name)}</p><h2>Configurar a trilha</h2><p class="dialog-intro">Escolha o título, a clave, a tonalidade e a fórmula de compasso que aparecerão na partitura.</p><form id="trail-settings-form" class="stack-form"><label class="field-label">Nome da composição<div class="trail-title-input"><input name="title" maxlength="80" required value="${esc(settings.title)}" placeholder="Ex.: Concerto da Aurora"><button class="button secondary" type="button" id="generate-trail-title">Sortear nome</button></div></label><label class="field-label">Clave<select name="clef">${clefOptions}</select></label><label class="field-label">Armadura de tonalidade<select name="keySignature">${keyOptions}</select></label><label class="field-label">Fórmula de compasso<select name="timeSignature">${timeOptions}</select><small class="form-help">A clave, a armadura e o compasso serão exibidos no início da pauta.</small></label><div class="dialog-actions"><button class="button primary" type="submit">Salvar partitura</button></div></form>`, 'trail-modal');
  dialog.querySelector('#generate-trail-title').addEventListener('click', () => {
    dialog.querySelector('[name="title"]').value = randomTrailTitle();
  });
  dialog.querySelector('#trail-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    if (!title) {
      toast('Digite ou sorteie um nome para a composição.', 'error');
      return;
    }
    let savedSettings = model.trailSettings.find(item => item.studentId === member.id);
    if (!savedSettings) {
      savedSettings = { studentId: member.id };
      model.trailSettings.push(savedSettings);
    }
    Object.assign(savedSettings, {
      title,
      clef: String(form.get('clef') || 'treble'),
      keySignature: String(form.get('keySignature') || 'C-major'),
      timeSignature: String(form.get('timeSignature') || '4/4')
    });
    dialog.close();
    persist('Partitura da trilha atualizada.');
  });
}

function openTrailStepEditor(id = '', studentId = selectedTrailStudentId) {
  if (!model.blocks.length) {
    toast('Crie um bloco de aulas antes de adicionar etapas à trilha.', 'error');
    return;
  }
  const existing = model.trails.find(step => step.id === id);
  const member = getTrailMember(existing?.studentId || studentId);
  if (!member) {
    toast('Selecione um aluno válido para esta etapa.', 'error');
    return;
  }
  selectedTrailStudentId = member.id;
  const blockId = existing?.blockId || model.blocks[0].id;
  const blockOptions = model.blocks.map(block => `<option value="${esc(block.id)}" ${block.id === blockId ? 'selected' : ''}>${esc(block.title)}</option>`).join('');
  const lessonOptions = model.lessons.filter(lesson => lesson.blockId === blockId)
    .map(lesson => `<option value="${esc(lesson.id)}" ${lesson.id === existing?.lessonId ? 'selected' : ''}>${esc(lesson.title)}</option>`).join('');
  const rhythmLabels = [['whole','Semibreve'],['half','Mínima'],['quarter','Semínima'],['eighth','Colcheia'],['sixteenth','Semicolcheia']];
  const scoreEventOptions = [['auto', 'Automático · melodia com pausas ocasionais'], ['note', 'Nota da melodia'], ['rest', 'Pausa']];
  const dialog = openDialog(`<p class="eyebrow">EDITOR DE TRILHA · ${esc(member.name)}</p><h2>${existing ? 'Editar etapa' : 'Adicionar etapa à trilha'}</h2><p class="dialog-intro">Escolha o bloco de aulas que ficará disponível como atalho nesta etapa.</p><form id="trail-step-form" class="stack-form"><input type="hidden" name="id" value="${esc(existing?.id || '')}"><input type="hidden" name="studentId" value="${esc(member.id)}"><label class="field-label">Nome da etapa<input name="title" maxlength="80" required value="${esc(existing?.title || '')}" placeholder="Ex.: Primeiros passos na harmonia"></label><label class="field-label">Descrição<textarea name="description" rows="2" maxlength="300" placeholder="O que o aluno vai estudar?">${esc(existing?.description || '')}</textarea></label><label class="field-label">Bloco de aula<select name="blockId" id="trail-block-select" required>${blockOptions}</select></label><label class="field-label">Aula específica (opcional)<select name="lessonId" id="trail-lesson-select"><option value="">Abrir o bloco completo</option>${lessonOptions}</select><small class="form-help">Ao escolher uma aula, o atalho abrirá diretamente nela. Sem aula, abrirá o bloco.</small></label><label class="field-label">Figura rítmica na partitura<select name="rhythm">${rhythmLabels.map(([value, label]) => `<option value="${value}" ${(existing?.rhythm || 'quarter') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field-label">Elemento musical<select name="scoreEvent">${scoreEventOptions.map(([value, label]) => `<option value="${value}" ${(existing?.scoreEvent || 'auto') === value ? 'selected' : ''}>${label}</option>`).join('')}</select><small class="form-help">No modo automático, as notas formam uma melodia com pequenos movimentos e pausas espaçadas.</small></label><div class="dialog-actions"><button class="button primary" type="submit">${existing ? 'Salvar etapa' : 'Adicionar à trilha'}</button></div></form>`, 'trail-modal');
  dialog.querySelector('#trail-step-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    const blockIdValue = String(form.get('blockId') || '');
    const lessonId = String(form.get('lessonId') || '');
    const selectedLesson = lessonId ? getLesson(lessonId) : null;
    if (!title || !getBlock(blockIdValue) || (lessonId && selectedLesson?.blockId !== blockIdValue)) {
      toast('Confira o nome, o bloco e a aula desta etapa.', 'error');
      return;
    }
    const step = existing || {
      id: createId(),
      order: model.trails.filter(item => item.studentId === member.id).length + 1,
      completed: false,
      completedAt: '',
      createdAt: new Date().toISOString()
    };
    Object.assign(step, {
      studentId: member.id,
      title,
      description: String(form.get('description') || '').trim(),
      blockId: blockIdValue,
      lessonId,
      rhythm: String(form.get('rhythm') || 'quarter'),
      scoreEvent: String(form.get('scoreEvent') || 'auto')
    });
    if (!existing) model.trails.push(step);
    dialog.close();
    view = 'trilha';
    persist(existing ? 'Etapa da trilha atualizada.' : 'Etapa adicionada à trilha.');
  });
}

function renderGroupCharts(container) {
  if (!container.querySelector('.chart-wrap')) return;
  const attempts = groupDemoAttempts();
  const exercises = visibleExercises();
  if (!window.Chart) {
    container.querySelectorAll('.chart-wrap').forEach(chart => { chart.innerHTML = '<p class="chart-empty">O gráfico não carregou. Verifique a instalação local de Chart.js e recarregue a página.</p>'; });
    toast('Chart.js não está disponível. Confira as dependências locais.', 'error');
    return;
  }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#17233b';
  const create = (id, config) => {
    const canvas = container.querySelector(`#${id}`);
    if (canvas) charts.push(new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, color, plugins: { legend: { labels: { color } } }, ...config.options } }));
  };
  if (exercises.length) {
    create('group-participation-chart', {
      type: 'bar',
      data: {
        labels: exercises.map(exercise => exercise.title),
        datasets: [{
          label: 'Participantes que responderam',
          data: exercises.map(exercise => new Set(attempts.filter(attempt => attempt.exerciseId === exercise.id).map(attempt => attempt.demoParticipantId)).size),
          backgroundColor: '#1452df',
          borderRadius: 6
        }]
      },
      options: { scales: { x: { grid: { display: false }, ticks: { color } }, y: { beginAtZero: true, max: demoGroup.memberIds.length, ticks: { color, precision: 0 }, grid: { color } } } }
    });
  }
  const answers = attempts.flatMap(attempt => (attempt.answers || []).map(answer => ({ answer, attempt })));
  if (answers.length) {
    const pending = answers.filter(item => item.answer.manual && !item.attempt.gradedAt).length;
    const reviewed = answers.filter(item => !(item.answer.manual && !item.attempt.gradedAt));
    const correct = reviewed.filter(item => item.answer.correct === true).length;
    create('group-answer-chart', {
      type: 'doughnut',
      data: {
        labels: ['Corretas', 'Incorretas', 'Pendentes'],
        datasets: [{ data: [correct, reviewed.length - correct, pending], backgroundColor: ['#1452df', '#73a0ff', '#9bbcff'], borderWidth: 0 }]
      },
      options: { cutout: '68%' }
    });
  }
}

function renderMemberProfile(id) {
  const member = demoMembers.find(item => item.id === id);
  if (!member) {
    selectedProfileId = null;
    view = 'grupo';
    return renderGroup();
  }
  const role = memberRoleLabel(member.groupRole);
  const progress = groupMemberProgress(member.id);
  const memberStats = `<div class="profile-stat-grid member-profile-stats"><article><strong>${progress.exercises}</strong><span>Exercícios respondidos</span></article><article><strong>${progress.percent === null ? '—' : `${progress.percent}%`}</strong><span>Aproveitamento corrigido</span></article><article><strong>${progress.pending}</strong><span>Respostas pendentes</span></article><article><strong>${member.activities.length}</strong><span>Atividades recentes</span></article></div>`;
  const detailMarkup = `<div class="settings-grid member-public-details"><section class="settings-card"><p class="eyebrow">PUBLICAÇÕES · DEMONSTRAÇÃO</p><h3>Publicações</h3>${member.publications.length ? `<ul>${member.publications.map(publication => `<li>${esc(publication)}</li>`).join('')}</ul>` : '<p>Sem publicações de demonstração.</p>'}</section><section class="settings-card"><p class="eyebrow">ATIVIDADES · DEMONSTRAÇÃO</p><h3>Atividade recente</h3>${member.activities.length ? `<ul>${member.activities.map(activity => `<li>${esc(activity)}</li>`).join('')}</ul>` : '<p>Sem atividades recentes de demonstração.</p>'}<p>Participa de ${esc(demoGroup.name)} como ${role.toLocaleLowerCase('pt-BR')} (demo).</p></section></div>`;
  return `<section class="member-profile-view">
    <button class="button secondary" type="button" data-view="grupo">← Voltar ao grupo</button>
    <article class="profile-hero member-profile-hero">${profileAvatar(member, true)}<div class="profile-hero-copy">
      <p class="eyebrow">PERFIL DE MEMBRO · DEMONSTRAÇÃO</p><h2>${esc(member.name)}</h2>
      <p class="profile-handle">@${esc(member.username)} <span>· Perfil público</span></p>
      <p>${esc(member.bio)}</p><p class="member-profile-context">${role} · ${esc(demoGroup.name)}</p><span class="presence-tag ${member.presence}"><i></i>${({ online: 'Online (demo)', away: 'Ausente (demo)', offline: 'Offline (demo)' })[member.presence]}</span>
    </div></article>
    <div class="member-profile-actions">${button('Ver trilha do aluno', 'open-student-trail', 'primary', `data-student-id="${member.id}"`)}</div>
    ${memberStats}
    ${detailMarkup}
    <p class="profile-demo-note">Este perfil fictício existe apenas para testar a interface. Privacidade e permissões não são aplicadas por um backend.</p>
  </section>`;
}

function applyProfileMemberFilters() {
  const list = root.querySelector('#profile-member-list');
  if (!list) return;
  const query = root.querySelector('#group-member-search')?.value.trim().toLocaleLowerCase('pt-BR') || '';
  const filter = root.querySelector('.group-member-grid') ? collaboratorFilter : 'all';
  const cards = [...list.querySelectorAll('.member-card')];
  for (const card of cards) {
    const member = demoMembers.find(item => item.id === card.dataset.memberId);
    const matchesText = !query || card.textContent.toLocaleLowerCase('pt-BR').includes(query)
      || `@${member?.username || ''}`.includes(query);
    const matchesFilter = filter === 'all'
      || (filter === 'online' && card.dataset.presence === 'online')
      || card.dataset.groupRole === filter;
    card.hidden = !(matchesText && matchesFilter);
  }
  const sortBy = root.querySelector('#group-member-sort')?.value || 'name';
  if (sortBy === 'activity') {
    const rank = { online: 0, away: 1, offline: 2 };
    cards.sort((a, b) => rank[a.dataset.presence] - rank[b.dataset.presence]
      || a.dataset.memberName.localeCompare(b.dataset.memberName, 'pt-BR'));
  } else cards.sort((a, b) => a.dataset.memberName.localeCompare(b.dataset.memberName, 'pt-BR'));
  cards.forEach(card => list.append(card));
}

function render() {
  if (!model) return;
  charts.forEach(chart => chart.destroy());
  charts = [];
  document.documentElement.dataset.theme = model.profile.theme;
  if (view === 'login') {
    root.innerHTML = renderAccountLogin();
    return;
  }
  if (view === 'loading') {
    root.innerHTML = renderWelcomeLoading();
    return;
  }
  if (view === 'activity-loading') {
    root.innerHTML = renderActivityLoading();
    return;
  }
  if (view === 'assessment-countdown') {
    root.innerHTML = renderAssessmentCountdown();
    return;
  }
  if (view === 'assessment-locked') {
    root.innerHTML = renderAssessmentLocked();
    return;
  }
  root.innerHTML = shellMarkup();
  const labels = { inicio: 'Visão geral', aulas: 'Aulas', aula: 'Aula', exercicios: 'Exercícios', exercicio: 'Exercício', playlists: 'Playlists', historico: 'Meu histórico', avaliacoes: 'Avaliações', trilha: 'Trilha', grupo: 'Grupo', resultados: 'Respostas', alunos: 'Alunos', notificacoes: 'Notificações', perfil: 'Perfil e dados', configuracoes: 'Configurações' };
  root.querySelector('#current-crumb').textContent = labels[view] || 'Visão geral';
  const content = root.querySelector('#app-content');
  if (view === 'inicio') content.innerHTML = renderHome();
  else if (view === 'aulas') content.innerHTML = renderLessons();
  else if (view === 'aula') content.innerHTML = activeLessonId ? renderLesson(activeLessonId) : renderLessons();
  else if (view === 'exercicios') content.innerHTML = renderExercises();
  else if (view === 'playlists') content.innerHTML = renderPlaylists();
  else if (view === 'historico') content.innerHTML = renderLearningHistory();
  else if (view === 'avaliacoes') content.innerHTML = renderAssessments();
  else if (view === 'exercicio') {
    if (!activeExerciseId) {
      content.innerHTML = renderExercises();
    } else {
      try {
        content.innerHTML = renderExercise(activeExerciseId);
      } catch (error) {
        console.error('Erro ao renderizar exercício:', error);
        content.innerHTML = `<section class="exercise-recovery"><div class="empty-state"><span class="empty-state-icon">!</span><h2>Não foi possível abrir este exercício</h2><p>${esc(error.message || 'Os dados desta atividade estão incompletos ou incompatíveis.')}</p><button class="button secondary" type="button" data-action="go-exercises">← Voltar aos exercícios</button></div></section>`;
      }
    }
  }
  else if (view === 'trilha') content.innerHTML = renderTrail();
  else if (view === 'grupo') content.innerHTML = selectedOnlineStudentId ? renderOnlineStudentProfile(selectedOnlineStudentId) : (selectedProfileId ? renderMemberProfile(selectedProfileId) : renderGroup());
  else if (view === 'resultados') content.innerHTML = currentProfile().role === 'teacher' ? renderResults() : renderHome();
  else if (view === 'alunos') content.innerHTML = selectedOnlineStudentId ? renderOnlineStudentProfile(selectedOnlineStudentId) : renderStudents();
  else if (view === 'notificacoes') content.innerHTML = renderNotifications();
  else if (view === 'perfil') content.innerHTML = renderSettings();
  else if (view === 'configuracoes') content.innerHTML = renderConfigurations();
  root.querySelector('#theme-toggle').textContent = model.profile.theme === 'dark' ? '☼ Tema claro' : '☾ Tema escuro';
  bindPianos(content, { onChange: updateChordProgress, defaultOctave: defaultOctave() });
  hydrateMedia(content);
  renderScores(content);
  renderPromptScores(content);
  applyExerciseFilters();
  if (view === 'resultados' && currentProfile().role === 'teacher') {
    renderResultCharts(content);
    renderGroupCharts(content);
  }
  if (view === 'grupo') renderGroupCharts(content);
  if (accountSession && !notificationsLoaded) {
    refreshNotifications(false).then(() => { if (view === 'notificacoes') render(); })
      .catch(error => toast(`Não foi possível carregar as notificações: ${error.message}`, 'error'));
  }
  if (['alunos', 'trilha', 'grupo'].includes(view) && accountSession?.role === 'teacher' && !studentsLoaded && !studentsLoading) {
    studentsLoading = true;
    accountRequest('/api/students').then(result => {
      studentsCache = result.students;
      studentsLoaded = true;
    }).catch(error => {
      toast(`Não foi possível carregar os alunos: ${error.message}`, 'error');
    }).finally(() => {
      studentsLoading = false;
      if (['alunos', 'trilha', 'grupo'].includes(view)) render();
    });
  }
}

async function renderScores(container) {
  for (const element of container.querySelectorAll('[data-score]')) {
    const question = model.exercises.find(exercise => exercise.id === activeExerciseId)?.questions.find(item => item.id === element.dataset.score);
    if (!question) { element.textContent = 'Partitura não anexada.'; continue; }
    try {
      const xml = await loadQuestionMusicXml(question);
      scoreXmlCache.set(question.id, xml);
      await renderMusicXml(xml, element);
      const playButton = element.parentElement?.querySelector('[data-action="play-score"]');
      if (playButton) playButton.disabled = false;
    }
    catch (error) { element.textContent = error.message; }
  }
}

async function renderPromptScores(container) {
  for (const element of container.querySelectorAll('[data-prompt-score]')) {
    const questionId = element.dataset.promptScore;
    const question = model.exercises.find(exercise => exercise.id === activeExerciseId)?.questions
      .find(item => item.id === questionId);
    if (!question) continue;
    const source = question.promptScoreSource || (question.promptScoreMediaId ? 'upload' : 'link');
    const museScoreUrl = source === 'link' ? museScoreScoreUrl(question.promptScoreUrl) : '';
    if (museScoreUrl) {
      const wrapper = document.createElement('div');
      wrapper.className = 'musescore-score-link';
      const help = document.createElement('p');
      help.className = 'form-help';
      help.textContent = 'O MuseScore não permite exibir esta partitura dentro do Notarium. Abra o link para visualizar e ouvir, ou adicione o arquivo MusicXML/MXL para usar a partitura aqui.';
      const link = document.createElement('a');
      link.className = 'button secondary small-button';
      link.href = museScoreUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Abrir e ouvir no MuseScore ↗';
      wrapper.append(help, link);
      element.replaceChildren(wrapper);
      continue;
    }
    try {
      const xml = await loadPromptScoreXml(question);
      scoreXmlCache.set(`prompt-score:${questionId}`, xml);
      await renderMusicXml(xml, element);
      const playButton = element.parentElement?.querySelector('[data-action="play-prompt-score"]');
      if (playButton) playButton.disabled = false;
    } catch (error) {
      element.textContent = error.message;
    }
  }
}

function playScoreFromCache(button, questionId) {
  const xml = scoreXmlCache.get(button.dataset.cacheKey || questionId);
  if (!xml) {
    toast('Carregue a prévia da partitura antes de reproduzi-la.', 'error');
    return;
  }
  let playback;
  try { playback = extractPlaybackEvents(xml); }
  catch (error) {
    toast(error.message, 'error');
    return;
  }
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Tocando partitura…';
  playNoteSequence(playback.events, playback.tempo)
    .catch(error => toast(error.message, 'error'))
    .finally(() => {
      button.disabled = false;
      button.textContent = label;
    });
}

function updateChordProgress(notes, piano) {
  const questionId = piano.dataset.piano.replace(/^piano-/, '');
  const progress = root.querySelector(`[data-chord-progress="${CSS.escape(questionId)}"]`);
  if (!progress) return;
  const steps = Number(progress.dataset.stepCount);
  if (!steps) {
    progress.textContent = 'O professor ainda não definiu as notas esperadas.';
    return;
  }
  const hints = JSON.parse(progress.dataset.stepHints || '[]');
  if (notes.length >= steps) {
    progress.textContent = `Acorde montado (${steps} de ${steps}). Ouça sua seleção e revise antes de enviar.`;
    return;
  }
  const next = Math.min(notes.length, steps - 1);
  progress.textContent = `Etapa ${notes.length + 1} de ${steps}${hints[next] ? ` · ${hints[next]}` : ' · Selecione a próxima nota.'}`;
}

function applyLessonFilter() {
  const query = root.querySelector('#lesson-search')?.value.trim().toLocaleLowerCase('pt-BR');
  if (query === undefined) return;
  root.querySelectorAll('#block-grid .block-card').forEach(card => { card.hidden = !card.textContent.toLocaleLowerCase('pt-BR').includes(query); });
}

function applyExerciseFilters() {
  const grids = [...root.querySelectorAll('.exercise-grid')];
  if (!grids.length) return;
  const query = root.querySelector('#exercise-search')?.value.trim().toLocaleLowerCase('pt-BR') || '';
  const type = root.querySelector('#exercise-type-filter')?.value || '';
  const blockId = root.querySelector('#exercise-block-filter')?.value || '';
  const difficulty = root.querySelector('#exercise-difficulty-filter')?.value || '';
  const sort = root.querySelector('#exercise-sort')?.value || 'date';
  for (const grid of grids) {
    const cards = [...grid.children];
    if (sort === 'title') cards.sort((a, b) => a.querySelector('h3').textContent.localeCompare(b.querySelector('h3').textContent, 'pt-BR'));
    else cards.sort((a, b) => String(b.dataset.createdAt).localeCompare(String(a.dataset.createdAt)));
    cards.forEach(card => {
      const exercise = model.exercises.find(item => item.id === card.dataset.exerciseId);
      const textMatch = card.textContent.toLocaleLowerCase('pt-BR').includes(query);
      const typeMatch = !type || exercise?.questions.some(question => question.type === type)
        || exercise?.questionTypes?.includes(type);
      const blockMatch = !blockId || exercise?.exerciseBlockId === blockId;
      const difficultyMatch = !difficulty || exercise?.difficulty === difficulty;
      card.hidden = !(textMatch && typeMatch && blockMatch && difficultyMatch);
      grid.append(card);
    });
  }
}

function navigate(next) {
  if (next !== 'exercicio') {
    clearInterval(assessmentClockTimer);
    clearInterval(assessmentHeartbeatTimer);
  }
  selectedOnlineStudentId = null;
  selectedProfileId = null;
  view = next;
  if (next !== 'aula') activeLessonId = null;
  if (next !== 'exercicio') activeExerciseId = null;
  try {
    render();
  } catch (error) {
    console.error(`Erro ao navegar para ${next}:`, error);
    view = 'inicio';
    render();
    toast(`Não foi possível abrir esta tela: ${error.message}`, 'error');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDialog(markup, width = '', preserveExisting = false) {
  const holder = root.querySelector('#dialog-root');
  if (!preserveExisting) {
    holder.querySelectorAll('dialog[open]').forEach(openDialog => openDialog.close());
    holder.replaceChildren();
  }
  const dialog = document.createElement('dialog');
  dialog.className = `modal ${width}`;
  dialog.id = preserveExisting ? 'preview-dialog' : 'active-dialog';
  dialog.innerHTML = `<div class="dialog-notice" role="alert" aria-live="assertive"><span class="dialog-notice-message"></span><button type="button" class="dialog-notice-jump" hidden>Ir ao campo</button></div><div class="dialog-body">${markup}<button class="modal-close" type="button" data-action="close-dialog" aria-label="Fechar">×</button></div>`;
  holder.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  dialog.querySelector('input:not([type="hidden"]), textarea, select, button')?.focus({ preventScroll: true });
  return dialog;
}

function showDialogNotice(dialog, message, target = null) {
  const notice = dialog?.querySelector('.dialog-notice');
  if (!notice) {
    toast(message, 'error');
    return;
  }
  notice.querySelector('.dialog-notice-message').textContent = message;
  const jumpButton = notice.querySelector('.dialog-notice-jump');
  jumpButton.hidden = !target;
  jumpButton.onclick = target ? () => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  } : null;
  notice.classList.add('visible', 'dialog-notice-error');
  clearTimeout(dialogNoticeTimer);
  dialogNoticeTimer = setTimeout(() => notice.classList.remove('visible'), 4500);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  } else dialog.querySelector('.dialog-body')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function openBlockEditor(id = '') {
  const block = getBlock(id);
  const releaseField = 'blockStudentIds';
  const dialog = openDialog(`<p class="eyebrow">ORGANIZAÇÃO DO CURSO</p><h2>${block ? 'Editar bloco' : 'Criar bloco de aulas'}</h2><p class="dialog-intro">Agrupe aulas por tema, unidade e personalize a decoração do cartão.</p><form id="block-form" class="stack-form"><input type="hidden" name="id" value="${esc(id)}"><label class="field-label">Nome do bloco<input name="title" maxlength="80" required placeholder="Ex.: Harmonia musical" value="${esc(block?.title || '')}"></label><label class="field-label">Descrição<textarea name="description" rows="3" maxlength="400" placeholder="O que será estudado?">${esc(block?.description || '')}</textarea></label><div class="form-grid"><label class="field-label">Cor de identificação<select name="color"><option value="blue" ${block?.color !== 'violet' && block?.color !== 'teal' ? 'selected' : ''}>Azul</option><option value="violet" ${block?.color === 'violet' ? 'selected' : ''}>Índigo</option><option value="teal" ${block?.color === 'teal' ? 'selected' : ''}>Ciano</option></select></label><label class="field-label">Decoração<select name="decoration"><option value="notes" ${!block?.decoration || block.decoration === 'notes' ? 'selected' : ''}>Notas musicais</option><option value="stars" ${block?.decoration === 'stars' ? 'selected' : ''}>Estrelas</option><option value="petals" ${block?.decoration === 'petals' ? 'selected' : ''}>Flores</option><option value="moon" ${block?.decoration === 'moon' ? 'selected' : ''}>Lua</option></select></label></div>${releaseSettingsMarkup(block, 'block') }<div class="dialog-actions"><button class="button primary" type="submit">${block ? 'Salvar alterações' : 'Criar bloco'}</button>${block ? button('Excluir bloco', 'delete-block', 'danger', `data-id="${esc(id)}"`) : ''}</div></form>`);
  loadStudentsForRelease(dialog, releaseField);
  dialog.querySelector('#block-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = getBlock(id);
    if (form.get('releaseMode') === 'selected' && !studentsLoaded) {
      showDialogNotice(dialog, 'Não foi possível carregar a lista de alunos. Tente novamente antes de escolher uma liberação específica.');
      return;
    }
    const blockData = { id: id || createId(), title: String(form.get('title')).trim(), description: String(form.get('description')).trim(), color: form.get('color'), decoration: form.get('decoration'), releaseMode: String(form.get('releaseMode') || 'all'), releasedStudentIds: [...dialog.querySelectorAll(`[name="${releaseField}"]:checked`)].map(input => input.value), order: existing?.order ?? model.blocks.length + 1, createdAt: existing?.createdAt || new Date().toISOString() };
    if (existing) Object.assign(existing, blockData);
    else model.blocks.push(blockData);
    dialog.close();
    persist(existing ? 'Bloco atualizado.' : 'Bloco criado.');
  });
}

function openExerciseBlockEditor(id = '', initialPlaylistId = selectedExercisePlaylistId || '') {
  const existing = getExerciseBlock(id);
  const releaseField = 'exerciseBlockStudentIds';
  const playlistId = existing ? existing.playlistId || '' : initialPlaylistId;
  const dialog = openDialog(`<p class="eyebrow">ORGANIZAÇÃO DA PRÁTICA</p><h2>${existing ? 'Editar bloco de exercícios' : 'Criar bloco de exercícios'}</h2><p class="dialog-intro">Os blocos ficam dentro de uma playlist e reúnem exercícios relacionados.</p><form id="exercise-block-form" class="stack-form"><label class="field-label">Playlist<select name="playlistId"><option value="">Sem playlist</option>${model.playlists.map(playlist => `<option value="${esc(playlist.id)}" ${playlist.id === playlistId ? 'selected' : ''}>${esc(playlist.title)}</option>`).join('')}</select><small class="form-help">Você pode mover este bloco para outra playlist quando quiser.</small></label><label class="field-label">Nome do bloco<input name="title" required maxlength="80" value="${esc(existing?.title || '')}" placeholder="Ex.: Leitura musical"></label><label class="field-label">Descrição<textarea name="description" maxlength="400" rows="3" placeholder="Quais conceitos serão praticados?">${esc(existing?.description || '')}</textarea></label><div class="form-grid"><label class="field-label">Cor<select name="color"><option value="blue" ${existing?.color !== 'violet' && existing?.color !== 'teal' ? 'selected' : ''}>Azul</option><option value="violet" ${existing?.color === 'violet' ? 'selected' : ''}>Índigo</option><option value="teal" ${existing?.color === 'teal' ? 'selected' : ''}>Ciano</option></select></label><label class="field-label">Decoração<select name="decoration"><option value="notes" ${!existing?.decoration || existing?.decoration === 'notes' ? 'selected' : ''}>Notas musicais</option><option value="stars" ${existing?.decoration === 'stars' ? 'selected' : ''}>Estrelas</option><option value="petals" ${existing?.decoration === 'petals' ? 'selected' : ''}>Flores</option><option value="moon" ${existing?.decoration === 'moon' ? 'selected' : ''}>Lua</option></select></label></div>${releaseSettingsMarkup(existing, 'exerciseBlock')}<div class="dialog-actions"><button class="button primary" type="submit">${existing ? 'Salvar bloco' : 'Criar bloco'}</button>${existing ? button('Excluir bloco', 'delete-exercise-block', 'danger', `data-id="${esc(existing.id)}"`) : ''}</div></form>`);
  loadStudentsForRelease(dialog, releaseField);
  dialog.querySelector('#exercise-block-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('releaseMode') === 'selected' && !studentsLoaded) {
      showDialogNotice(dialog, 'Não foi possível carregar a lista de alunos. Tente novamente antes de escolher uma liberação específica.');
      return;
    }
    const block = {
      id: existing?.id || createId(),
      title: String(form.get('title') || '').trim(),
      description: String(form.get('description') || '').trim(),
      playlistId: String(form.get('playlistId') || ''),
      color: form.get('color'),
      decoration: form.get('decoration'),
      releaseMode: String(form.get('releaseMode') || 'all'),
      releasedStudentIds: [...dialog.querySelectorAll(`[name="${releaseField}"]:checked`)].map(input => input.value),
      order: existing?.order ?? model.exerciseBlocks.length + 1,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, block);
    else model.exerciseBlocks.push(block);
    selectedExerciseBlockId = block.id;
    dialog.close();
    selectedExercisePlaylistId = block.playlistId || null;
    persist(existing ? 'Bloco de exercícios atualizado.' : 'Bloco de exercícios criado. Agora adicione exercícios.');
  });
  return dialog;
}

function openExercisePlaylistEditor(id = '') {
  const existing = model.playlists.find(item => item.id === id);
  const dialog = openDialog(`<p class="eyebrow">PLAYLIST MUSICAL</p><h2>${existing ? 'Personalizar playlist' : 'Criar playlist'}</h2><p class="dialog-intro">Crie uma sequência musical e personalize o disco.</p><form id="exercise-playlist-form" class="stack-form"><label class="field-label">Nome da playlist<input name="title" required maxlength="80" value="${esc(existing?.title || '')}" placeholder="Ex.: Harmonia"></label><label class="field-label">Descrição<textarea name="description" rows="3" maxlength="300" placeholder="O que o aluno vai estudar nesta seleção?">${esc(existing?.description || '')}</textarea></label><div class="form-grid"><label class="field-label">Cor do disco<input name="color" type="color" value="${/^#[0-9a-f]{6}$/i.test(existing?.color || '') ? existing.color : '#7658c8'}"></label><label class="field-label">Símbolo no centro do disco<input name="symbol" maxlength="3" value="${esc(existing?.symbol || '♫')}" placeholder="♫"><small class="form-help">Use uma letra, nota ou símbolo curto.</small></label></div><div class="dialog-actions"><button class="button primary" type="submit">${existing ? 'Salvar playlist' : 'Criar playlist'}</button>${existing ? button('Excluir playlist', 'delete-exercise-playlist', 'danger', `data-id="${esc(existing.id)}"`) : ''}</div></form>`);
  dialog.querySelector('#exercise-playlist-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const playlist = {
      id: existing?.id || createId(),
      title: String(form.get('title') || '').trim(),
      description: String(form.get('description') || '').trim(),
      color: String(form.get('color') || '#7658c8'),
      symbol: String(form.get('symbol') || '♫').trim().slice(0, 3) || '♫',
      order: existing?.order ?? model.playlists.length + 1,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, playlist);
    else model.playlists.push(playlist);
    selectedExercisePlaylistId = playlist.id;
    selectedExerciseBlockId = null;
    view = 'playlists';
    dialog.close();
    persist(existing ? 'Playlist atualizada.' : 'Playlist criada. Agora adicione aulas e blocos.');
  });
}

function openMoveExerciseDialog(exerciseId) {
  const exercise = getExercise(exerciseId);
  if (!exercise) return;
  const options = [
    `<option value="">Sem bloco</option>`,
    ...model.playlists.map(playlist => {
      const blocks = model.exerciseBlocks.filter(block => block.playlistId === playlist.id);
      return `<optgroup label="${esc(playlist.title)}">${blocks.map(block => `<option value="${esc(block.id)}" ${block.id === exercise.exerciseBlockId ? 'selected' : ''}>${esc(block.title)}</option>`).join('')}</optgroup>`;
    }),
    ...model.exerciseBlocks.filter(block => !block.playlistId)
      .map(block => `<option value="${esc(block.id)}" ${block.id === exercise.exerciseBlockId ? 'selected' : ''}>${esc(block.title)} · sem playlist</option>`)
  ].join('');
  const dialog = openDialog(`<p class="eyebrow">ORGANIZAR PLAYLIST</p><h2>Mover exercício</h2><p class="dialog-intro">${esc(exercise.title || 'Exercício')}</p><form id="move-exercise-form" class="stack-form"><label class="field-label">Playlist e bloco<select name="exerciseBlockId">${options}</select><small class="form-help">Para colocar em uma playlist, escolha um bloco dentro dela. Você pode criar novos blocos nas configurações da playlist.</small></label><div class="dialog-actions"><button type="button" class="button secondary" data-action="close-dialog">Cancelar</button><button type="submit" class="button primary">Mover exercício</button></div></form>`);
  dialog.querySelector('#move-exercise-form').addEventListener('submit', event => {
    event.preventDefault();
    const targetBlockId = String(new FormData(event.currentTarget).get('exerciseBlockId') || '');
    exercise.exerciseBlockId = targetBlockId;
    exercise.order = targetBlockId
      ? model.exercises.filter(item => item.id !== exercise.id && item.exerciseBlockId === targetBlockId).length + 1
      : model.exercises.filter(item => item.id !== exercise.id && !item.exerciseBlockId).length + 1;
    selectedExerciseBlockId = null;
    selectedExercisePlaylistId = getExerciseBlock(targetBlockId)?.playlistId || null;
    dialog.close();
    persist('Exercício movido para a nova organização.');
  });
}

function moveExerciseOrder(exerciseId, direction) {
  const exercise = getExercise(exerciseId);
  if (!exercise) return;
  const siblings = ordered(model.exercises.filter(item =>
    item.exerciseBlockId === exercise.exerciseBlockId && !item.assessment));
  const index = siblings.findIndex(item => item.id === exerciseId);
  const other = siblings[index + direction];
  if (!other) return;
  const currentOrder = Number(exercise.order) || index + 1;
  exercise.order = Number(other.order) || index + direction + 1;
  other.order = currentOrder;
  persist('Ordem dos exercícios atualizada.');
}

function formatContentText(textarea, format) {
  const marker = format === 'bold' ? '**' : '*';
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  if (selected) {
    const alreadyFormatted = value.slice(start - marker.length, start) === marker
      && value.slice(end, end + marker.length) === marker;
    if (alreadyFormatted) {
      textarea.setRangeText(selected, start - marker.length, end + marker.length, 'select');
    } else {
      textarea.setRangeText(`${marker}${selected}${marker}`, start, end, 'select');
      textarea.setSelectionRange(start + marker.length, end + marker.length);
    }
  } else {
    textarea.setRangeText(`${marker}${marker}`, start, end, 'end');
    textarea.setSelectionRange(start + marker.length, start + marker.length);
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function indentContentText(textarea) {
  const value = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) {
    textarea.setRangeText('    ', start, end, 'end');
  } else {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = value.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const indented = value.slice(lineStart, lineEnd).split('\n').map(line => `    ${line}`).join('\n');
    textarea.setRangeText(indented, lineStart, lineEnd, 'select');
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function contentBlockEditor(block, index) {
  const kind = block.type || 'text';
  const textBlocks = ['text', 'heading', 'list', 'tip', 'example', 'warning', 'postit'];
  const richTextKinds = ['text', 'tip', 'example', 'warning', 'postit'];
  const mediaKind = isMediaBlock(block);
  const source = block.mediaSource || (block.mediaId ? 'upload' : 'link');
  const accepts = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : kind === 'pdf' ? '.pdf,.mxl,.musicxml,.xml,application/pdf,application/xml' : '';
  const alignment = ['left', 'center', 'right', 'justify'].includes(block.align) ? block.align : 'left';
  const position = block.position === 'left' ? 'left' : 'right';
  const accentColor = /^#[\da-f]{6}$/i.test(block.accentColor || '')
    ? block.accentColor
    : kind === 'warning' ? '#e8a23a' : '#5b86e5';
  const options = [['text','Texto'],['heading','Título'],['list','Lista'],['tip','Dica'],['example','Exemplo'],['warning','Atenção'],['postit','Post-it'],['image','Imagem'],['video','Vídeo'],['link','Link'],['pdf','PDF / Partitura'],['audio','Áudio']];
  const textControls = textBlocks.includes(kind)
    ? `<div class="form-grid content-style-controls">${kind === 'postit' ? `<label class="field-label">Posição do Post-it<select class="content-position"><option value="left" ${position === 'left' ? 'selected' : ''}>À esquerda</option><option value="right" ${position === 'right' ? 'selected' : ''}>À direita</option></select></label>` : `<label class="field-label">Alinhamento<select class="content-align"><option value="left" ${alignment === 'left' ? 'selected' : ''}>À esquerda</option><option value="center" ${alignment === 'center' ? 'selected' : ''}>Centralizado</option><option value="right" ${alignment === 'right' ? 'selected' : ''}>À direita</option><option value="justify" ${alignment === 'justify' ? 'selected' : ''}>Justificado</option></select></label>`}${['tip','warning'].includes(kind) ? `<label class="field-label content-color-field">Cor do bloco<input class="content-color" type="color" value="${accentColor}"></label>` : ''}</div>
      ${richTextKinds.includes(kind) ? '<div class="content-format-tools" aria-label="Formatação do texto"><button type="button" class="button secondary small-button" data-action="content-format" data-format="bold" title="Negrito (Ctrl+B)"><strong>N</strong></button><button type="button" class="button secondary small-button" data-action="content-format" data-format="italic" title="Itálico (Ctrl+I)"><em>I</em></button><small>Ctrl+B: negrito · Ctrl+I: itálico · Tab: recuo</small></div>' : ''}
      <label class="field-label">${kind === 'heading' ? 'Título' : kind === 'list' ? 'Um item por linha' : kind === 'postit' ? 'Texto do Post-it' : 'Texto'}<textarea class="content-text" rows="${kind === 'heading' ? 2 : kind === 'postit' ? 3 : 4}" placeholder="${kind === 'heading' ? 'Título da seção' : kind === 'list' ? 'Cada linha será um item' : 'Use a barra de ferramentas ou Ctrl+B / Ctrl+I para formatar'}">${esc(block.text || '')}</textarea></label>${['tip','example','warning'].includes(kind) ? `<label class="field-label">Título opcional<input class="content-title" value="${esc(block.title || '')}" placeholder="Título personalizado"></label>` : ''}${kind === 'list' ? `<label class="checkbox-line"><input class="content-ordered" type="checkbox" ${block.ordered ? 'checked' : ''}> Lista numerada</label>` : ''}`
    : '';
  const mediaControls = mediaKind
    ? `<label class="field-label">Como adicionar o material<select class="content-source"><option value="upload" ${source === 'upload' ? 'selected' : ''}>Enviar arquivo do computador</option><option value="link" ${source === 'link' ? 'selected' : ''}>Adicionar link</option></select></label><div class="content-upload-fields" ${source === 'upload' ? '' : 'hidden'}><label class="field-label">Arquivo${block.mediaName ? `<small class="form-help">Arquivo atual: ${esc(block.mediaName)}${block.mediaSize ? ` · ${(block.mediaSize / 1024 / 1024).toFixed(1)} MB` : ''}</small>` : ''}<input class="content-file" type="file" accept="${accepts}"><small class="form-help content-file-status">Limite de 15 MB por arquivo, armazenado neste navegador.</small></label></div><div class="content-link-fields" ${source === 'link' ? '' : 'hidden'}><label class="field-label">${kind === 'image' ? 'Endereço da imagem' : kind === 'video' ? 'Link do YouTube ou vídeo' : kind === 'audio' ? 'Link do arquivo de áudio' : 'Endereço do material'}<input class="content-url" type="url" value="${esc(block.url || '')}" placeholder="https://..."></label></div>`
    : `<label class="field-label">Endereço do material<input class="content-url" type="url" value="${esc(block.url || '')}" placeholder="https://..."></label>${kind === 'image' ? `<label class="field-label">Texto alternativo<input class="content-alt" value="${esc(block.alt || '')}" placeholder="Descreva a imagem"></label>` : `<label class="field-label">${kind === 'video' || kind === 'audio' ? 'Título' : 'Nome do material'}<input class="content-title" value="${esc(block.title || '')}" placeholder="${kind === 'pdf' ? 'Apostila de harmonia' : 'Material complementar'}"></label>`}`;
  return `<article class="content-editor-row" data-content-index="${index}" data-content-id="${esc(block.id || '')}" data-media-id="${esc(block.mediaId || '')}" data-media-name="${esc(block.mediaName || '')}" data-media-type="${esc(block.mediaType || '')}" data-media-size="${Number(block.mediaSize) || 0}"><div class="content-editor-tools"><span class="drag-handle" aria-hidden="true">⠿</span><select class="content-kind" aria-label="Tipo de conteúdo">${options.map(([value, label]) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="icon-button" type="button" data-action="content-up" aria-label="Mover para cima">↑</button><button class="icon-button" type="button" data-action="content-down" aria-label="Mover para baixo">↓</button><button class="icon-button remove" type="button" data-action="content-remove" aria-label="Remover bloco">×</button></div>
    ${textBlocks.includes(kind) ? `${textControls}` : `${mediaControls}`}</article>`;
}

function collectContentEditors(container) {
  return [...container.querySelectorAll('.content-editor-row')].map(row => {
    const type = row.querySelector('.content-kind').value;
    return {
      id: row.dataset.contentId || createId(),
      type,
      text: row.querySelector('.content-text')?.value || '',
      title: row.querySelector('.content-title')?.value || '',
      url: row.querySelector('.content-url')?.value.trim() || '',
      alt: row.querySelector('.content-alt')?.value.trim() || '',
      align: row.querySelector('.content-align')?.value || 'left',
      position: row.querySelector('.content-position')?.value || 'right',
      accentColor: row.querySelector('.content-color')?.value || '',
      ordered: row.querySelector('.content-ordered')?.checked || false,
      mediaSource: row.querySelector('.content-source')?.value || (row.dataset.mediaId ? 'upload' : 'link'),
      mediaId: row.dataset.mediaId || '',
      mediaName: row.dataset.mediaName || '',
      mediaType: row.dataset.mediaType || '',
      mediaSize: Number(row.dataset.mediaSize) || 0
    };
  });
}

function lessonDataFromDialog(dialog, { forAutosave = false } = {}) {
  const form = dialog.querySelector('#lesson-form');
  if (!form) return null;
  const formData = new FormData(form);
  const content = collectContentEditors(dialog);
  const title = String(formData.get('title') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const hasContent = Boolean(title || description || String(formData.get('subtitle') || '').trim()
    || String(formData.get('coverUrl') || '').trim() || content.length);
  const existingId = String(formData.get('id') || '');
  if (forAutosave && !existingId && !hasContent) return null;
  const id = existingId || createId();
  form.elements.namedItem('id').value = id;
  const previous = getLesson(id);
  const exerciseIds = [...dialog.querySelectorAll('[name="exerciseIds"]:checked')].map(input => input.value);
  return {
    previous,
    data: {
      id, blockId: String(formData.get('blockId') || ''),
      title, subtitle: String(formData.get('subtitle') || '').trim(),
      description, coverUrl: String(formData.get('coverUrl') || '').trim(),
      order: Number(formData.get('order')) || 1,
      published: forAutosave ? previous?.published === true : formData.get('published') === 'true',
      content,
      releaseMode: String(formData.get('releaseMode') || 'all'),
      releasedStudentIds: [...dialog.querySelectorAll('[name="lessonStudentIds"]:checked')].map(input => input.value),
      exerciseIds, createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function autoSaveLesson(dialog) {
  if (dialog.dataset.lessonCommitted === 'true' || dialog.dataset.lessonDeleted === 'true') return;
  const form = dialog.querySelector('#lesson-form');
  if (!form) return;
  const existingId = String(new FormData(form).get('id') || '');
  if (existingId && getLesson(existingId)?.published) {
    const status = dialog.querySelector('[data-lesson-save-status]');
    if (status) status.textContent = 'Aula publicada: salve para aplicar as alterações.';
    return;
  }
  const result = lessonDataFromDialog(dialog, { forAutosave: true });
  if (!result) return;
  const { data, previous } = result;
  if (previous) Object.assign(previous, data);
  else model.lessons.push(data);
  syncExerciseRelations(data.id, data.exerciseIds);
  try {
    model = saveModel(model);
    queueRemoteModelSave({ silent: true });
    const status = dialog.querySelector('[data-lesson-save-status]');
    if (status) status.textContent = data.published
      ? 'Alterações salvas automaticamente neste dispositivo.'
      : 'Rascunho salvo automaticamente neste dispositivo.';
    dialog.dataset.lessonAutoSaved = 'true';
  } catch (error) {
    toast(`Não foi possível salvar o rascunho: ${error.message}`, 'error');
    const status = dialog.querySelector('[data-lesson-save-status]');
    if (status) status.textContent = 'Falha ao salvar. Tente novamente.';
  }
}

function openLessonEditor(blockId = '', id = '') {
  const lesson = getLesson(id);
  if (lesson) blockId = lesson.blockId || '';
  const dialog = openDialog(`<p class="eyebrow">EDITOR DE AULA · BLOCOS DE CONTEÚDO</p><h2>${lesson ? 'Editar aula' : 'Criar aula'}</h2><p class="dialog-intro">Monte uma explicação em blocos e visualize o resultado antes de publicar.</p><form id="lesson-form" class="stack-form">
    <input type="hidden" name="id" value="${esc(id)}">
    <label class="field-label">Bloco de aulas<select name="blockId"><option value="">Sem bloco</option>${model.blocks.map(block => `<option value="${esc(block.id)}" ${block.id === blockId ? 'selected' : ''}>${esc(block.title)}</option>`).join('')}</select></label>
    <div class="form-grid"><label class="field-label">Título da aula<input name="title" required maxlength="100" value="${esc(lesson?.title || '')}" placeholder="Ex.: Formação de tríades"></label><label class="field-label">Subtítulo (opcional)<input name="subtitle" maxlength="140" value="${esc(lesson?.subtitle || '')}" placeholder="Uma frase que apresenta o tema"></label></div>
    <label class="field-label">Introdução<textarea name="description" rows="3" maxlength="600" placeholder="Apresente o objetivo desta aula">${esc(lesson?.description || '')}</textarea></label>
    <label class="field-label">Imagem de capa (URL opcional)<input name="coverUrl" type="url" value="${esc(lesson?.coverUrl || '')}" placeholder="https://..."></label>
    <div class="form-grid"><label class="field-label">Ordem de exibição<input name="order" type="number" min="1" value="${Number(lesson?.order) || model.lessons.filter(item => item.blockId === blockId).length + 1}"></label><label class="field-label">Publicação<select name="published"><option value="false" ${lesson?.published ? '' : 'selected'}>Rascunho</option><option value="true" ${lesson?.published ? 'selected' : ''}>Publicada</option></select></label></div>
    ${releaseSettingsMarkup(lesson, 'lesson')}
    <section class="builder-section"><div class="builder-heading"><div><h3>Conteúdo da aula</h3><p>Insira texto, listas, dicas, vídeos, partituras, áudio, links e Post-its.</p></div><select id="new-content-kind" aria-label="Adicionar bloco"><option value="">＋ Adicionar conteúdo</option><option value="text">Parágrafo</option><option value="heading">Título</option><option value="list">Lista</option><option value="tip">Dica</option><option value="example">Exemplo musical</option><option value="warning">Atenção</option><option value="postit">Post-it</option><option value="image">Imagem</option><option value="video">Vídeo</option><option value="link">Link</option><option value="pdf">PDF / Partitura</option><option value="audio">Áudio</option></select></div><div id="content-editor">${(lesson?.content || []).map(contentBlockEditor).join('')}</div>${button('Pré-visualizar aula', 'preview-lesson', 'secondary')}</section>
    <section class="builder-section"><div class="builder-heading"><div><h3>Exercícios relacionados</h3><p>Associe exercícios existentes sem duplicá-los.</p></div>${button('＋ Criar exercício', 'new-related-from-lesson', 'secondary', `data-id="${esc(id || 'new')}"`)}</div><label class="search-control relation-search"><span>⌕</span><input id="relation-search" type="search" placeholder="Pesquisar exercício por título"></label><div class="relation-list" id="lesson-exercise-list">${exerciseRelationsMarkup(lesson?.exerciseIds || [])}</div></section>
    <div class="dialog-actions"><span class="muted small" data-lesson-save-status aria-live="polite">${lesson?.published ? 'Aula publicada: salve para aplicar as alterações.' : 'As alterações são salvas automaticamente como rascunho.'}</span><button class="button primary" type="submit">${lesson ? 'Salvar aula' : 'Criar aula'}</button>${lesson ? button('Excluir aula', 'delete-lesson', 'danger', `data-id="${esc(id)}"`) : ''}</div>
  </form>`, 'lesson-modal');
  dialog.querySelector('#lesson-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('releaseMode') === 'selected' && !studentsLoaded) {
      showDialogNotice(dialog, 'Não foi possível carregar a lista de alunos. Tente novamente antes de escolher uma liberação específica.');
      return;
    }
    if (dialog.querySelector('.content-editor-row[data-media-uploading="true"]')) {
      toast('Aguarde o fim do envio dos arquivos antes de salvar a aula.', 'error');
      return;
    }
    const result = lessonDataFromDialog(dialog);
    if (!result) return;
    const { data, previous } = result;
    const content = data.content;
    const invalidMedia = content.find(block => isMediaBlock(block)
      && (block.mediaSource === 'upload' ? !block.mediaId : !safeUrl(block.url)));
    if (invalidMedia) {
      toast(invalidMedia.mediaSource === 'upload'
        ? 'Selecione e aguarde o envio do arquivo de cada material.'
        : 'Informe um link HTTP ou HTTPS válido para cada material.', 'error');
      return;
    }
    data.published = form.get('published') === 'true';
    if (previous) Object.assign(previous, data);
    else model.lessons.push(data);
    syncExerciseRelations(data.id, data.exerciseIds);
    dialog.dataset.lessonCommitted = 'true';
    dialog.close();
    persist(lesson ? 'Aula atualizada.' : 'Aula criada.');
  });
  dialog.addEventListener('close', () => {
    if (!lesson && dialog.dataset.lessonCommitted !== 'true') autoSaveLesson(dialog);
  });
  const lessonForm = dialog.querySelector('#lesson-form');
  const saveOnEdit = event => {
    if (event.target.id === 'relation-search') return;
    autoSaveLesson(dialog);
  };
  lessonForm.addEventListener('input', saveOnEdit);
  lessonForm.addEventListener('change', saveOnEdit);
  loadStudentsForRelease(dialog, 'lessonStudentIds');
  const contentEditor = dialog.querySelector('#content-editor');
  contentEditor.addEventListener('keydown', event => {
    const textarea = event.target.closest('.content-text');
    if (!textarea) return;
    if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      formatContentText(textarea, event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      indentContentText(textarea);
    }
  });
  contentEditor.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-action="content-format"]')) event.preventDefault();
  });
  contentEditor.addEventListener('change', event => {
    if (!event.target.matches('.content-kind')) return;
    const list = collectContentEditors(contentEditor);
    const index = Number(event.target.closest('.content-editor-row').dataset.contentIndex);
    list[index].type = event.target.value;
    contentEditor.innerHTML = list.map(contentBlockEditor).join('');
    autoSaveLesson(dialog);
  });
  dialog.querySelector('#relation-search').addEventListener('input', event => {
    const query = event.target.value.toLocaleLowerCase('pt-BR');
    dialog.querySelectorAll('.relation-item').forEach(item => { item.hidden = !item.textContent.toLocaleLowerCase('pt-BR').includes(query); });
  });
}

function exerciseRelationsMarkup(selected = []) {
  return visibleExercises().map(exercise => {
    const status = exerciseStatus(exercise);
    const statusLabel = { draft: 'Rascunho', published: 'Publicado', closed: 'Encerrado', archived: 'Arquivado' }[status];
    return `<label class="relation-item"><input type="checkbox" name="exerciseIds" value="${esc(exercise.id)}" ${selected.includes(exercise.id) ? 'checked' : ''}><span><strong>${esc(exercise.title || 'Exercício sem título')}</strong><small>${esc(types[exercise.questions?.[0]?.type] || 'Exercício')} · ${exercise.questions?.length || 0} questões</small></span><span class="status-tag ${status}">${statusLabel}</span></label>`;
  }).join('') || '<p class="muted small">Ainda não há exercícios cadastrados. Salve um exercício, mesmo como rascunho, para associá-lo.</p>';
}

function syncExerciseRelations(lessonId, exerciseIds) {
  for (const exercise of model.exercises) {
    exercise.lessonIds = Array.isArray(exercise.lessonIds) ? exercise.lessonIds : [];
    const had = exercise.lessonIds.includes(lessonId);
    const should = exerciseIds.includes(exercise.id);
    if (should && !had) exercise.lessonIds.push(lessonId);
    if (!should && had) exercise.lessonIds = exercise.lessonIds.filter(id => id !== lessonId);
  }
}

function setContentEditors(list) {
  const editor = root.querySelector('#active-dialog #content-editor');
  if (editor) editor.innerHTML = list.map(contentBlockEditor).join('');
}

function openExerciseEditor(id = '', relatedLessonId = '', asAssessment = false, initialExerciseBlockId = '') {
  const exercise = getExercise(id);
  const isAssessment = Boolean(exercise?.assessment || asAssessment);
  const releaseField = 'activityStudentIds';
  if (!exercise && !isAssessment && !model.exerciseBlocks.length) {
    const blockDialog = openExerciseBlockEditor();
    showDialogNotice(blockDialog, 'Crie um bloco de exercícios para organizar esta atividade.', blockDialog.querySelector('[name="title"]'));
    return;
  }
  const defaultExerciseBlockId = exercise?.exerciseBlockId || initialExerciseBlockId
    || (selectedExerciseBlockId && selectedExerciseBlockId !== 'unassigned' ? selectedExerciseBlockId : '')
    || model.exerciseBlocks[0]?.id || '';
  const initialQuestions = exercise?.questions || [{ id: createId(), type: 'choice', prompt: '', points: 1, options: ['', ''], answer: '' }];
  exerciseDraft = structuredClone(initialQuestions);
  pendingScoreFiles = new Map();
  const dialog = openDialog(`<p class="eyebrow">CONSTRUTOR DE ATIVIDADES</p><h2>${exercise ? isAssessment ? 'Editar avaliação' : 'Editar exercício' : isAssessment ? 'Criar avaliação' : 'Criar exercício'}</h2><p class="dialog-intro">Cada questão tem seus próprios campos, pontuação e critério de correção.</p><form id="exercise-form" class="stack-form" novalidate>
    <input type="hidden" name="id" value="${esc(id)}">
    <label class="field-label">Título do exercício<input name="title" maxlength="100" value="${esc(exercise?.title || '')}" placeholder="Ex.: Identificação de tríades"></label>
    <label class="field-label exercise-group-field">Bloco de exercícios<select name="exerciseBlockId" ${isAssessment ? 'disabled' : 'required'}><option value="">Escolha um bloco</option>${model.exerciseBlocks.map(block => `<option value="${esc(block.id)}" ${block.id === defaultExerciseBlockId ? 'selected' : ''}>${esc(block.title)}</option>`).join('')}</select><small class="form-help">${isAssessment ? 'Avaliações ficam separadas dos blocos de exercícios.' : 'A atividade ficará organizada dentro deste bloco.'}</small></label>
    <label class="field-label">Instruções<textarea name="instructions" rows="2" maxlength="400" placeholder="Orientações para quem vai responder">${esc(exercise?.instructions || '')}</textarea></label>
    <div class="form-grid"><label class="field-label">Dificuldade<select name="difficulty">${['Iniciante','Intermediário','Avançado'].map(level => `<option ${exercise?.difficulty === level ? 'selected' : ''}>${level}</option>`).join('')}</select></label><label class="field-label">Estado da atividade<select name="status">${[['draft','Rascunho'],['published','Publicado'],['closed','Encerrado'],['archived','Arquivado']].map(([value,label]) => `<option value="${value}" ${exerciseStatus(exercise || {}) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
    <section class="builder-section assessment-config"><div class="builder-heading"><div><h3>Formato e liberação</h3><p>Provas ficam trancadas até a data definida; o relógio inicia após a contagem regressiva.</p></div></div><div class="form-grid"><label class="field-label">Tipo<select name="activityKind"><option value="exercise" ${!isAssessment ? 'selected' : ''}>Exercício</option><option value="assessment" ${isAssessment ? 'selected' : ''}>Avaliação / prova</option></select></label><label class="field-label">Tempo para responder (minutos)<input name="durationMinutes" type="number" min="1" max="300" value="${Number(exercise?.assessment?.durationMinutes) || 30}"></label><label class="field-label">Liberar em<input name="releaseAt" type="datetime-local" value="${dateTimeLocalValue(exercise?.assessment?.releaseAt)}"></label><label class="field-label">Prazo final<input name="deadlineAt" type="datetime-local" value="${dateTimeLocalValue(exercise?.assessment?.deadlineAt)}"></label></div><label class="checkbox-line"><input name="lockOnExit" type="checkbox" ${exercise?.assessment?.lockOnExit === false ? '' : 'checked'}> Bloquear se o aluno ficar fora por mais de 3 minutos</label></section>
    ${releaseSettingsMarkup(exercise, 'activity')}
    <label class="checkbox-line"><input name="showAnswers" type="checkbox" ${exercise?.showAnswers ? 'checked' : ''}> Mostrar gabarito e explicação após a tentativa</label>
    <section class="builder-section"><div class="builder-heading"><div><h3>Questões</h3><p>Escolha um formato apropriado para cada questão.</p></div>${button('＋ Adicionar questão', 'add-question', 'secondary')}</div><div id="question-editor"></div></section>
    <section class="builder-section"><div class="builder-heading"><div><h3>Relacionar a aulas</h3><p>O mesmo exercício pode aparecer em várias aulas.</p></div></div><div class="relation-list">${model.lessons.map(lesson => `<label class="relation-item"><input type="checkbox" name="lessonIds" value="${esc(lesson.id)}" ${(exercise?.lessonIds || []).includes(lesson.id) || lesson.id === relatedLessonId ? 'checked' : ''}><span><strong>${esc(lesson.title)}</strong><small>${esc(getBlock(lesson.blockId)?.title || 'Aula independente')}</small></span></label>`).join('') || '<p class="muted small">Crie uma aula para poder relacioná-la.</p>'}</div></section>
    <div class="dialog-actions"><span class="muted small" data-exercise-save-status aria-live="polite">${exercise && exerciseStatus(exercise) !== 'draft' ? 'Atividade publicada ou encerrada: salve para aplicar as alterações.' : 'As alterações são salvas automaticamente como rascunho.'}</span><button class="button secondary" type="button" data-action="save-exercise-draft">Salvar rascunho</button><button class="button primary" type="submit">${exercise ? isAssessment ? 'Salvar e publicar avaliação' : 'Salvar e publicar exercício' : isAssessment ? 'Publicar avaliação' : 'Publicar exercício'}</button>${exercise ? button('Excluir exercício', 'delete-exercise', 'danger', `data-id="${esc(id)}"`) : ''}</div>
  </form>`, 'exercise-modal');
  renderQuestionEditors(dialog);
  dialog.querySelector('#exercise-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('releaseMode') === 'selected' && !studentsLoaded) {
      showDialogNotice(dialog, 'Não foi possível carregar a lista de alunos. Tente novamente antes de escolher uma liberação específica.');
      return;
    }
    saveExerciseFromDialog(dialog, event.currentTarget.elements.namedItem('id').value, dialog.querySelector('[name="status"]').value === 'draft');
  });
  dialog.addEventListener('close', () => {
    if (dialog.dataset.exerciseCommitted !== 'true') autoSaveExercise(dialog);
  });
  const exerciseForm = dialog.querySelector('#exercise-form');
  exerciseForm.addEventListener('input', event => {
    if (event.target.matches('.question-kind')) return;
    if (event.target.closest('#question-editor')) {
      exerciseDraft = collectQuestionEditors(dialog);
      if (event.target.matches('.question-prompt')) updateChordAssist(event.target.closest('.question-editor-row'));
      if (event.target.matches('.question-musicxml-url')) {
        const row = event.target.closest('.question-editor-row');
        scoreXmlCache.delete(row.dataset.questionId);
        const previewButton = row.querySelector('[data-action="preview-score"]');
        if (previewButton) previewButton.disabled = !safeUrl(event.target.value);
        const playButton = row.querySelector('[data-action="play-score-preview"]');
        if (playButton) playButton.disabled = true;
      }
    }
    autoSaveExercise(dialog);
  });
  exerciseForm.addEventListener('change', event => {
    if (event.target.matches('.question-kind, .question-score-source, .question-material-source, .question-prompt-score-source, .question-musicxml, .question-material-file, .question-prompt-file, .question-prompt-score-file, .question-audio-file')) return;
    if (event.target.closest('#question-editor')) exerciseDraft = collectQuestionEditors(dialog);
    autoSaveExercise(dialog);
  });
  const blockSelect = dialog.querySelector('[name="exerciseBlockId"]');
  loadStudentsForRelease(dialog, releaseField);
  const updatePublishLabel = () => {
    const submit = dialog.querySelector('#exercise-form button[type="submit"]');
    const status = dialog.querySelector('[name="status"]').value;
    submit.textContent = status === 'published'
      ? isAssessment ? 'Publicar avaliação' : 'Publicar exercício'
      : status === 'draft'
        ? isAssessment ? 'Salvar avaliação como rascunho' : 'Salvar exercício como rascunho'
        : isAssessment ? 'Salvar avaliação' : 'Salvar exercício';
  };
  dialog.querySelector('[name="status"]').addEventListener('change', updatePublishLabel);
  updatePublishLabel();
  const updateBlockRequirement = () => {
    const assessmentSelected = dialog.querySelector('[name="activityKind"]').value === 'assessment';
    blockSelect.disabled = assessmentSelected;
    blockSelect.required = !assessmentSelected;
  };
  dialog.querySelector('[name="activityKind"]').addEventListener('change', updateBlockRequirement);
  dialog.querySelector('#question-editor').addEventListener('change', event => {
    if (!event.target.matches('.question-kind')) return;
    const row = event.target.closest('.question-editor-row');
    const index = Number(row.dataset.questionIndex);
    const nextType = event.target.value;
    const questionId = row.dataset.questionId;
    const previousType = exerciseDraft.find(question => question.id === questionId)?.type || 'written';
    event.target.value = previousType;
    const questions = collectQuestionEditors(dialog);
    event.target.value = nextType;
    questions[index].type = nextType;
    if (nextType === 'choice' && !questions[index].options) questions[index].options = ['', ''];
    if (nextType === 'boolean' && !['Verdadeiro', 'Falso'].includes(questions[index].answer)) {
      questions[index].answer = 'Verdadeiro';
    }
    exerciseDraft = questions;
    renderQuestionEditors(dialog);
    autoSaveExercise(dialog, { force: true });
  });
  dialog.querySelector('#question-editor').addEventListener('input', event => {
    if (event.target.matches('.question-kind')) return;
    exerciseDraft = collectQuestionEditors(dialog);
    if (event.target.matches('.question-prompt')) updateChordAssist(event.target.closest('.question-editor-row'));
  });
  dialog.querySelector('#question-editor').addEventListener('change', event => {
    if (event.target.matches('.chord-text-color')) {
      const row = event.target.closest('.question-editor-row');
      applyPromptColor(row?.querySelector('.question-prompt'), event.target.value, row?._promptSelection);
      exerciseDraft = collectQuestionEditors(dialog);
    }
  });
  dialog.querySelector('#question-editor').addEventListener('pointerdown', event => {
    const row = event.target.closest('.question-editor-row');
    const editor = row?.querySelector('.question-prompt');
    if (editor && event.target.matches('.chord-text-color')) {
      const selection = window.getSelection();
      if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        row._promptSelection = selection.getRangeAt(0).cloneRange();
      }
    } else if (event.target.closest('.chord-assist-button')) event.preventDefault();
  });
  dialog.querySelector('#question-editor').addEventListener('paste', event => {
    const target = event.target.closest('.question-prompt');
    if (!target) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function promptSelection(editor, savedRange) {
  const selection = window.getSelection();
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) return savedRange;
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}

function applyPromptColor(editor, color, savedRange = null) {
  if (!editor || !/^#[0-9a-f]{6}$/i.test(color)) return;
  const range = promptSelection(editor, savedRange);
  if (!range || range.collapsed) return;
  const span = document.createElement('span');
  span.style.color = color;
  span.append(range.extractContents());
  range.insertNode(span);
  const selection = window.getSelection();
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  selection.addRange(next);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertPromptSymbol(editor, symbol) {
  if (!editor) return;
  const range = promptSelection(editor);
  if (!range) {
    editor.focus();
    return;
  }
  range.collapse(false);
  const inserted = document.createTextNode(symbol);
  range.insertNode(inserted);
  range.setStartAfter(inserted);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function formatPromptSelection(editor, format) {
  if (!editor) return;
  const range = promptSelection(editor);
  if (!range || range.collapsed || format !== 'bold') return;
  const strong = document.createElement('strong');
  strong.append(range.extractContents());
  range.insertNode(strong);
  const selection = window.getSelection();
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(strong);
  selection.addRange(next);
  editor.focus();
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

async function prepareScoreEditor(row, question, loadedXml = '') {
  const preview = row.querySelector('.score-editor-preview-render');
  if (!preview) return;
  const xml = loadedXml || await loadQuestionMusicXml(question);
  if (!row.isConnected) return;
  scoreXmlCache.set(question.id, xml);
  await renderMusicXml(xml, preview);
  preview.hidden = false;
  row.querySelector('[data-action="preview-score"]').disabled = false;
  row.querySelector('[data-action="play-score-preview"]').disabled = false;
  const status = row.querySelector('[data-score-editor-status]');
  if (status) status.textContent = 'Partitura pronta para visualizar e ouvir.';
}

async function previewPromptScore(row, question, loadedXml = '') {
  const preview = row.querySelector('.prompt-score-preview');
  const playButton = row.querySelector('[data-action="play-prompt-score-preview"]');
  if (!preview || !playButton) return;
  const source = row.querySelector('.question-prompt-score-source')?.value || question.promptScoreSource || 'upload';
  if (source === 'link') {
    const url = row.querySelector('.question-prompt-score-url')?.value || question.promptScoreUrl || '';
    const museScoreUrl = museScoreScoreUrl(url);
    if (museScoreUrl) {
      preview.innerHTML = `<div class="musescore-score-link"><p class="form-help">O MuseScore não permite exibir esta partitura dentro do Notarium. Abra o link para visualizar e ouvir, ou adicione o arquivo MusicXML/MXL para usar a partitura aqui.</p><a class="button secondary small-button" href="${esc(museScoreUrl)}" target="_blank" rel="noopener noreferrer">Abrir e ouvir no MuseScore ↗</a></div>`;
      preview.hidden = false;
      playButton.disabled = true;
      row.querySelector('.prompt-score-status').textContent = 'O link abre no MuseScore. Para visualizar e ouvir dentro do Notarium, adicione o arquivo MusicXML/MXL.';
      return;
    }
  }
  const xml = loadedXml || await loadPromptScoreXml({
    ...question,
    promptScoreSource: source,
    promptScoreUrl: row.querySelector('.question-prompt-score-url')?.value || question.promptScoreUrl,
    promptScoreMediaId: row.dataset.promptScoreMediaId || question.promptScoreMediaId,
    promptScoreMediaName: row.dataset.promptScoreMediaName || question.promptScoreMediaName,
    promptScoreMediaType: row.dataset.promptScoreMediaType || question.promptScoreMediaType
  });
  if (!row.isConnected) return;
  scoreXmlCache.set(`prompt-score:${question.id}`, xml);
  preview.replaceChildren();
  await renderMusicXml(xml, preview);
  preview.hidden = false;
  playButton.disabled = false;
  row.querySelector('.prompt-score-status').textContent = 'Partitura pronta para visualizar e ouvir.';
}

function renderQuestionEditors(dialog) {
  const editor = dialog.querySelector('#question-editor');
  editor.innerHTML = exerciseDraft.map((question, index) => {
    const kind = question.type || 'written';
    let specific = '';
    if (kind === 'choice') {
      const options = (question.options || ['', '']).join('\n');
      specific = `<label class="field-label">Alternativas (uma por linha)<textarea class="question-options" rows="4" placeholder="Dó maior&#10;Dó menor&#10;Sol maior">${esc(options)}</textarea></label><label class="field-label">Resposta correta<input class="question-answer" value="${esc(question.answer || '')}" placeholder="Copie o texto da alternativa correta"></label>`;
    } else if (kind === 'boolean') {
      specific = `<label class="field-label">Resposta correta<select class="question-answer"><option value="Verdadeiro" ${question.answer === 'Verdadeiro' ? 'selected' : ''}>Verdadeiro</option><option value="Falso" ${question.answer === 'Falso' ? 'selected' : ''}>Falso</option></select></label>`;
    } else if (kind === 'chord') {
      const chordOrder = question.chordOrder || (question.assemblyOrder?.length ? 'sequence' : 'any');
      specific = `<label class="field-label">Notas esperadas (ex.: C E G ou C4 E4 G4)<input class="question-notes" value="${esc((question.expectedNotes || []).join(', '))}" placeholder="C E G"><small class="form-help">A oitava é opcional; usa a oitava padrão do perfil quando omitida.</small></label><div class="form-grid"><label class="field-label">Critério de correção<select class="question-chord-criterion"><option value="notes" ${question.correctionCriterion !== 'intervals' ? 'selected' : ''}>Notas definidas</option><option value="intervals" ${question.correctionCriterion === 'intervals' ? 'selected' : ''}>Intervalos do acorde, em qualquer tom</option></select></label><label class="field-label">Intervalos esperados (semitons)<input class="question-intervals" value="${esc((question.expectedIntervals || []).join(', '))}" placeholder="4, 3, 5"><small class="form-help">Opcional; sem valores, os intervalos seguem a ordem das notas esperadas.</small></label></div><div class="form-grid"><label class="field-label">Critério de disposição<select class="question-chord-order"><option value="any" ${chordOrder === 'any' ? 'selected' : ''}>Qualquer ordem · aceitar inversões</option><option value="sequence" ${chordOrder === 'sequence' ? 'selected' : ''}>Seguir a sequência didática</option><option value="inversion" ${chordOrder === 'inversion' ? 'selected' : ''}>Exigir a inversão/disposição esperada</option></select></label><label class="field-label">Sequência didática (opcional)<input class="question-assembly-order" value="${esc((question.assemblyOrder || []).join(', '))}" placeholder="C E G"><small class="form-help">A sequência de montagem também pode ser definida aqui.</small></label></div><label class="field-label">Dicas por etapa (opcional)<textarea class="question-assembly-hints" rows="2" placeholder="Uma dica por linha">${esc((question.assemblyHints || []).join('\n'))}</textarea></label><label class="checkbox-line"><input class="question-ignore-octave" type="checkbox" ${question.ignoreOctave ? 'checked' : ''}> Ignorar oitavas ao corrigir as notas</label><label class="checkbox-line"><input class="question-accept-enharmonic" type="checkbox" ${question.acceptEnharmonic !== false ? 'checked' : ''}> Aceitar equivalências enarmônicas ao corrigir as notas definidas (ex.: C# e Db)</label><label class="field-label">Acorde de referência para comparação (opcional)<input class="question-reference-notes" value="${esc((question.referenceNotes || []).join(', '))}" placeholder="C3, E3, G3"></label>`;
    } else if (kind === 'ear') {
      specific = `<label class="field-label">Acorde de referência — notas (ex.: C3, E3, G3)<input class="question-reference-notes" value="${esc((question.referenceNotes || []).join(', '))}" placeholder="C3, E3, G3"></label><label class="field-label">Resposta esperada<input class="question-answer" value="${esc(question.answer || '')}" placeholder="Ex.: Dó maior"></label>`;
    } else if (kind === 'score') {
      const scoreSource = question.scoreSource || (question.musicMediaId || question.musicXml ? 'upload' : 'link');
      const scoreName = pendingScoreFiles.get(question.id)?.name || question.musicMediaName || '';
      const hasScore = scoreSource === 'upload'
        ? Boolean(pendingScoreFiles.has(question.id) || question.musicMediaId || question.musicXml)
        : Boolean(safeUrl(question.musicUrl));
      specific = `<label class="field-label">Como adicionar a partitura<select class="question-score-source"><option value="upload" ${scoreSource === 'upload' ? 'selected' : ''}>Enviar arquivo do computador</option><option value="link" ${scoreSource === 'link' ? 'selected' : ''}>Adicionar link</option></select></label><div class="score-upload-fields" ${scoreSource === 'upload' ? '' : 'hidden'}><label class="field-label">Arquivo MusicXML (.xml, .musicxml ou .mxl)<input class="question-musicxml" type="file" accept=".xml,.musicxml,.mxl,application/xml,application/vnd.recordare.musicxml,application/zip"></label><small class="form-help">${scoreName ? `Arquivo anexado: ${esc(scoreName)}. ` : ''}Até 5 MB; arquivos XML e MXL são aceitos.</small></div><div class="score-link-fields" ${scoreSource === 'link' ? '' : 'hidden'}><label class="field-label">Link público da partitura<input class="question-musicxml-url" type="url" value="${esc(question.musicUrl || '')}" placeholder="https://.../partitura.xml"><small class="form-help">Aceita links para XML, MusicXML e MXL. O servidor deve permitir acesso externo (CORS).</small></label></div><div class="score-editor-preview"><div class="score-render score-editor-preview-render" hidden></div><div class="score-editor-actions"><button class="button secondary small-button" type="button" data-action="preview-score" data-question="${esc(question.id)}" ${hasScore ? '' : 'disabled'}>Visualizar partitura</button><button class="button secondary small-button" type="button" data-action="play-score-preview" data-question="${esc(question.id)}" ${hasScore ? '' : 'disabled'}>♫ Ouvir partitura</button></div><small class="form-help" data-score-editor-status>${hasScore ? 'Carregando a partitura para pré-visualização e reprodução…' : 'Envie ou adicione um link para visualizar e ouvir a partitura.'}</small></div><div class="form-grid"><label class="field-label">Número do compasso<input class="question-measure" type="number" min="1" value="${esc(question.measure || 1)}"></label><label class="field-label">Resposta esperada (ou deixe vazia para correção manual)<input class="question-answer" value="${esc(question.answer || '')}" placeholder="Ex.: Sol maior"></label></div>`;
    } else if (kind === 'rhythm') {
      const scoreName = pendingScoreFiles.get(question.id)?.name || question.musicMediaName || '';
      specific = `<label class="field-label">Partitura rítmica · MusicXML (.xml, .musicxml ou .mxl)<input class="question-musicxml" type="file" accept=".xml,.musicxml,.mxl,application/xml,application/vnd.recordare.musicxml,application/zip"><small class="form-help">${scoreName ? `Arquivo anexado: ${esc(scoreName)}. ` : ''}Até 5 MB. Selecione uma melodia de uma parte para melhor leitura rítmica.</small></label><div class="form-grid"><label class="field-label">Execuções permitidas<input class="question-rhythm-retry-limit" type="number" min="1" max="10" value="${Math.min(10, Math.max(1, Number(question.retryLimit) || 3))}"></label><label class="field-label">Tolerância rítmica (ms)<input class="question-rhythm-tolerance" type="number" min="60" max="500" step="10" value="${Math.min(500, Math.max(60, Number(question.toleranceMs) || 220))}"></label></div><small class="form-help">Depois da contagem de quatro tempos, o aluno toca cada nota no início correto. Os erros de cada execução ficam salvos.</small>`;
    } else if (kind === 'material') {
      const materialSource = question.mediaSource || (question.mediaId ? 'upload' : 'link');
      const name = question.mediaName || '';
      specific = `<label class="field-label">Como adicionar o material<select class="question-material-source"><option value="upload" ${materialSource === 'upload' ? 'selected' : ''}>Enviar arquivo do computador</option><option value="link" ${materialSource === 'link' ? 'selected' : ''}>Adicionar link</option></select></label><div class="material-upload-fields" ${materialSource === 'upload' ? '' : 'hidden'}><label class="field-label">Arquivo de apoio${name ? `<small class="form-help">Arquivo atual: ${esc(name)}</small>` : ''}<input class="question-material-file" type="file" accept="image/*,audio/*,video/*,.pdf,application/pdf"><small class="form-help question-material-status">Limite de 15 MB, salvo neste navegador.</small></label></div><div class="material-link-fields" ${materialSource === 'link' ? '' : 'hidden'}><label class="field-label">Link público do material<input class="question-reference-url" type="url" value="${esc(question.referenceUrl || '')}" placeholder="https://..."></label></div><label class="checkbox-line"><input class="question-manual" type="checkbox" checked disabled> Resposta discursiva para correção manual</label>`;
    } else if (kind === 'custom') {
      specific = `<label class="field-label">Resposta aceita (opcional)<input class="question-answer" value="${esc(question.answer || '')}" placeholder="Deixe vazio para revisar manualmente"></label><label class="field-label">Equivalências autorizadas (separadas por ponto e vírgula)<input class="question-accepted" value="${esc((question.acceptedAnswers || []).join('; '))}" placeholder="Fá maior; F"></label>`;
    } else {
      specific = `<label class="field-label">Resposta esperada (opcional)<input class="question-answer" value="${esc(question.answer || '')}" placeholder="Deixe vazio para revisão manual"></label><label class="field-label">Equivalências autorizadas (separadas por ponto e vírgula)<input class="question-accepted" value="${esc((question.acceptedAnswers || []).join('; '))}" placeholder="Ré menor; Dm"></label>`;
    }
    const promptName = question.promptMediaName || '';
    const audioName = question.audioMediaName || '';
    return `<article class="question-editor-row" data-question-index="${index}" data-question-id="${esc(question.id)}" data-prompt-media-id="${esc(question.promptMediaId || '')}" data-prompt-media-name="${esc(promptName)}" data-prompt-media-type="${esc(question.promptMediaType || '')}" data-prompt-media-size="${Number(question.promptMediaSize) || 0}" data-audio-media-id="${esc(question.audioMediaId || '')}" data-audio-media-name="${esc(audioName)}" data-audio-media-type="${esc(question.audioMediaType || '')}" data-audio-media-size="${Number(question.audioMediaSize) || 0}" data-audio-frequency="${esc(question.audioFrequency || '')}"><div class="question-editor-top"><span class="question-number">${String(index + 1).padStart(2, '0')}</span><label class="field-label">Formato<select class="question-kind">${Object.entries(types).map(([value,label]) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label><label class="field-label">Pontuação<input class="question-points" type="number" min="0" max="100" step="0.5" value="${Number(question.points ?? 1)}"></label><div class="question-tools"><button class="icon-button" type="button" data-action="question-up" aria-label="Mover para cima">↑</button><button class="icon-button" type="button" data-action="question-down" aria-label="Mover para baixo">↓</button><button class="icon-button remove" type="button" data-action="question-remove" aria-label="Remover questão">×</button></div></div><label class="field-label">Enunciado<div class="question-prompt rich-prompt-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Enunciado da questão" data-placeholder="Escreva a questão">${sanitizeRichText(question.prompt || '')}</div>${chordAssistMarkup()}</label><section class="question-media-editor"><h4>Mídia no enunciado</h4><label class="field-label">Imagem ou arquivo de apoio <span class="optional-label">Opcional</span><input class="question-prompt-file" type="file" accept="image/*,application/pdf,.pdf,.txt,.doc,.docx,.zip"><small class="form-help question-prompt-status">${promptName ? `Arquivo atual: ${esc(promptName)}` : 'A imagem ou o PDF será exibido dentro da questão; até 20 MB.'}</small></label><div class="question-audio-config"><div><strong>Áudio de referência</strong><small>Grave agora ou envie um arquivo para o aluno ouvir.</small></div><label class="field-label">Frequência (Hz) <input class="question-audio-frequency" type="number" min="1" max="20000" step="1" value="${esc(question.audioFrequency || '')}" placeholder="Ex.: 440"></label></div><label class="field-label">Enviar áudio<input class="question-audio-file" type="file" accept="audio/*"><small class="form-help question-audio-status">${audioName ? `Arquivo atual: ${esc(audioName)}` : 'Arquivos de áudio até 20 MB.'}</small></label><div class="recording-actions"><button class="button secondary small-button" type="button" data-action="record-audio">● Gravar áudio</button><button class="button secondary small-button" type="button" data-action="stop-audio-recording" disabled>■ Parar gravação</button></div><div class="question-audio-preview">${question.audioMediaId ? uploadedMediaMarkup(question.audioMediaId, audioName, question.audioMediaType, '', '', question.audioFrequency || '') : ''}</div></section><label class="checkbox-line"><input class="question-allow-audio-response" type="checkbox" ${question.allowAudioResponse ? 'checked' : ''}> Permitir que o aluno envie uma resposta em áudio</label><label class="checkbox-line question-audio-required-line" ${question.allowAudioResponse ? '' : 'hidden'}><input class="question-require-audio-response" type="checkbox" ${question.requireAudioResponse ? 'checked' : ''}> Exigir áudio como resposta</label>${specific}<label class="field-label">Feedback ou explicação<textarea class="question-feedback" rows="2" maxlength="500" placeholder="Explicação após a resposta">${esc(question.feedback || '')}</textarea></label></article>`;
  }).join('');
  editor.querySelectorAll('.question-editor-row').forEach(row => {
    const question = exerciseDraft.find(item => item.id === row.dataset.questionId);
    row.dataset.promptScoreMediaId = question?.promptScoreMediaId || '';
    row.dataset.promptScoreMediaName = question?.promptScoreMediaName || '';
    row.dataset.promptScoreMediaType = question?.promptScoreMediaType || '';
    row.dataset.promptScoreMediaSize = String(question?.promptScoreMediaSize || 0);
    const mediaEditor = row.querySelector('.question-media-editor');
    const source = question?.promptScoreSource || (question?.promptScoreMediaId ? 'upload' : 'link');
    const section = document.createElement('section');
    section.className = 'question-score-media-editor';
    section.innerHTML = `<h4>Partitura após o enunciado <span class="optional-label">Opcional</span></h4><label class="field-label">Adicionar partitura<select class="question-prompt-score-source"><option value="upload" ${source === 'upload' ? 'selected' : ''}>Enviar XML/MXL</option><option value="link" ${source === 'link' ? 'selected' : ''}>Link direto ou MuseScore</option></select></label><div class="prompt-score-upload-fields" ${source === 'upload' ? '' : 'hidden'}><label class="field-label">Arquivo MusicXML (.xml, .musicxml ou .mxl)<input class="question-prompt-score-file" type="file" accept=".xml,.musicxml,.mxl,application/xml,application/vnd.recordare.musicxml,application/zip"></label></div><div class="prompt-score-link-fields" ${source === 'link' ? '' : 'hidden'}><label class="field-label">Link da partitura<input class="question-prompt-score-url" type="url" value="${esc(question?.promptScoreUrl || '')}" placeholder="https://musescore.com/.../scores/... ou https://.../partitura.mxl"><small class="form-help">Links do MuseScore abrem em outra guia por restrição do site. Links diretos de XML/MXL podem ser exibidos e reproduzidos aqui, se o servidor permitir acesso.</small></label></div><small class="form-help prompt-score-status">${question?.promptScoreMediaName ? `Arquivo atual: ${esc(question.promptScoreMediaName)}` : 'A partitura será exibida depois do enunciado. O aluno poderá ouvi-la.'}</small><div class="prompt-score-preview" hidden></div><div class="prompt-score-actions"><button class="button secondary small-button" type="button" data-action="preview-prompt-score" ${question?.promptScoreMediaId || safeUrl(question?.promptScoreUrl) ? '' : 'disabled'}>Visualizar partitura</button><button class="button secondary small-button" type="button" data-action="play-prompt-score-preview" data-cache-key="prompt-score:${esc(row.dataset.questionId)}" data-question="${esc(row.dataset.questionId)}" disabled>♫ Ouvir partitura</button></div>`;
    mediaEditor?.append(section);
    if (question?.promptScoreMediaId || safeUrl(question?.promptScoreUrl)) {
      previewPromptScore(row, question).catch(error => {
        row.querySelector('.prompt-score-status').textContent = error.message;
      });
    }
    const sourceInput = section.querySelector('.question-prompt-score-source');
    sourceInput.addEventListener('change', () => {
      section.querySelector('.prompt-score-upload-fields').hidden = sourceInput.value !== 'upload';
      section.querySelector('.prompt-score-link-fields').hidden = sourceInput.value !== 'link';
      section.querySelector('.prompt-score-preview').hidden = true;
      section.querySelector('[data-action="preview-prompt-score"]').disabled = true;
      section.querySelector('[data-action="play-prompt-score-preview"]').disabled = true;
      scoreXmlCache.delete(`prompt-score:${row.dataset.questionId}`);
      section.querySelector('.prompt-score-status').textContent = 'Carregue ou informe a partitura para visualizar e ouvir.';
      autoSaveExercise(dialog);
    });
    section.querySelector('.question-prompt-score-url').addEventListener('input', event => {
      const url = event.target.value.trim();
      const enabled = Boolean(safeUrl(url));
      section.querySelector('[data-action="preview-prompt-score"]').disabled = !enabled;
      section.querySelector('[data-action="play-prompt-score-preview"]').disabled = true;
      section.querySelector('.prompt-score-preview').hidden = true;
      scoreXmlCache.delete(`prompt-score:${row.dataset.questionId}`);
    });
    section.querySelector('.question-prompt-score-file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        event.target.value = '';
        section.querySelector('.prompt-score-status').textContent = 'O arquivo da partitura deve ter no máximo 5 MB.';
        return;
      }
      row.dataset.scoreUploading = 'true';
      section.querySelector('.prompt-score-status').textContent = `Lendo “${file.name}”…`;
      let fileSaved = false;
      try {
        const xml = await readMusicXmlFile(file);
        const saved = await saveMediaFile(file);
        fileSaved = true;
        row.dataset.promptScoreMediaId = saved.id;
        row.dataset.promptScoreMediaName = saved.name;
        row.dataset.promptScoreMediaType = saved.type;
        row.dataset.promptScoreMediaSize = String(saved.size);
        await syncOnlineMedia(saved.id);
        row.dataset.scoreUploading = 'false';
        section.querySelector('[data-action="preview-prompt-score"]').disabled = false;
        section.querySelector('.prompt-score-status').textContent = `Partitura “${file.name}” carregada${accountSession?.role === 'teacher' ? ' e sincronizada com o servidor' : ''}.`;
        await previewPromptScore(row, { id: row.dataset.questionId }, xml);
        exerciseDraft = collectQuestionEditors(dialog);
        autoSaveExercise(dialog);
      } catch (error) {
        row.dataset.scoreUploading = fileSaved && accountSession?.role === 'teacher' ? 'true' : 'false';
        event.target.value = '';
        section.querySelector('.prompt-score-status').textContent = error.message;
        showDialogNotice(dialog, error.message, event.target);
      }
    });
  });
  editor.querySelectorAll('.question-editor-row').forEach(updateChordAssist);
  editor.querySelectorAll('.question-editor-row').forEach(row => {
    const question = exerciseDraft.find(item => item.id === row.dataset.questionId);
    if (question?.type === 'score' && (question.musicMediaId || question.musicXml || safeUrl(question.musicUrl))) {
      prepareScoreEditor(row, question).catch(error => {
        const status = row.querySelector('[data-score-editor-status]');
        if (status) status.textContent = error.message;
      });
    }
  });
  editor.querySelectorAll('.question-musicxml').forEach(input => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const row = input.closest('.question-editor-row');
    let fileSaved = false;
    try {
      const questionId = row.dataset.questionId;
      row.dataset.scoreUploading = 'true';
      const xml = await readMusicXmlFile(file);
      if (row.querySelector('.question-kind')?.value === 'rhythm') {
        row.dataset.rhythmEvents = JSON.stringify(extractRhythmEvents(xml));
      }
      const saved = await saveMediaFile(file);
      fileSaved = true;
      pendingScoreFiles.set(questionId, saved);
      await syncOnlineMedia(saved.id);
      row.dataset.scoreUploading = 'false';
      if (row.querySelector('.question-kind')?.value === 'score') {
        await prepareScoreEditor(row, { id: questionId }, xml);
      }
      showDialogNotice(dialog, `Partitura “${file.name}” carregada${accountSession?.role === 'teacher' ? ' e sincronizada com o servidor' : ''}.`);
      autoSaveExercise(dialog);
    } catch (error) {
      row.dataset.scoreUploading = fileSaved && accountSession?.role === 'teacher' ? 'true' : 'false';
      input.value = '';
      showDialogNotice(dialog, error.message, row.querySelector('.question-musicxml'));
    }
  }));
  editor.querySelectorAll('.question-material-file').forEach(input => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const row = input.closest('.question-editor-row');
    const status = row.querySelector('.question-material-status');
    row.dataset.mediaUploading = 'true';
    status.textContent = `Salvando “${file.name}”...`;
    let fileSaved = false;
    try {
      const saved = await saveMediaFile(file);
      fileSaved = true;
      row.dataset.mediaId = saved.id;
      row.dataset.mediaName = saved.name;
      row.dataset.mediaType = saved.type;
      row.dataset.mediaSize = String(saved.size);
      await syncOnlineMedia(saved.id);
      row.dataset.mediaUploading = 'false';
      status.textContent = `Arquivo pronto: ${saved.name}${accountSession?.role === 'teacher' ? ' · salvo localmente e no servidor' : ''}.`;
      showDialogNotice(dialog, `Material “${saved.name}” salvo${accountSession?.role === 'teacher' ? ' e sincronizado' : ' neste navegador'}.`);
      autoSaveExercise(dialog);
    } catch (error) {
      row.dataset.mediaUploading = fileSaved && accountSession?.role === 'teacher' ? 'true' : 'false';
      status.textContent = error.message;
      input.value = '';
      showDialogNotice(dialog, error.message, input);
    }
  }));
  editor.querySelectorAll('.question-prompt-file, .question-audio-file').forEach(input => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const row = input.closest('.question-editor-row');
    const audio = input.matches('.question-audio-file');
    const status = row.querySelector(audio ? '.question-audio-status' : '.question-prompt-status');
    try {
      await saveQuestionMedia(row, file, audio ? 'audio' : 'prompt', status, dialog);
      autoSaveExercise(dialog);
    } catch (error) {
      input.value = '';
      showDialogNotice(dialog, error.message, input);
    }
  }));
  editor.querySelectorAll('.question-audio-frequency').forEach(input => input.addEventListener('input', () => {
    const row = input.closest('.question-editor-row');
    row.dataset.audioFrequency = input.value;
    const preview = row.querySelector('.question-audio-preview [data-media-id]');
    if (preview) preview.dataset.mediaFrequency = input.value;
  }));
  editor.querySelectorAll('.question-allow-audio-response').forEach(input => input.addEventListener('change', () => {
    input.closest('.question-editor-row').querySelector('.question-audio-required-line').hidden = !input.checked;
  }));
  hydrateMedia(editor);
}

function collectQuestionEditors(dialog) {
  return [...dialog.querySelectorAll('.question-editor-row')].map(row => {
    const old = exerciseDraft.find(question => question.id === row.dataset.questionId) || {};
    const type = row.querySelector('.question-kind').value;
    const rawAnswer = row.querySelector('.question-answer')?.value ?? old.answer ?? '';
    const question = {
      ...old,
      id: old.id || createId(),
      type,
      prompt: sanitizeRichText(row.querySelector('.question-prompt').innerHTML),
      points: Number(row.querySelector('.question-points').value) || 0,
      feedback: row.querySelector('.question-feedback').value.trim(),
      answer: rawAnswer,
      acceptedAnswers: row.querySelector('.question-accepted')?.value.split(';').map(item => item.trim()).filter(Boolean) || old.acceptedAnswers || [],
      promptMediaId: row.dataset.promptMediaId || old.promptMediaId || '',
      promptMediaName: row.dataset.promptMediaName || old.promptMediaName || '',
      promptMediaType: row.dataset.promptMediaType || old.promptMediaType || '',
      promptMediaSize: Number(row.dataset.promptMediaSize) || old.promptMediaSize || 0,
      promptScoreSource: row.querySelector('.question-prompt-score-source')?.value || old.promptScoreSource || 'upload',
      promptScoreMediaId: row.dataset.promptScoreMediaId || old.promptScoreMediaId || '',
      promptScoreMediaName: row.dataset.promptScoreMediaName || old.promptScoreMediaName || '',
      promptScoreMediaType: row.dataset.promptScoreMediaType || old.promptScoreMediaType || '',
      promptScoreMediaSize: Number(row.dataset.promptScoreMediaSize) || old.promptScoreMediaSize || 0,
      promptScoreUrl: row.querySelector('.question-prompt-score-url')?.value.trim() || '',
      audioMediaId: row.dataset.audioMediaId || old.audioMediaId || '',
      audioMediaName: row.dataset.audioMediaName || old.audioMediaName || '',
      audioMediaType: row.dataset.audioMediaType || old.audioMediaType || '',
      audioMediaSize: Number(row.dataset.audioMediaSize) || old.audioMediaSize || 0,
      audioFrequency: row.querySelector('.question-audio-frequency')?.value || row.dataset.audioFrequency || old.audioFrequency || '',
      allowAudioResponse: row.querySelector('.question-allow-audio-response')?.checked || false,
      requireAudioResponse: row.querySelector('.question-allow-audio-response')?.checked
        && row.querySelector('.question-require-audio-response')?.checked || false,
      manual: type === 'material' || (type !== 'chord' && type !== 'ear' && type !== 'score' && !rawAnswer)
    };
    if (type === 'choice') question.options = (row.querySelector('.question-options')?.value || '').split('\n').map(item => item.trim()).filter(Boolean);
    if (type === 'chord') {
      question.expectedNotes = (row.querySelector('.question-notes')?.value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean);
      question.assemblyOrder = (row.querySelector('.question-assembly-order')?.value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean);
      question.assemblyHints = (row.querySelector('.question-assembly-hints')?.value || '').split('\n').map(item => item.trim()).filter(Boolean);
      question.correctionCriterion = row.querySelector('.question-chord-criterion')?.value || 'notes';
      question.expectedIntervals = (row.querySelector('.question-intervals')?.value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
      question.ignoreOctave = row.querySelector('.question-ignore-octave')?.checked || false;
      question.acceptEnharmonic = row.querySelector('.question-accept-enharmonic')?.checked !== false;
      question.chordOrder = row.querySelector('.question-chord-order')?.value
        || old.chordOrder
        || (question.assemblyOrder.length ? 'sequence' : 'any');
      question.referenceNotes = (row.querySelector('.question-reference-notes')?.value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean);
      question.manual = !question.expectedNotes.length
        && !(question.correctionCriterion === 'intervals' && question.expectedIntervals.length);
    }
    if (type === 'ear') {
      question.referenceNotes = (row.querySelector('.question-reference-notes')?.value || '').split(/[,\s;]+/).map(item => item.trim()).filter(Boolean);
      question.manual = !question.answer;
    }
    if (type === 'score' || type === 'rhythm') {
      question.scoreSource = row.querySelector('.question-score-source')?.value || old.scoreSource || 'upload';
      const pendingFile = pendingScoreFiles.get(question.id);
      question.musicMediaId = question.scoreSource === 'upload' ? pendingFile?.id || old.musicMediaId || '' : '';
      question.musicMediaName = question.scoreSource === 'upload' ? pendingFile?.name || old.musicMediaName || '' : '';
      question.musicMediaType = question.scoreSource === 'upload' ? pendingFile?.type || old.musicMediaType || '' : '';
      question.musicMediaSize = question.scoreSource === 'upload' ? pendingFile?.size || old.musicMediaSize || 0 : 0;
      question.musicUrl = row.querySelector('.question-musicxml-url')?.value.trim() || old.musicUrl || '';
      question.musicXml = question.scoreSource === 'upload' ? old.musicXml || '' : '';
      if (type === 'score') {
        question.measure = Number(row.querySelector('.question-measure')?.value) || 1;
        question.manual = !question.answer;
      } else {
        question.retryLimit = Math.min(10, Math.max(1, Number(row.querySelector('.question-rhythm-retry-limit')?.value) || 3));
        question.toleranceMs = Math.min(500, Math.max(60, Number(row.querySelector('.question-rhythm-tolerance')?.value) || 220));
        try { question.rhythmEvents = JSON.parse(row.dataset.rhythmEvents || JSON.stringify(old.rhythmEvents || [])); }
        catch { question.rhythmEvents = old.rhythmEvents || []; }
        question.manual = false;
      }
    }
    if (type === 'material') {
      question.mediaSource = row.querySelector('.question-material-source')?.value || old.mediaSource || 'link';
      question.mediaId = row.dataset.mediaId || old.mediaId || '';
      question.mediaName = row.dataset.mediaName || old.mediaName || '';
      question.mediaType = row.dataset.mediaType || old.mediaType || '';
      question.mediaSize = Number(row.dataset.mediaSize) || old.mediaSize || 0;
      question.referenceUrl = row.querySelector('.question-reference-url')?.value.trim() || '';
    }
    return question;
  });
}

function autoSaveExercise(dialog, { force = false } = {}) {
  if (dialog.dataset.exerciseCommitted === 'true') return;
  const formElement = dialog.querySelector('#exercise-form');
  if (!formElement) return;
  const id = String(new FormData(formElement).get('id') || '');
  const existing = getExercise(id);
  if (existing && exerciseStatus(existing) !== 'draft') {
    const status = dialog.querySelector('[data-exercise-save-status]');
    if (status) status.textContent = 'Atividade publicada ou encerrada: salve para aplicar as alterações.';
    return;
  }
  exerciseDraft = collectQuestionEditors(dialog);
  const form = new FormData(formElement);
  const hasContent = Boolean(
    String(form.get('title') || '').trim()
    || String(form.get('instructions') || '').trim()
    || exerciseDraft.some(question => {
      const prompt = document.createElement('div');
      prompt.innerHTML = question.prompt || '';
      return prompt.textContent.trim()
        || question.answer
        || question.options?.some(option => option.trim())
        || question.acceptedAnswers?.length
        || question.expectedNotes?.length
        || question.referenceNotes?.length
        || question.promptScoreMediaId
        || question.promptScoreUrl
        || question.promptMediaId
        || question.audioMediaId
        || question.musicMediaId
        || question.mediaId;
    })
  );
  if (!hasContent && !force) return;
  saveExerciseFromDialog(dialog, id, true, { closeAfterSave: false });
}

function saveExerciseFromDialog(dialog, id, saveAsDraft = false, { closeAfterSave = true } = {}) {
  const releaseField = 'activityStudentIds';
  if (dialog.querySelector('.question-editor-row[data-score-uploading="true"], .question-editor-row[data-media-uploading="true"]')) {
    showDialogNotice(dialog, 'Aguarde o fim do envio dos arquivos antes de salvar o exercício.');
    return;
  }
  const form = new FormData(dialog.querySelector('#exercise-form'));
  exerciseDraft = collectQuestionEditors(dialog);
  const fail = (message, question, selector) => {
    const row = question && dialog.querySelector(`.question-editor-row[data-question-id="${CSS.escape(question.id)}"]`);
    const target = question ? row?.querySelector(selector) || row : dialog.querySelector(selector);
    showDialogNotice(dialog, message, target);
    return false;
  };
  if (!saveAsDraft) {
    const title = String(form.get('title') || '').trim();
    if (!title) return fail('Informe um título para o exercício.', null, '[name="title"]');
    if (!exerciseDraft.length) return fail('Adicione ao menos uma questão antes de publicar.', null, '[data-action="add-question"]');
    const blankQuestion = exerciseDraft.find(question => {
      const content = document.createElement('div');
      content.innerHTML = question.prompt;
      return !content.textContent.trim();
    });
    if (blankQuestion) return fail('Escreva o enunciado de todas as questões.', blankQuestion, '.question-prompt');
    const incompleteChoice = exerciseDraft.find(question => question.type === 'choice' && question.options.length < 2);
    if (incompleteChoice) return fail('Adicione pelo menos duas alternativas à questão.', incompleteChoice, '.question-options');
    const missingChoiceAnswer = exerciseDraft.find(question => question.type === 'choice'
      && (!question.answer || !question.options.includes(question.answer)));
    if (missingChoiceAnswer) return fail('Escolha uma resposta correta que corresponda a uma das alternativas.', missingChoiceAnswer, '.question-answer');
    const invalidChord = exerciseDraft.find(question => question.type === 'chord'
      && [...question.expectedNotes, ...(question.assemblyOrder || []), ...(question.referenceNotes || [])].some(note => !Number.isFinite(parseCurrentNote(note))));
    if (invalidChord) return fail('Confira as notas do acorde. Use A a G, sustenido (#) ou bemol (b), com oitava opcional, como C, F#3 ou Bb4.', invalidChord, '.question-notes');
    const missingChordNotes = exerciseDraft.find(question => question.type === 'chord'
      && ['sequence', 'inversion'].includes(question.chordOrder)
      && !question.expectedNotes.length && !question.assemblyOrder?.length);
    if (missingChordNotes) return fail('Para exigir uma sequência ou inversão, informe as notas esperadas ou a sequência didática.', missingChordNotes, '.question-notes');
    const invalidIntervals = exerciseDraft.find(question => question.type === 'chord'
      && (question.expectedIntervals || []).some(interval => !Number.isInteger(interval) || interval < 1 || interval > 12));
    if (invalidIntervals) return fail('Informe intervalos inteiros entre 1 e 12 semitons.', invalidIntervals, '.question-intervals');
    const missingEarReference = exerciseDraft.find(question => question.type === 'ear'
      && (!question.referenceNotes.length || question.referenceNotes.some(note => !Number.isFinite(parseCurrentNote(note)))));
    if (missingEarReference) return fail('Adicione notas válidas ao acorde de referência para que ele possa ser reproduzido.', missingEarReference, '.question-reference-notes');
    const missingScore = exerciseDraft.find(question => question.type === 'score'
      && !(question.musicXml || (question.scoreSource === 'upload' ? question.musicMediaId : safeUrl(question.musicUrl))));
    if (missingScore) return fail('Anexe um arquivo XML ou MXL ou informe um link acessível para a partitura.', missingScore, missingScore.scoreSource === 'upload' ? '.question-musicxml' : '.question-musicxml-url');
    const missingRhythm = exerciseDraft.find(question => question.type === 'rhythm'
      && (!(question.musicXml || question.musicMediaId) || !Array.isArray(question.rhythmEvents) || !question.rhythmEvents.length));
    if (missingRhythm) return fail('Envie uma partitura MusicXML com notas rítmicas válidas para esta questão.', missingRhythm, '.question-musicxml');
    const missingMaterial = exerciseDraft.find(question => question.type === 'material'
      && (question.mediaSource === 'upload' ? !question.mediaId : !safeUrl(question.referenceUrl)));
    if (missingMaterial) return fail(missingMaterial.mediaSource === 'upload'
      ? 'Envie o arquivo de apoio desta questão antes de publicar.'
      : 'Informe um link HTTP ou HTTPS válido para o material.', missingMaterial,
    missingMaterial.mediaSource === 'upload' ? '.question-material-file' : '.question-reference-url');
  }
  const previous = getExercise(id);
  const lessonIds = [...dialog.querySelectorAll('[name="lessonIds"]:checked')].map(input => input.value);
  const isAssessment = form.get('activityKind') === 'assessment';
  const exerciseBlockId = isAssessment ? '' : String(form.get('exerciseBlockId') || '');
  if (!saveAsDraft && !isAssessment && !getExerciseBlock(exerciseBlockId)) {
    showDialogNotice(dialog, 'Escolha um bloco de exercícios antes de publicar.', dialog.querySelector('[name="exerciseBlockId"]'));
    return;
  }
  const releaseValue = String(form.get('releaseAt') || '');
  const deadlineValue = String(form.get('deadlineAt') || '');
  const releaseAt = releaseValue ? new Date(releaseValue).toISOString() : '';
  const deadlineAt = deadlineValue ? new Date(deadlineValue).toISOString() : '';
  if (isAssessment && releaseAt && deadlineAt && Date.parse(deadlineAt) <= Date.parse(releaseAt)) {
    showDialogNotice(dialog, 'O prazo final precisa ser posterior à data de liberação.', dialog.querySelector('[name="deadlineAt"]'));
    return;
  }
  const data = {
    id: id || createId(),
    title: String(form.get('title') || '').trim(),
    instructions: String(form.get('instructions') || '').trim(),
    difficulty: String(form.get('difficulty') || 'Iniciante'),
    status: saveAsDraft ? 'draft' : String(form.get('status') || 'draft'),
    published: !saveAsDraft && form.get('status') === 'published',
    showAnswers: dialog.querySelector('[name="showAnswers"]').checked,
    exerciseBlockId,
    order: previous?.exerciseBlockId === exerciseBlockId
      ? previous.order
      : model.exercises.filter(item => item.id !== previous?.id && item.exerciseBlockId === exerciseBlockId).length + 1,
    releaseMode: String(form.get('releaseMode') || 'all'),
    releasedStudentIds: [...dialog.querySelectorAll(`[name="${releaseField}"]:checked`)].map(input => input.value),
    assessment: isAssessment ? {
      durationMinutes: Math.min(300, Math.max(1, Number(form.get('durationMinutes')) || 30)),
      releaseAt, deadlineAt, lockOnExit: dialog.querySelector('[name="lockOnExit"]').checked
    } : null,
    questions: exerciseDraft,
    lessonIds,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (previous) Object.assign(previous, data);
  else model.exercises.push(data);
  dialog.querySelector('#exercise-form [name="id"]').value = data.id;
  for (const lesson of model.lessons) {
    lesson.exerciseIds = Array.isArray(lesson.exerciseIds) ? lesson.exerciseIds : [];
    const had = lesson.exerciseIds.includes(data.id);
    const should = lessonIds.includes(lesson.id);
    if (should && !had) lesson.exerciseIds.push(data.id);
    if (!should && had) lesson.exerciseIds = lesson.exerciseIds.filter(item => item !== data.id);
  }
  if (!closeAfterSave) {
    try {
      model = saveModel(model);
      queueRemoteModelSave({ silent: true });
      const status = dialog.querySelector('[data-exercise-save-status]');
      if (status) status.textContent = 'Rascunho salvo automaticamente neste dispositivo.';
      dialog.dataset.exerciseAutoSaved = 'true';
    } catch (error) {
      toast(`Não foi possível salvar o rascunho: ${error.message}`, 'error');
      const status = dialog.querySelector('[data-exercise-save-status]');
      if (status) status.textContent = 'Falha ao salvar. Tente novamente.';
    }
    return;
  }
  dialog.dataset.exerciseCommitted = 'true';
  dialog.close();
  exerciseDraft = null;
  persist(saveAsDraft ? 'Rascunho salvo. Você pode continuar editando quando quiser.'
    : previous ? 'Exercício atualizado.' : 'Exercício criado.');
}

function questionValue(exercise, question, index, card) {
  if (question.type === 'choice' || question.type === 'boolean') return card.querySelector(`[name="answer-${index}"]:checked`)?.value || '';
  if (question.type === 'rhythm') {
    const activity = card.querySelector(`[data-rhythm-question="${CSS.escape(question.id)}"]`);
    if (!activity?.dataset.rhythmReport) return '';
    try { return JSON.parse(activity.dataset.rhythmReport); }
    catch { return ''; }
  }
  if (question.type === 'chord') {
    const typedNotes = card.querySelector(`[name="answer-${index}"]`)?.value.trim();
    if (typedNotes) {
      const tokens = typedNotes.split(/[\s,;]+/).filter(Boolean);
      parseCurrentNotes(tokens);
      return tokens;
    }
    try { return JSON.parse(card.querySelector(`[data-piano="piano-${CSS.escape(question.id)}"]`)?.dataset.selected || '[]'); }
    catch { return []; }
  }
  return card.querySelector(`[name="answer-${index}"]`)?.value?.trim() || '';
}

function rhythmTone() {
  playClickSound();
}

function startRhythmActivity(questionId) {
  const activity = root.querySelector(`[data-rhythm-question="${CSS.escape(questionId)}"]`);
  if (!activity) return;
  const events = JSON.parse(activity.dataset.events || '[]');
  const maximum = Number(activity.dataset.maxAttempts) || 3;
  let previous = {};
  try { previous = JSON.parse(activity.dataset.rhythmReport || '{}'); } catch { }
  const plays = Array.isArray(previous.plays) ? previous.plays : [];
  if (!events.length || plays.length >= maximum) return;
  const state = {
    activity, events, tolerance: Number(activity.dataset.tolerance) || 220,
    plays, taps: [], outOfOrder: [], index: 0, startedAt: 0, timer: null, token: createId()
  };
  rhythmRunStates.set(questionId, state);
  activity.dataset.runToken = state.token;
  activity.dataset.state = 'count-in';
  activity.querySelectorAll('.rhythm-note-target').forEach(button => {
    button.disabled = true;
    button.classList.remove('current', 'rhythm-correct', 'rhythm-error');
  });
  const startButton = activity.querySelector('[data-action="start-rhythm"]');
  startButton.disabled = true;
  const status = activity.querySelector('[data-rhythm-status]');
  const beatMs = 60_000 / Math.max(30, Math.min(240, Number(activity.dataset.tempo) || 80));
  for (let beat = 0; beat < 4; beat += 1) {
    setTimeout(() => {
      if (activity.dataset.runToken !== state.token) return;
      status.textContent = `Contagem ${beat + 1} de 4`;
      rhythmTone();
    }, beat * beatMs);
  }
  setTimeout(() => {
    if (activity.dataset.runToken !== state.token) return;
    activity.dataset.state = 'playing';
    status.textContent = 'Toque as notas na partitura no tempo certo.';
    state.startedAt = performance.now();
    activateRhythmEvent(questionId, state);
  }, beatMs * 4);
}

function activateRhythmEvent(questionId, state) {
  if (state.index >= state.events.length) {
    const correct = state.taps.filter(tap => tap.correct).length;
    const play = {
      taps: state.taps,
      outOfOrder: state.outOfOrder,
      correct,
      total: state.events.length,
      accuracy: state.events.length ? Math.round(correct / state.events.length * 100) : 0,
      startedAt: new Date().toISOString()
    };
    state.plays.push(play);
    const best = state.plays.reduce((previous, current) => current.accuracy > previous.accuracy ? current : previous);
    state.activity.dataset.rhythmReport = JSON.stringify({ plays: state.plays, bestAccuracy: best.accuracy, bestCorrect: best.accuracy === 100 });
    state.activity.dataset.state = 'complete';
    state.activity.querySelector('[data-rhythm-status]').textContent = `Execução ${state.plays.length}: ${correct}/${state.events.length} no tempo · ${play.outOfOrder.length} toque(s) fora de ordem.`;
    const startButton = state.activity.querySelector('[data-action="start-rhythm"]');
    startButton.disabled = state.plays.length >= Number(state.activity.dataset.maxAttempts);
    startButton.textContent = startButton.disabled ? 'Limite de execuções atingido' : 'Tentar novamente';
    rhythmRunStates.delete(questionId);
    return;
  }
  const index = state.index;
  const event = state.events[index];
  const marker = state.activity.querySelector(`.rhythm-beat-marker[data-index="${index}"]`);
  const button = state.activity.querySelector('.rhythm-tap-button');
  if (!button || !marker) return;
  button.disabled = false;
  marker.classList.add('current');
  state.activity.querySelector('[data-rhythm-status]').textContent = `Nota ${index + 1} de ${state.events.length}`;
  const targetAt = state.startedAt + Number(event.timeSeconds) * 1000;
  const wait = Math.max(0, targetAt + state.tolerance - performance.now());
  state.timer = setTimeout(() => {
    if (state.activity.dataset.runToken !== state.token || state.index !== index) return;
    button.disabled = true;
    marker.classList.remove('current');
    marker.classList.add('rhythm-error');
    const atMs = Math.round(performance.now() - state.startedAt);
    state.taps.push({ index, atMs, errorMs: Math.round(atMs - Number(state.events[index].timeSeconds) * 1000), correct: false, missed: true });
    state.index += 1;
    activateRhythmEvent(questionId, state);
  }, wait);
}

function tapRhythmNote(questionId) {
  const state = rhythmRunStates.get(questionId);
  if (!state || state.activity.dataset.state !== 'playing') return;
  const index = state.index;
  const button = state.activity.querySelector('.rhythm-tap-button');
  const marker = state.activity.querySelector(`.rhythm-beat-marker[data-index="${index}"]`);
  if (!button || !marker) return;
  clearTimeout(state.timer);
  const targetAt = state.startedAt + Number(state.events[index].timeSeconds) * 1000;
  const atMs = Math.round(performance.now() - state.startedAt);
  const errorMs = Math.round(atMs - Number(state.events[index].timeSeconds) * 1000);
  const correct = Math.abs(errorMs) <= state.tolerance;
  button.disabled = true;
  marker.classList.remove('current');
  marker.classList.add(correct ? 'rhythm-correct' : 'rhythm-error');
  state.taps.push({ index, atMs, errorMs, correct, missed: false });
  state.index += 1;
  activateRhythmEvent(questionId, state);
}

async function submitAttempt(form, exercise) {
  if (currentProfile().role === 'teacher') {
    toast('Alterne para a visualização de aluno em Perfil e dados para testar a atividade.', 'error');
    return;
  }
  const attachments = [];
  const selectedFiles = [...(form.querySelector('#exercise-attachments')?.files || [])];
  try {
    for (const file of selectedFiles) {
      attachments.push(await saveMediaFile(file));
    }
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const answers = [];
  let score = 0;
  let maxScore = 0;
  let values;
  try {
    values = exercise.questions.map((question, index) => questionValue(exercise, question, index, form));
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const audioResponses = new Map([...form.querySelectorAll('.quiz-question')].map(section => [
    section.dataset.question,
    section.dataset.responseAudioId ? {
      id: section.dataset.responseAudioId,
      name: section.dataset.responseAudioName,
      type: section.dataset.responseAudioType,
      size: Number(section.dataset.responseAudioSize) || 0
    } : null
  ]));
  const missingRequiredAudio = exercise.questions.findIndex((question, index) =>
    question.requireAudioResponse && !audioResponses.get(question.id));
  if (missingRequiredAudio !== -1) {
    toast(`Grave ou envie o áudio da questão ${missingRequiredAudio + 1} antes de enviar.`, 'error');
    form.querySelectorAll('.quiz-question')[missingRequiredAudio]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const unanswered = values.findIndex((value, index) => {
    const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(String(value).trim());
    return !hasValue && !audioResponses.get(exercise.questions[index].id);
  });
  if (unanswered !== -1) {
    toast(`Responda à questão ${unanswered + 1} antes de enviar.`, 'error');
    form.querySelector(`[data-index="${unanswered}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  exercise.questions.forEach((question, index) => {
    const points = Math.max(0, Number(question.points) || 0);
    maxScore += points;
    const value = values[index];
    const audioAttachment = audioResponses.get(question.id);
    const emptyValue = Array.isArray(value) ? value.length === 0 : !String(value).trim();
    const correct = emptyValue && audioAttachment ? null : answerMatches(question, value);
    const manual = correct === null || Boolean(audioAttachment);
    if (correct && !manual) score += points;
    answers.push({
      questionId: question.id, prompt: question.prompt, points, value,
      correct: Boolean(correct && !manual), manual, manualScore: 0,
      ...(audioAttachment ? { audioAttachment } : {})
    });
  });
  const attempt = {
    id: createId(), exerciseId: exercise.id, profileName: currentProfile().displayName,
    answers, attachments, score, maxScore,
    startedAt: new Date(Number(form.dataset.startedAt) || Date.now()).toISOString(),
    durationSeconds: Math.max(0, Math.round((Date.now() - Number(form.dataset.startedAt)) / 1000)),
    createdAt: new Date().toISOString()
  };
  model.attempts.push(attempt);
  try { model = saveModel(model); }
  catch (error) { model.attempts.pop(); toast(error.message, 'error'); return; }
  if (accountSession?.role === 'student') {
    try {
      for (const answer of answers) {
        if (answer.audioAttachment) await uploadStudentMedia(answer.audioAttachment);
      }
      for (const attachment of attachments) await uploadStudentMedia(attachment);
      const saved = await accountRequest('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ attempt })
      });
      model.attempts = model.attempts.filter(item => item.id !== attempt.id);
      model.attempts.push(saved.attempt);
      model = saveModel(model);
    } catch (error) {
      render();
      enqueuePendingAttempt(attempt);
      toast(`Sem conexão. A resposta ficou guardada neste aparelho e será enviada automaticamente ao restabelecer a internet. ${error.message}`, 'error');
      return;
    }
  }
  render();
  toast(accountSession?.role === 'student' ? 'Respostas enviadas ao professor.' : 'Respostas registradas neste navegador.');
}

function syncDeleteLesson(lessonId) {
  for (const exercise of model.exercises) exercise.lessonIds = exercise.lessonIds.filter(id => id !== lessonId);
}

function deleteBlock(id) {
  const block = getBlock(id);
  if (!block) return;
  const lessons = model.lessons.filter(lesson => lesson.blockId === id);
  if (!confirm(`Excluir o bloco “${block.title}” e suas ${lessons.length} aula(s)? Os exercícios serão preservados e apenas desvinculados das aulas removidas.`)) return;
  const lessonIds = new Set(lessons.map(lesson => lesson.id));
  for (const exercise of model.exercises) exercise.lessonIds = exercise.lessonIds.filter(lessonId => !lessonIds.has(lessonId));
  model.trails = model.trails.filter(step => step.blockId !== id);
  model.lessons = model.lessons.filter(lesson => lesson.blockId !== id);
  model.blocks = model.blocks.filter(item => item.id !== id);
  selectedBlockId = null;
  root.querySelector('#active-dialog')?.close();
  persist('Bloco removido. Exercícios relacionados foram preservados.');
}

function deleteLesson(id) {
  const lesson = getLesson(id);
  if (!lesson || !confirm(`Excluir a aula “${lesson.title}”? Os exercícios continuarão cadastrados e deixarão de apontar para esta aula.`)) return;
  syncDeleteLesson(id);
  model.trails.forEach(step => { if (step.lessonId === id) step.lessonId = ''; });
  model.lessons = model.lessons.filter(item => item.id !== id);
  const activeDialog = root.querySelector('#active-dialog');
  if (activeDialog?.querySelector('#lesson-form [name="id"]')?.value === id) {
    activeDialog.dataset.lessonCommitted = 'true';
    activeDialog.dataset.lessonDeleted = 'true';
  }
  activeDialog?.close();
  activeLessonId = null;
  view = 'aulas';
  persist('Aula removida; os exercícios foram preservados.');
}

function deleteExercise(id) {
  const exercise = getExercise(id);
  if (!exercise || !confirm(`Excluir o exercício “${exercise.title}”? Essa ação também remove as tentativas locais deste exercício.`)) return;
  model.exercises = model.exercises.filter(item => item.id !== id);
  for (const lesson of model.lessons) lesson.exerciseIds = lesson.exerciseIds.filter(exerciseId => exerciseId !== id);
  model.attempts = model.attempts.filter(item => item.exerciseId !== id);
  const activeDialog = root.querySelector('#active-dialog');
  if (activeDialog?.querySelector('#exercise-form [name="id"]')?.value === id) {
    activeDialog.dataset.exerciseCommitted = 'true';
  }
  activeDialog?.close();
  activeExerciseId = null;
  view = 'exercicios';
  persist('Exercício e tentativas removidos.');
}

function moveRow(row, direction, selector, renderCallback) {
  const list = [...row.parentElement.querySelectorAll(selector)];
  const index = list.indexOf(row);
  const next = index + direction;
  if (next < 0 || next >= list.length) return;
  const saved = renderCallback();
  const item = saved.splice(index, 1)[0];
  saved.splice(next, 0, item);
  renderCallback(saved);
}

function mediaReferences(source = model) {
  const references = new Map();
  for (const attempt of source.attempts || []) {
    for (const attachment of attempt.attachments || []) {
      if (attachment.id) references.set(attachment.id, {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size
      });
    }
  }
  for (const lesson of source.lessons || []) {
    for (const block of lesson.content || []) {
      if (block.mediaSource === 'upload' && block.mediaId) references.set(block.mediaId, { id: block.mediaId, name: block.mediaName, type: block.mediaType, size: block.mediaSize });
    }
  }
  for (const exercise of source.exercises || []) {
    for (const question of exercise.questions || []) {
      if (question.type === 'material' && question.mediaSource === 'upload' && question.mediaId) {
        references.set(question.mediaId, { id: question.mediaId, name: question.mediaName, type: question.mediaType, size: question.mediaSize });
      }
      if (question.type === 'score' && (question.scoreSource || 'upload') === 'upload' && question.musicMediaId) {
        references.set(question.musicMediaId, { id: question.musicMediaId, name: question.musicMediaName, type: question.musicMediaType, size: question.musicMediaSize });
      }
      if (question.promptScoreMediaId) {
        references.set(question.promptScoreMediaId, {
          id: question.promptScoreMediaId,
          name: question.promptScoreMediaName,
          type: question.promptScoreMediaType,
          size: question.promptScoreMediaSize
        });
      }
    }
  }
  return [...references.values()];
}

async function downloadData() {
  const backup = JSON.parse(exportModel(model));
  backup.mediaFiles = await Promise.all(mediaReferences().map(async item => ({
    ...item,
    dataUrl: await mediaAsDataUrl(item.id)
  })));
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `notarium-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Cópia JSON exportada com ${backup.mediaFiles.length} arquivo(s) de mídia.`);
}

function importData(file) {
  if (!file) return;
  file.text().then(async textContent => {
    const raw = JSON.parse(textContent);
    const backupMedia = Array.isArray(raw.mediaFiles) ? raw.mediaFiles : [];
    delete raw.mediaFiles;
    const imported = importModel(JSON.stringify(raw));
    if (!confirm('Importar este arquivo substituirá todos os dados locais atuais. Exporte uma cópia antes se quiser guardá-los. Continuar?')) return;
    const mediaIds = new Map();
    for (const media of backupMedia) {
      if (!media || typeof media.id !== 'string' || typeof media.dataUrl !== 'string') throw new Error('O backup contém um anexo inválido.');
      const restored = await restoreMediaDataUrl(media.dataUrl, media.name, undefined);
      mediaIds.set(media.id, restored.id);
    }
    for (const lesson of imported.lessons) {
      for (const block of lesson.content || []) {
        if (mediaIds.has(block.mediaId)) block.mediaId = mediaIds.get(block.mediaId);
      }
    }
    for (const exercise of imported.exercises) {
      for (const question of exercise.questions || []) {
        if (mediaIds.has(question.mediaId)) question.mediaId = mediaIds.get(question.mediaId);
        if (mediaIds.has(question.musicMediaId)) question.musicMediaId = mediaIds.get(question.musicMediaId);
        if (mediaIds.has(question.promptScoreMediaId)) question.promptScoreMediaId = mediaIds.get(question.promptScoreMediaId);
      }
    }
    model = saveModel(imported);
    selectedBlockId = null;
    activeExerciseId = null;
    activeLessonId = null;
    view = 'inicio';
    render();
    toast(`Dados importados e validados. ${backupMedia.length} anexo(s) restaurado(s).`);
  }).catch(error => toast(error.message, 'error'));
}

async function encodeProfileAvatar(file) {
  if (!file) return '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('A foto deve ser PNG, JPEG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('A imagem do perfil deve ter no máximo 5 MB.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('O arquivo selecionado não contém uma imagem válida.'));
    element.src = source;
  });
  const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Este navegador não conseguiu preparar a imagem do perfil.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL('image/jpeg', 0.78);
  if (result.length > 300_000) throw new Error('A imagem ainda é grande demais para o perfil; escolha outra imagem.');
  return result;
}

async function saveProfile(form) {
  const data = new FormData(form);
  const displayName = String(data.get('displayName') || '').trim();
  if (!displayName) { toast('Informe um nome de exibição.', 'error'); return; }
  const username = String(data.get('username') || '').trim().replace(/^@/, '');
  if ((accountSession && !/^[A-Za-z0-9._-]{3,30}$/.test(username))
      || (username && !/^[A-Za-z0-9._-]{1,30}$/.test(username))) {
    toast('O nome de usuário aceita somente letras, números, ponto, traço e sublinhado.', 'error');
    return;
  }
  const errorLabel = form.querySelector('[data-profile-error]');
  if (errorLabel) errorLabel.textContent = '';
  let avatarDataUrl = currentProfile().avatarDataUrl || '';
  const file = form.querySelector('[name="avatarFile"]')?.files?.[0];
  if (file) {
    try { avatarDataUrl = await encodeProfileAvatar(file); }
    catch (error) {
      if (errorLabel) errorLabel.textContent = error.message;
      toast(error.message, 'error');
      return;
    }
  }
  const previous = currentProfile().displayName;
  if (accountSession) {
    try {
      const updated = await accountRequest('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: displayName, username })
      });
      accountSession = updated.user;
    } catch (error) {
      if (errorLabel) errorLabel.textContent = error.message;
      toast(error.message, 'error');
      return;
    }
  }
  model.profile.displayName = displayName;
  model.profile.username = username;
  model.profile.bio = String(data.get('bio') || '').trim();
  model.profile.avatarDataUrl = avatarDataUrl;
  model.profile.defaultOctave = Number(data.get('defaultOctave')) || 0;
  model.profile.role = accountSession?.role || (data.get('role') === 'student' ? 'student' : 'teacher');
  if (previous !== displayName) model.attempts.forEach(attempt => {
    if (accountSession?.role === 'student' && attempt.studentId === accountSession.id) attempt.profileName = displayName;
    else if (!accountSession && !attempt.isDemo && attempt.profileName === previous) attempt.profileName = displayName;
  });
  view = 'perfil';
  selectedProfileId = null;
  profileTab = 'profile';
  persist(accountSession ? 'Perfil da conta atualizado.' : 'Perfil atualizado.');
}

function previewLesson(dialog) {
  const form = new FormData(dialog.querySelector('#lesson-form'));
  const blocks = collectContentEditors(dialog);
  const title = String(form.get('title') || 'Prévia da aula');
  const content = blocks.map(renderContentBlock).join('');
  const preview = openDialog(`<p class="eyebrow">PRÉVIA DO ALUNO</p><h2>${esc(title)}</h2><p class="dialog-intro">Esta é uma prévia do conteúdo da aula.</p><article class="lesson-reader">${content || '<p>Adicione blocos de conteúdo para visualizar.</p>'}</article>`, 'preview-modal', true);
  hydrateMedia(preview);
}

root.addEventListener('click', event => {
  if (!event.target.closest('.settings-menu')) toggleSettingsMenu(true);
  const nav = event.target.closest('[data-view]');
  if (nav) {
    event.preventDefault();
    selectedBlockId = null;
    selectedProfileId = null;
    if (nav.dataset.view === 'exercicios' || nav.dataset.view === 'playlists') {
      selectedExercisePlaylistId = null;
      selectedExerciseBlockId = null;
    }
    if (nav.dataset.view === 'resultados') resultsStudentId = null;
    navigate(nav.dataset.view);
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  const dialog = root.querySelector('#active-dialog');
  if (action === 'open-media-viewer') {
    openMediaViewer(actionButton.dataset.viewerUrl, actionButton.dataset.viewerType, actionButton.dataset.viewerName);
  } else if (action === 'media-zoom-in' || action === 'media-zoom-out' || action === 'media-zoom-reset') {
    const viewer = actionButton.closest('.media-viewer-modal');
    const scale = Number(viewer?.dataset.viewerScale) || 1;
    setViewerScale(viewer, action === 'media-zoom-in' ? scale * 1.2 : action === 'media-zoom-out' ? scale / 1.2 : 1);
  } else if (action === 'toggle-media-fullscreen') {
    const viewer = actionButton.closest('.media-viewer-modal');
    const fullscreen = document.fullscreenElement === viewer;
    const changeFullscreen = fullscreen ? document.exitFullscreen() : viewer?.requestFullscreen();
    Promise.resolve(changeFullscreen).then(() => {
      actionButton.textContent = fullscreen ? 'Tela cheia' : 'Sair da tela cheia';
    }).catch(error => toast(`Não foi possível alternar para tela cheia: ${error.message}`, 'error'));
  } else if (action === 'record-audio' || action === 'record-response-audio') {
    const row = actionButton.closest(action === 'record-audio' ? '.question-editor-row' : '.quiz-question');
    if (row) startQuestionRecording(row, action === 'record-audio' ? 'audio' : 'response', dialog);
  } else if (action === 'stop-audio-recording' || action === 'stop-response-audio') {
    const row = actionButton.closest(action === 'stop-audio-recording' ? '.question-editor-row' : '.quiz-question');
    if (row) stopQuestionRecording(row);
  } else if (action === 'quick-settings') {
    openQuickSettings();
  } else if (action === 'open-notification') {
    openNotification(id);
  } else if (action === 'mark-attempt-reviewed') {
    markAttemptReviewed(id);
  } else if (action === 'start-rhythm') {
    startRhythmActivity(actionButton.dataset.question);
  } else if (action === 'tap-rhythm') {
    tapRhythmNote(actionButton.dataset.rhythmQuestion);
  } else if (action === 'toggle-learning-progress') {
    setLearningComplete(actionButton.dataset.type, id, !learningComplete(actionButton.dataset.type, id));
  } else if (action === 'open-history-content') {
    const item = actionButton.dataset.type === 'lesson' ? getLesson(id) : getExercise(id);
    if (!item || item.accessLocked) {
      toast('Este conteúdo não está disponível no momento.', 'error');
      return;
    }
    if (actionButton.dataset.type === 'lesson') {
      activeLessonId = id;
      showActivityLoading(item.title, () => navigate('aula'));
    } else {
      activeExerciseId = id;
      showActivityLoading(item.title, () => navigate('exercicio'));
    }
  } else if (action === 'open-exercise-block') {
    const block = getExerciseBlock(id);
    selectedExerciseBlockId = id;
    selectedExercisePlaylistId = block?.playlistId || null;
    navigate('exercicios');
  } else if (action === 'open-exercise-playlist') {
    selectedExercisePlaylistId = id;
    selectedExerciseBlockId = null;
    navigate('playlists');
  } else if (action === 'back-exercise-blocks') {
    selectedExerciseBlockId = null;
    selectedExercisePlaylistId = null;
    navigate('exercicios');
  } else if (action === 'back-exercise-playlist') {
    selectedExerciseBlockId = null;
    navigate('playlists');
  } else if (action === 'back-exercise-playlists') {
    selectedExercisePlaylistId = null;
    selectedExerciseBlockId = null;
    navigate('playlists');
  } else if (action === 'add-playlist-entry') {
    openPlaylistEntryEditor(actionButton.dataset.entryType);
  } else if (action === 'edit-playlist-divider') {
    openPlaylistDividerEditor(actionButton.dataset.entryId);
  } else if (action === 'move-playlist-entry') {
    const playlist = model.playlists.find(item => item.id === selectedExercisePlaylistId);
    if (!playlist) return;
    const entries = ensurePlaylistEntries(playlist);
    const from = entries.findIndex(entry => entry.id === actionButton.dataset.entryId);
    const to = from + Number(actionButton.dataset.direction);
    if (from < 0 || to < 0 || to >= entries.length) return;
    [entries[from], entries[to]] = [entries[to], entries[from]];
    persist('Ordem da playlist atualizada.');
  } else if (action === 'remove-playlist-entry') {
    const playlist = model.playlists.find(item => item.id === selectedExercisePlaylistId);
    if (!playlist) return;
    const entries = ensurePlaylistEntries(playlist);
    const removed = entries.find(entry => entry.id === actionButton.dataset.entryId);
    if (removed?.type === 'exerciseBlock' && removed.id.startsWith('legacy-')) {
      const block = getExerciseBlock(removed.contentId);
      if (block?.playlistId === playlist.id) block.playlistId = '';
    }
    playlist.entries = entries.filter(entry => entry.id !== actionButton.dataset.entryId);
    persist('Conteúdo removido da playlist; o item original foi mantido.');
  } else if (action === 'new-exercise-playlist') {
    openExercisePlaylistEditor();
  } else if (action === 'edit-exercise-playlist') {
    openExercisePlaylistEditor(id);
  } else if (action === 'delete-exercise-playlist') {
    const playlist = model.playlists.find(item => item.id === id);
    if (!playlist) return;
    if (!confirm(`Excluir a playlist “${playlist.title}”? Os blocos serão mantidos sem playlist.`)) return;
    for (const block of model.exerciseBlocks) {
      if (block.playlistId === id) block.playlistId = '';
    }
    model.playlists = model.playlists.filter(item => item.id !== id);
    selectedExercisePlaylistId = null;
    selectedExerciseBlockId = null;
    dialog?.close();
    persist('Playlist excluída; os blocos foram mantidos.');
  } else if (action === 'new-exercise-block') {
    openExerciseBlockEditor('', actionButton.dataset.playlistId || selectedExercisePlaylistId || '');
  } else if (action === 'edit-exercise-block') {
    openExerciseBlockEditor(id);
  } else if (action === 'delete-exercise-block') {
    const block = getExerciseBlock(id);
    if (block && confirm(`Excluir o bloco “${block.title}”? Os exercícios serão preservados como atividades sem bloco.`)) {
      model.exercises.forEach(exercise => {
        if (exercise.exerciseBlockId === id) delete exercise.exerciseBlockId;
      });
      model.exerciseBlocks = model.exerciseBlocks.filter(item => item.id !== id);
      selectedExerciseBlockId = null;
      dialog?.close();
      persist('Bloco removido. Os exercícios foram preservados.');
    }
  } else if (action === 'unlock-exam') {
    accountRequest('/api/exams/unlock', {
      method: 'POST', body: JSON.stringify({ examId: actionButton.dataset.examId, studentId: actionButton.dataset.studentId })
    }).then(() => {
      dialog?.close();
      return refreshNotifications(false);
    }).then(() => {
      if (view === 'notificacoes') render();
      toast('Avaliação liberada novamente. O aluno receberá um aviso.');
    }).catch(error => toast(error.message, 'error'));
  } else if (action === 'account-login') {
    showAccountLogin();
  } else if (action === 'open-students') {
    dialog?.close();
    navigate('alunos');
  } else if (action === 'open-online-student') {
    selectedOnlineStudentId = id || actionButton.dataset.id || null;
    selectedProfileId = null;
    render();
  } else if (action === 'back-student-list') {
    selectedOnlineStudentId = null;
    selectedProfileId = null;
    render();
  } else if (action === 'open-student-attempt') {
    resultsStudentId = id || actionButton.dataset.id || null;
    resultsExerciseId = actionButton.dataset.exerciseId || resultsExerciseId;
    navigate('resultados');
  } else if (action === 'open-student-responses') {
    resultsStudentId = id || null;
    const attempt = model.attempts.find(item => item.studentId === resultsStudentId && !item.isDemo);
    resultsExerciseId = attempt?.exerciseId || resultsExerciseId;
    navigate('resultados');
  } else if (action === 'open-configurations') {
    dialog?.close();
    toggleSettingsMenu(true);
    navigate('configuracoes');
  } else if (action === 'logout') {
    dialog?.close();
    toggleSettingsMenu(true);
    logoutAccount();
  } else if (action === 'refresh-students') {
    refreshStudents();
  } else if (action === 'edit-student') {
    const student = studentsCache.find(item => item.id === id);
    if (!student) return;
    const dialog = openDialog(`<p class="eyebrow">EDITAR CONTA</p><h2>${esc(student.name)}</h2><p class="dialog-intro">Altere o nome exibido, o usuário usado para entrar ou defina uma nova senha.</p><form id="student-edit-form" class="stack-form"><input type="hidden" name="studentId" value="${esc(student.id)}"><label class="field-label">Nome de exibição<input name="name" maxlength="60" required value="${esc(student.name)}" autocomplete="name"></label><label class="field-label">Nome de usuário<input name="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9._\\-]{3,30}" required value="${esc(student.username)}" autocomplete="off"><small class="form-help">De 3 a 30 caracteres; letras, números, ponto, traço ou sublinhado.</small></label><label class="field-label">Nova senha <span class="optional-label">Opcional</span><input name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Deixe em branco para não alterar"><small class="form-help">Ao alterar, todas as sessões atuais do aluno serão encerradas.</small></label><p class="account-form-error" data-student-edit-error role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-action="close-dialog">Cancelar</button><button class="button primary" type="submit">Salvar alterações</button></div></form>`);
    dialog.addEventListener('submit', async event => {
      if (event.target.id !== 'student-edit-form') return;
      event.preventDefault();
      const form = event.target;
      const data = new FormData(form);
      const studentId = String(data.get('studentId') || '');
      const body = {
        name: String(data.get('name') || '').trim(),
        username: String(data.get('username') || '').trim(),
        password: String(data.get('password') || '')
      };
      try {
        const result = await accountRequest(`/api/students/${encodeURIComponent(studentId)}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        studentsCache = studentsCache.map(item => item.id === studentId ? result.student : item)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        dialog.close();
        render();
        toast(result.passwordChanged ? 'Conta atualizada e nova senha definida.' : 'Dados da conta atualizados.');
      } catch (error) {
        const message = form.querySelector('[data-student-edit-error]');
        if (message) message.textContent = error.message;
      }
    });
  } else if (action === 'remove-student') {
    const student = studentsCache.find(item => item.id === id);
    if (student && confirm(`Remover o acesso de ${student.name}? Esta pessoa não poderá entrar novamente e as respostas vinculadas à conta serão removidas.`)) {
      accountRequest(`/api/students/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => {
        studentsCache = studentsCache.filter(item => item.id !== id);
        render();
        toast('Acesso do aluno removido.');
      }).catch(error => toast(error.message, 'error'));
    }
  } else if (action === 'copy-portal-link') {
    copyText(accountPortalUrl || `${location.origin}${location.pathname}?login=1`, 'Endereço do portal copiado.');
  } else if (action === 'copy-student-access') {
    if (!lastCreatedStudentAccess) return;
    const access = lastCreatedStudentAccess;
    copyText(`Notarium: ${access.portalUrl}\nUsuário: ${access.username}\nSenha inicial: ${access.password}`, 'Dados de acesso copiados. Compartilhe-os de forma privada.');
  } else if (action === 'dismiss-student-access') {
    lastCreatedStudentAccess = null;
    render();
  } else if (action === 'theme') {
    setThemePreference(model.profile.theme === 'dark' ? 'light' : 'dark');
  } else if (action === 'toggle-sounds') {
    const enabled = !soundEnabled();
    localStorage.setItem('notarium-click-sounds', enabled ? 'on' : 'off');
    openQuickSettings();
    toast(enabled ? 'Som de clique ativado.' : 'Som de clique desligado.');
  } else if (action === 'profile') {
    selectedProfileId = null;
    profileTab = 'profile';
    navigate('perfil');
  } else if (action === 'settings') {
    toggleSettingsMenu();
  } else if (action === 'accessibility') {
    toggleSettingsMenu(true);
    openQuickSettings();
  }
  else if (action === 'save-profile') actionButton.closest('#profile-form')?.requestSubmit();
  else if (action === 'profile-tab') {
    selectedProfileId = null;
    profileTab = ['profile', 'settings'].includes(actionButton.dataset.tab)
      ? actionButton.dataset.tab
      : 'profile';
    view = 'perfil';
    render();
  } else if (action === 'open-member') {
    if (demoMembers.some(member => member.id === actionButton.dataset.memberId)) {
      selectedProfileId = actionButton.dataset.memberId;
      view = 'perfil';
      render();
    }
  } else if (action === 'open-student-trail') {
    if (demoMembers.some(member => member.id === actionButton.dataset.studentId)) {
      selectedTrailStudentId = actionButton.dataset.studentId;
      navigate('trilha');
    }
  } else if (action === 'configure-trail') {
    openTrailSettingsEditor(selectedTrailStudentId);
  } else if (action === 'new-trail-step') {
    if (currentProfile().role === 'teacher') openTrailStepEditor('', actionButton.dataset.studentId || selectedTrailStudentId);
  } else if (action === 'open-trail-detail') {
    openTrailStepDetails(id);
  } else if (action === 'edit-trail-step') {
    if (currentProfile().role === 'teacher') openTrailStepEditor(id);
  } else if (action === 'delete-trail-step') {
    const step = model.trails.find(item => item.id === id);
    if (currentProfile().role === 'teacher' && step
        && confirm(`Remover “${step.title}” da trilha de ${demoMembers.find(member => member.id === step.studentId)?.name || 'este aluno'}?`)) {
      model.trails = model.trails.filter(item => item.id !== id);
      model.trails.filter(item => item.studentId === selectedTrailStudentId)
        .sort((a, b) => a.order - b.order).forEach((item, index) => { item.order = index + 1; });
      persist('Etapa removida da trilha.');
    }
  } else if (action === 'move-trail-step') {
    if (currentProfile().role !== 'teacher') return;
    const steps = model.trails.filter(item => item.studentId === selectedTrailStudentId).sort((a, b) => a.order - b.order);
    const from = steps.findIndex(item => item.id === id);
    const to = from + Number(actionButton.dataset.direction);
    if (from < 0 || to < 0 || to >= steps.length) return;
    [steps[from], steps[to]] = [steps[to], steps[from]];
    steps.forEach((item, index) => { item.order = index + 1; });
    persist('Ordem da trilha atualizada.');
  } else if (action === 'toggle-trail-step') {
    if (currentProfile().role !== 'student') return;
    const step = model.trails.find(item => item.id === id && item.studentId === selectedTrailStudentId);
    if (!step) return;
    step.completed = !step.completed;
    step.status = step.completed ? 'completed' : 'pending';
    step.completedAt = step.completed ? new Date().toISOString() : '';
    persist(step.completed ? 'Etapa marcada como concluída.' : 'Etapa voltou para a lista de atividades.');
  } else if (action === 'set-trail-step-status') {
    if (currentProfile().role !== 'student') return;
    const step = model.trails.find(item => item.id === id && item.studentId === selectedTrailStudentId);
    const status = actionButton.dataset.status;
    if (!step || !['pending', 'in_progress', 'completed'].includes(status)) return;
    step.status = status;
    step.completed = status === 'completed';
    step.completedAt = step.completed ? new Date().toISOString() : '';
    persist(status === 'completed' ? 'Etapa marcada como concluída.' : status === 'in_progress' ? 'Etapa iniciada.' : 'Etapa voltou para pendente.');
  } else if (action === 'open-trail-target') {
    const step = model.trails.find(item => item.id === id && item.studentId === selectedTrailStudentId);
    if (!step || !getBlock(step.blockId)) {
      toast('O bloco desta etapa não está mais disponível.', 'error');
      return;
    }
    dialog?.close();
    if (step.lessonId && getLesson(step.lessonId)) {
      const lesson = getLesson(step.lessonId);
      activeLessonId = lesson.id;
      showActivityLoading(lesson.title, () => navigate('aula'));
    } else {
      selectedBlockId = step.blockId;
      navigate('aulas');
    }
  } else if (action === 'collaborator-filter') {
    collaboratorFilter = ['all', 'online', 'admin', 'moderator'].includes(actionButton.dataset.filter)
      ? actionButton.dataset.filter
      : 'all';
    render();
    applyProfileMemberFilters();
  } else if (action === 'clear-avatar') {
    currentProfile().avatarDataUrl = '';
    persist('Foto removida do perfil da conta.');
  } else if (action === 'play-typed-chord') {
    const input = actionButton.closest('.quiz-question')?.querySelector('.music-note-answer');
    try {
      const notes = parseCurrentNotes(input?.value || '');
      playNotes(notes, 0.9, defaultOctave()).catch(error => toast(error.message, 'error'));
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  else if (action === 'download-catalog-media') {
    downloadCatalogMedia(actionButton.dataset.mediaId).catch(error => toast(error.message, 'error'));
  }
  else if (action === 'go-lessons') { selectedBlockId = null; navigate('aulas'); }
  else if (action === 'go-exercises') {
    selectedExercisePlaylistId = null;
    selectedExerciseBlockId = null;
    navigate('exercicios');
  }
  else if (action === 'request-practice-list') requestPracticeList();
  else if (action === 'back-blocks') { selectedBlockId = null; activeLessonId = null; navigate('aulas'); }
  else if (action === 'new-block') openBlockEditor();
  else if (action === 'edit-block') openBlockEditor(id);
  else if (action === 'open-block') { selectedBlockId = id; navigate('aulas'); }
  else if (action === 'delete-block') deleteBlock(id);
  else if (action === 'new-lesson') {
    if (!model.blocks.length) { toast('Crie um bloco antes de adicionar aulas.', 'error'); return; }
    openLessonEditor(selectedBlockId || model.blocks[0].id);
  } else if (action === 'edit-lesson') openLessonEditor(getLesson(id)?.blockId || selectedBlockId || '', id);
  else if (action === 'open-lesson') {
    const lesson = getLesson(id);
    if (!lesson) return;
    activeLessonId = id;
    showActivityLoading(lesson.title, () => navigate('aula'));
  }
  else if (action === 'delete-lesson') deleteLesson(id);
  else if (action === 'new-exercise') {
    if (selectedExerciseBlockId === 'unassigned' && !actionButton.dataset.exerciseBlockId) openExerciseBlockEditor();
    else openExerciseEditor('', '', false, actionButton.dataset.exerciseBlockId || selectedExerciseBlockId || '');
  }
  else if (action === 'new-assessment') openExerciseEditor('', '', true);
  else if (action === 'new-related-exercise') openExerciseEditor('', id);
  else if (action === 'new-related-from-lesson') {
    const lessonFormId = dialog?.querySelector('#lesson-form [name="id"]')?.value;
    const lessonId = lessonFormId && lessonFormId !== 'new' ? lessonFormId : '';
    if (!lessonId) {
      showDialogNotice(dialog, 'Salve a aula antes de criar um exercício relacionado.', dialog?.querySelector('#lesson-form [name="title"]'));
      return;
    }
    dialog?.close();
    openExerciseEditor('', lessonId);
  } else if (action === 'edit-exercise') openExerciseEditor(id);
  else if (action === 'publish-exercise') {
    openExerciseEditor(id);
    const publishDialog = root.querySelector('#active-dialog');
    const statusSelect = publishDialog?.querySelector('[name="status"]');
    const exerciseForm = publishDialog?.querySelector('#exercise-form');
    if (statusSelect && exerciseForm) {
      statusSelect.value = 'published';
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
      exerciseForm.requestSubmit();
    }
  }
  else if (action === 'open-exercise') {
    if (getExercise(id)?.assessment) openAssessment(id);
    else {
      const exercise = getExercise(id);
      if (!exercise) return;
      activeExerciseId = id;
      showActivityLoading(exercise.title, () => navigate('exercicio'));
    }
  }
  else if (action === 'show-exercise-results') openExerciseResults(id);
  else if (action === 'move-exercise') openMoveExerciseDialog(id);
  else if (action === 'exercise-order-up') moveExerciseOrder(id, -1);
  else if (action === 'exercise-order-down') moveExerciseOrder(id, 1);
  else if (action === 'delete-exercise') deleteExercise(id);
  else if (action === 'save-exercise-draft') {
    const exerciseForm = dialog?.querySelector('#exercise-form');
    if (exerciseForm) saveExerciseFromDialog(dialog, exerciseForm.elements.namedItem('id').value, true);
  } else if (action === 'insert-chord-symbol') {
    insertPromptSymbol(actionButton.closest('.question-editor-row')?.querySelector('.question-prompt'), actionButton.dataset.symbol || '');
    exerciseDraft = collectQuestionEditors(dialog);
  } else if (action === 'format-chord-text') {
    formatPromptSelection(actionButton.closest('.question-editor-row')?.querySelector('.question-prompt'), actionButton.dataset.format);
    exerciseDraft = collectQuestionEditors(dialog);
  }
  else if (action === 'close-dialog') actionButton.closest('dialog')?.close();
  else if (action === 'add-question') {
    exerciseDraft = collectQuestionEditors(dialog);
    exerciseDraft.push({ id: createId(), type: 'written', prompt: '', points: 1, answer: '', feedback: '' });
    renderQuestionEditors(dialog);
    autoSaveExercise(dialog, { force: true });
  } else if (action === 'question-remove') {
    exerciseDraft = collectQuestionEditors(dialog);
    exerciseDraft.splice(Number(actionButton.closest('.question-editor-row').dataset.questionIndex), 1);
    renderQuestionEditors(dialog);
    autoSaveExercise(dialog, { force: true });
  } else if (action === 'question-up' || action === 'question-down') {
    exerciseDraft = collectQuestionEditors(dialog);
    const from = Number(actionButton.closest('.question-editor-row').dataset.questionIndex);
    const to = from + (action === 'question-up' ? -1 : 1);
    if (to >= 0 && to < exerciseDraft.length) [exerciseDraft[from], exerciseDraft[to]] = [exerciseDraft[to], exerciseDraft[from]];
    renderQuestionEditors(dialog);
    autoSaveExercise(dialog, { force: true });
  } else if (action === 'submit-attempt') {
    event.preventDefault();
    const form = actionButton.closest('form');
    if (!form?.reportValidity()) return;
    const exercise = getExercise(activeExerciseId);
    if (exercise) submitAttempt(form, exercise);
  } else if (action === 'play-reference') {
    const exercise = getExercise(activeExerciseId);
    const question = exercise?.questions.find(item => item.id === actionButton.dataset.question);
    const notes = question?.referenceNotes?.map(parseCurrentNote).filter(Number.isFinite) || [];
    playNotes(notes, 0.9, defaultOctave()).catch(error => toast(error.message, 'error'));
  } else if (action === 'play-chord-reference') {
    const question = getExercise(activeExerciseId)?.questions.find(item => item.id === actionButton.dataset.question);
    const notes = question?.referenceNotes?.map(parseCurrentNote).filter(Number.isFinite) || [];
    playNotes(notes, 0.9, defaultOctave()).catch(error => toast(error.message, 'error'));
  } else if (action === 'play-score' || action === 'play-score-preview') {
    playScoreFromCache(actionButton, actionButton.dataset.question);
  } else if (action === 'play-prompt-score' || action === 'play-prompt-score-preview') {
    playScoreFromCache(actionButton, actionButton.dataset.question);
  } else if (action === 'preview-prompt-score') {
    const row = actionButton.closest('.question-editor-row');
    const status = row?.querySelector('.prompt-score-status');
    exerciseDraft = collectQuestionEditors(dialog);
    const question = exerciseDraft.find(item => item.id === row?.dataset.questionId);
    if (!row || !question) return;
    actionButton.disabled = true;
    if (status) status.textContent = 'Carregando prévia da partitura…';
    previewPromptScore(row, question)
      .catch(error => {
        if (status) status.textContent = error.message;
        showDialogNotice(dialog, error.message, row.querySelector('.question-prompt-score-file') || row.querySelector('.question-prompt-score-url'));
      })
      .finally(() => { if (row.isConnected) actionButton.disabled = false; });
  } else if (action === 'preview-score') {
    const row = actionButton.closest('.question-editor-row');
    const status = row?.querySelector('[data-score-editor-status]');
    exerciseDraft = collectQuestionEditors(dialog);
    const question = exerciseDraft.find(item => item.id === actionButton.dataset.question);
    if (!row || !question) return;
    actionButton.disabled = true;
    if (status) status.textContent = 'Carregando prévia da partitura…';
    loadQuestionMusicXml(question)
      .then(xml => prepareScoreEditor(row, question, xml))
      .catch(error => {
        if (status) status.textContent = error.message;
        showDialogNotice(dialog, error.message, row.querySelector('.question-musicxml') || row.querySelector('.question-musicxml-url'));
      })
      .finally(() => { if (row.isConnected) actionButton.disabled = false; });
  } else if (action === 'simulate-demo') {
    const exercise = getExercise(id);
    if (exercise) simulateDemoResponses(exercise);
  } else if (action === 'clear-demo') {
    const exercise = getExercise(id);
    if (exercise && confirm(`Remover somente as respostas fictícias de “${exercise.title}”? As respostas locais reais serão preservadas.`)) clearDemoResponses(exercise);
  } else if (action === 'open-attempt-review') {
    dialog?.close();
    openAttemptReview(id);
  } else if (action === 'save-attempt-review') {
    const attempt = model.attempts.find(item => item.id === id);
    if (!attempt) return;
    const grades = {};
    const comments = {};
    for (const answer of attempt.answers || []) {
      const gradeInput = root.querySelector(`[data-grade-answer="${CSS.escape(answer.questionId)}"][data-attempt="${CSS.escape(id)}"]`);
      if (answer.manual && gradeInput) {
        answer.manualScore = Math.min(Number(answer.points) || 0, Math.max(0, Number(gradeInput.value) || 0));
        answer.correct = answer.manualScore >= (Number(answer.points) || 0);
        grades[answer.questionId] = answer.manualScore;
      }
      const commentInput = root.querySelector(`[data-comment-answer="${CSS.escape(answer.questionId)}"][data-attempt="${CSS.escape(id)}"]`);
      const comment = String(commentInput?.value || '').trim();
      comments[answer.questionId] = comment;
      answer.teacherComment = comment;
    }
    const dialogToClose = root.querySelector('#active-dialog');
    dialogToClose?.close();
    if (!accountSession?.role || accountSession.role !== 'teacher') {
      persist('Correção salva.');
      return;
    }
    accountRequest(`/api/attempts/${encodeURIComponent(id)}/grade`, {
      method: 'POST',
      body: JSON.stringify({ grades, comments })
    }).then(result => {
      Object.assign(attempt, result.attempt);
      render();
      toast('Correção e comentários enviados ao aluno.');
    }).catch(error => toast(error.message, 'error'));
  } else if (action === 'save-grade') {
    const attempt = model.attempts.find(item => item.id === id);
    if (!attempt) return;
    let total = 0;
    const grades = {};
    for (const answer of attempt.answers.filter(item => item.manual)) {
      const input = root.querySelector(`[data-grade-answer="${CSS.escape(answer.questionId)}"][data-attempt="${CSS.escape(id)}"]`);
      answer.manualScore = Math.min(Number(answer.points) || 0, Math.max(0, Number(input?.value) || 0));
      answer.correct = answer.manualScore >= (Number(answer.points) || 0);
      grades[answer.questionId] = Number(answer.manualScore) || 0;
    }
    for (const answer of attempt.answers) total += answer.manual ? Number(answer.manualScore) || 0 : answer.correct ? Number(answer.points) || 0 : 0;
    attempt.score = total;
    attempt.gradedAt = new Date().toISOString();
    if (accountSession?.role === 'teacher' && attempt.studentId) {
      accountRequest(`/api/attempts/${encodeURIComponent(id)}/grade`, {
        method: 'POST',
        body: JSON.stringify({ grades })
      }).then(result => {
        Object.assign(attempt, result.attempt);
        render();
        toast('Correção manual salva e enviada ao aluno.');
      }).catch(error => toast(error.message, 'error'));
    } else {
      persist('Correção manual salva.');
    }
  } else if (action === 'export-data') downloadData().catch(error => toast(error.message, 'error'));
  else if (action === 'import-data') root.querySelector('#import-file').click();
  else if (action === 'preview-lesson') previewLesson(dialog);
  else if (action === 'content-format') {
    const textarea = actionButton.closest('.content-editor-row')?.querySelector('.content-text');
    if (textarea) formatContentText(textarea, actionButton.dataset.format);
  }
  else if (action === 'add-content') {}
  else if (action === 'content-remove' || action === 'content-up' || action === 'content-down') {
    const editor = dialog?.querySelector('#content-editor');
    const items = collectContentEditors(dialog);
    const index = Number(actionButton.closest('.content-editor-row').dataset.contentIndex);
    if (action === 'content-remove') items.splice(index, 1);
    else {
      const next = index + (action === 'content-up' ? -1 : 1);
      if (next >= 0 && next < items.length) [items[index], items[next]] = [items[next], items[index]];
    }
    if (editor) editor.innerHTML = items.map(contentBlockEditor).join('');
    autoSaveLesson(dialog);
  }
});

root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !root.querySelector('#active-dialog')) {
    toggleSettingsMenu(true);
  }
});

root.addEventListener('change', event => {
  if (['theme-preference', 'quick-theme-preference'].includes(event.target.id)) {
    setThemePreference(event.target.value);
  } else if (['click-sounds-toggle', 'quick-click-sounds-toggle'].includes(event.target.id)) {
    localStorage.setItem('notarium-click-sounds', event.target.checked ? 'on' : 'off');
    toast(event.target.checked ? 'Som de clique ativado.' : 'Som de clique desligado.');
  } else if (event.target.id === 'default-octave-preference') {
    model.profile.defaultOctave = Number(event.target.value);
    model = saveModel(model);
    toast('Oitava padrão atualizada.');
  } else if (event.target.matches?.('.answer-audio-file')) {
    const file = event.target.files?.[0];
    if (!file) return;
    const section = event.target.closest('.quiz-question');
    const status = section?.querySelector('.answer-audio-status');
    if (!section || !status) return;
    saveQuestionMedia(section, file, 'response', status).then(saved => {
      section.dataset.responseAudioId = saved.id;
      section.dataset.responseAudioName = saved.name;
      section.dataset.responseAudioType = saved.type;
      section.dataset.responseAudioSize = String(saved.size);
      const preview = section.querySelector('.answer-audio-preview');
      if (preview) {
        preview.innerHTML = uploadedMediaMarkup(saved.id, saved.name, saved.type);
        hydrateMedia(preview);
      }
    }).catch(error => {
      event.target.value = '';
      toast(error.message, 'error');
    });
  } else if (event.target.id === 'click-sound-note') {
    if (['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'].includes(event.target.value)) {
      localStorage.setItem('notarium-click-note', event.target.value);
      playClickSound();
    }
  } else if (event.target.matches('#profile-form [name="avatarFile"]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast('Escolha uma imagem PNG, JPEG ou WebP de até 5 MB.', 'error');
      event.target.value = '';
      return;
    }
    const preview = root.querySelector('.profile-avatar-preview .profile-avatar');
    if (preview) {
      const image = document.createElement('img');
      const url = URL.createObjectURL(file);
      image.alt = '';
      image.onload = () => URL.revokeObjectURL(url);
      image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
      preview.replaceChildren(image);
    }
  } else if (event.target.id === 'trail-student-select') {
    if (demoMembers.some(member => member.id === event.target.value)) {
      selectedTrailStudentId = event.target.value;
      render();
    }
  } else if (event.target.id === 'trail-block-select') {
    const dialog = root.querySelector('#active-dialog');
    const lessonSelect = dialog?.querySelector('#trail-lesson-select');
    if (lessonSelect) {
      const currentLessonId = lessonSelect.value;
      const lessons = model.lessons.filter(lesson => lesson.blockId === event.target.value);
      lessonSelect.innerHTML = `<option value="">Abrir o bloco completo</option>${lessons.map(lesson => `<option value="${esc(lesson.id)}" ${lesson.id === currentLessonId ? 'selected' : ''}>${esc(lesson.title)}</option>`).join('')}`;
    }
  } else if (event.target.id === 'group-member-sort') {
    collaboratorSort = event.target.value === 'activity' ? 'activity' : 'name';
    applyProfileMemberFilters();
  } else if (event.target.id === 'new-content-kind' && event.target.value) {
    const dialog = root.querySelector('#active-dialog');
    const blocks = collectContentEditors(dialog);
    blocks.push({ id: createId(), type: event.target.value, text: '', title: '', url: '', alt: '' });
    dialog.querySelector('#content-editor').innerHTML = blocks.map(contentBlockEditor).join('');
    event.target.value = '';
    autoSaveLesson(dialog);
  } else if (event.target.matches('.content-source')) {
    const row = event.target.closest('.content-editor-row');
    row.querySelector('.content-upload-fields').hidden = event.target.value !== 'upload';
    row.querySelector('.content-link-fields').hidden = event.target.value !== 'link';
  } else if (event.target.matches('.content-file')) {
    const file = event.target.files?.[0];
    if (!file) return;
    const row = event.target.closest('.content-editor-row');
    const status = row.querySelector('.content-file-status');
    row.dataset.mediaUploading = 'true';
    status.textContent = `Salvando “${file.name}”...`;
    let fileSaved = false;
    saveMediaFile(file).then(async saved => {
      fileSaved = true;
      row.dataset.mediaId = saved.id;
      row.dataset.mediaName = saved.name;
      row.dataset.mediaType = saved.type;
      row.dataset.mediaSize = String(saved.size);
      await syncOnlineMedia(saved.id);
      row.dataset.mediaUploading = 'false';
      status.textContent = `Arquivo pronto: ${saved.name} · ${(saved.size / 1024 / 1024).toFixed(1)} MB${accountSession?.role === 'teacher' ? ' · salvo também no servidor' : ''}.`;
      const lessonDialog = row.closest('#active-dialog');
      if (lessonDialog) autoSaveLesson(lessonDialog);
    }).catch(error => {
      row.dataset.mediaUploading = fileSaved && accountSession?.role === 'teacher' ? 'true' : 'false';
      event.target.value = '';
      status.textContent = error.message;
      toast(error.message, 'error');
    });
  } else if (event.target.matches('.question-score-source, .question-material-source')) {
    const row = event.target.closest('.question-editor-row');
    const score = event.target.matches('.question-score-source');
    row.querySelector(score ? '.score-upload-fields' : '.material-upload-fields').hidden = event.target.value !== 'upload';
    row.querySelector(score ? '.score-link-fields' : '.material-link-fields').hidden = event.target.value !== 'link';
    if (score) {
      const question = exerciseDraft.find(item => item.id === row.dataset.questionId);
      scoreXmlCache.delete(row.dataset.questionId);
      row.querySelector('[data-action="preview-score"]').disabled = event.target.value === 'upload'
        ? !(pendingScoreFiles.has(row.dataset.questionId) || question?.musicMediaId || question?.musicXml)
        : !safeUrl(row.querySelector('.question-musicxml-url')?.value);
      row.querySelector('[data-action="play-score-preview"]').disabled = true;
      const status = row.querySelector('[data-score-editor-status]');
      if (status) status.textContent = 'Carregue a prévia para ouvir a versão selecionada.';
    }
  } else if (event.target.id === 'results-exercise-select') {
    resultsExerciseId = event.target.value;
    render();
  } else if (event.target.id === 'results-student-select') {
    resultsStudentId = event.target.value || null;
    render();
  } else if (event.target.id === 'import-file') {
    importData(event.target.files?.[0]);
    event.target.value = '';
  }
  else if (event.target.matches('#exercise-type-filter, #exercise-block-filter, #exercise-difficulty-filter, #exercise-sort')) applyExerciseFilters();
});

root.addEventListener('input', event => {
  if (event.target.id === 'click-sound-volume') {
    const volume = Math.min(300, Math.max(80, Number(event.target.value) || 300));
    localStorage.setItem('notarium-click-volume', String(volume));
    const output = root.querySelector('#click-volume-output');
    if (output) output.value = `${volume}%`;
  }
  if (event.target.id === 'lesson-search') applyLessonFilter();
  if (event.target.matches('#exercise-search')) applyExerciseFilters();
  if (event.target.id === 'group-member-search') applyProfileMemberFilters();
  if (event.target.id === 'relation-search') {
    const query = event.target.value.toLocaleLowerCase('pt-BR');
    root.querySelectorAll('.relation-item').forEach(item => { item.hidden = !item.textContent.toLocaleLowerCase('pt-BR').includes(query); });
  }
});

root.addEventListener('submit', event => {
  if (event.target.id === 'review-attempt-form') {
    event.preventDefault();
    const data = new FormData(event.target);
    const rating = Math.min(5, Math.max(0, Number(data.get('teacherRating')) || 0));
    const note = String(data.get('teacherNote') || '').trim();
    const id = String(data.get('attemptId') || '');
    const files = [...event.target.querySelector('[name="teacherAttachments"]')?.files || []];
    event.target.closest('dialog')?.close();
    saveAttemptReview(id, rating, note, files);
  }
  if (event.target.id === 'exercise-attempt') {
    event.preventDefault();
    const exercise = getExercise(activeExerciseId);
    if (exercise) submitAttempt(event.target, exercise);
  }
  if (event.target.id === 'exam-reopen-form') {
    event.preventDefault();
    requestExamReopen(assessmentAccess?.examId);
  }
  if (event.target.id === 'profile-form') {
    event.preventDefault();
    saveProfile(event.target).catch(error => toast(error.message, 'error'));
  }
  if (event.target.id === 'account-access-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    accountError = '';
    const endpoint = accountSetupNeeded ? '/api/auth/bootstrap' : '/api/auth/login';
    const payload = {
      username: String(data.get('username') || ''),
      password: String(data.get('password') || '')
    };
    if (accountSetupNeeded) payload.name = String(data.get('name') || '');
    startOnlineSession(endpoint, payload).catch(error => {
      accountError = error.message;
      render();
    });
  }
  if (event.target.id === 'student-create-form') {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    accountRequest('/api/students', {
      method: 'POST',
      body: JSON.stringify({ name, username, password })
    }).then(result => {
      studentsCache = [...studentsCache, { ...result.student, lastSeenAt: null }]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      studentsLoaded = true;
      lastCreatedStudentAccess = {
        name: result.student.name,
        username: result.student.username,
        password,
        portalUrl: result.portalUrl
      };
      render();
      toast(`Acesso criado para ${result.student.name}. Compartilhe a senha em particular.`);
    }).catch(error => {
      const message = root.querySelector('[data-student-error]');
      if (message) message.textContent = error.message;
      else toast(error.message, 'error');
    });
  }
});

window.addEventListener('notarium:error', event => toast(event.detail, 'error'));

async function boot() {
  try {
    model = await loadModel();
    accountSession = null;
    accountError = '';
    if (accountToken) {
      saveAccountToken(accountToken);
      try {
        const response = await accountRequest('/api/auth/session');
        await establishOnlineSession(response, JSON.parse(JSON.stringify(model)), true);
        return;
      } catch (error) {
        if (error.status !== 401) throw error;
        saveAccountToken('');
        accountNotice = 'Sua sessão expirou. Entre novamente para continuar.';
      }
    }
    await showAccountLogin();
    if (accountNotice) render();
  } catch (error) {
    root.innerHTML = `<main class="boot-error"><img src="icone.png" alt=""><p class="eyebrow">NOTARIUM</p><h1>Não foi possível abrir seus dados</h1><p>${esc(error.message)}</p><p>Execute <strong>node server.js</strong> ou abra o Notarium pelo servidor local.</p><button class="button secondary" type="button" id="retry">Tentar novamente</button></main>`;
    root.querySelector('#retry').addEventListener('click', boot);
  }
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  flushPendingAttempts();
}
