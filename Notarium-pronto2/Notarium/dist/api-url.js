export function apiUrl(path) {
  const endpoint = String(path || '').trim();
  if (!endpoint) throw new TypeError('O caminho da API não pode ficar vazio.');

  const base = document.querySelector('meta[name="notarium-api-base"]')?.content?.trim();
  if (!base) return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  let parsedBase;
  try {
    parsedBase = new URL(base, window.location.href);
  } catch {
    throw new Error('A URL base da API do Notarium está inválida.');
  }
  parsedBase.pathname = `${parsedBase.pathname.replace(/\/+$/, '')}/`;
  parsedBase.search = '';
  parsedBase.hash = '';
  return new URL(endpoint.replace(/^\/+/, ''), parsedBase).href;
}
