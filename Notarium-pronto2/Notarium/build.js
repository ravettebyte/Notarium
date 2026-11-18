const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const FILES = [
  'icone.png',
  'index.css',
  'app.js',
  'api-url.js',
  'media-store.js',
  'musicxml.js',
  'piano.js',
  'storage.js',
  'catalog.js',
  'chart.umd.js',
  'manifest.webmanifest',
  'service-worker.js'
];
const GENERATED_ASSETS = new Map([
  ['chart.umd.js', 'node_modules/chart.js/dist/chart.umd.js']
]);
const API_META_PATTERN = /(<meta\s+name="notarium-api-base"\s+content=")[^"]*(">)/g;

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

function normalizeApiBase(value) {
  const apiBase = String(value || '').trim().replace(/\/+$/, '');
  if (!apiBase) return '';

  let url;
  try {
    url = new URL(apiBase);
  } catch {
    throw new Error('NOTARIUM_API_URL deve ser uma URL absoluta HTTP ou HTTPS.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NOTARIUM_API_URL deve usar HTTP ou HTTPS.');
  }
  return apiBase;
}

async function build(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const outputDir = path.resolve(options.outputDir || path.join(root, 'dist'));
  if (outputDir === root || outputDir.startsWith(`${root}${path.sep}`) === false) {
    throw new Error('A pasta de saída do build precisa ficar fora da raiz e dentro do projeto.');
  }

  const apiBase = normalizeApiBase(options.apiBase ?? process.env.NOTARIUM_API_URL);
  const sourceHtml = path.join(root, 'index.html');
  const html = await fs.readFile(sourceHtml, 'utf8');
  const configuredHtml = html.replace(API_META_PATTERN, (_, start, end) => (
    `${start}${escapeAttribute(apiBase)}${end}`
  ));
  const replacements = html.match(API_META_PATTERN) || [];
  if (replacements.length !== 1) {
    throw new Error('O index.html precisa conter exatamente uma meta notarium-api-base.');
  }

  for (const file of FILES) {
    const source = path.join(root, GENERATED_ASSETS.get(file) || file);
    const stats = await fs.stat(source);
    if (!stats.isFile()) throw new Error(`O arquivo obrigatório não é um arquivo: ${file}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(FILES.map(async file => {
    const source = path.join(root, GENERATED_ASSETS.get(file) || file);
    const destination = path.join(outputDir, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }));
  await fs.writeFile(path.join(outputDir, 'index.html'), configuredHtml, 'utf8');
  return { outputDir, apiBase };
}

if (require.main === module) {
  build()
    .then(({ outputDir, apiBase }) => {
      console.log(`Build do Notarium concluído em ${outputDir}${apiBase ? ` usando API ${apiBase}` : ''}`);
    })
    .catch(error => {
      console.error(`Build failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { build, normalizeApiBase };
