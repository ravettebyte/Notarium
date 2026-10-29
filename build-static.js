const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname);
const files = [
  'icone.png',
  'notarium.css',
  'catalog.js',
  'app.js',
  'api-url.js',
  'media-store.js',
  'musicxml.js',
  'piano.js',
  'storage.js',
  'chart-umd.js',
  'jszip-min.js',
  'opensheetmusicdisplay-min.js'
];

async function build() {
  for (const file of files) {
    const source = path.join(root, file);
    await fs.access(source);
  }
  const apiBase = String(process.env.NOTARIUM_API_URL || '').trim().replace(/\/+$/, '');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const configuredHtml = html.replace(
    /(<meta name="notarium-api-base" content=")[^"]*(">)/,
    `$1${apiBase.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}$2`
  );
  await fs.writeFile(path.join(root, 'index.html'), configuredHtml, 'utf8');
  console.log(`Harmonette pronta na raiz${apiBase ? ` usando API ${apiBase}` : ''}`);
}

build().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});