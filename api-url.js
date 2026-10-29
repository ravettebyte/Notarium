const configuredApiBase = document.querySelector('meta[name="notarium-api-base"]')?.content.trim().replace(/\/+$/, '') || '';

export function apiUrl(path) {
  if (!configuredApiBase) return path;
  return new URL(path, `${configuredApiBase}/`).href;
}