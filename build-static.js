const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname);
const dist = path.join(root, 'dist');
const files = [
  '_headers',
  '_redirects',
  'icone.png',
  'notarium.css',
  'catalog.js',
  'app.js',
  'api-url.js',
  'media-store.js',
  'musicxml.js',
  'piano.js',
  'storage.js',
  'chart.umd.js',
  'jszip.min.js',
  'opensheetmusicdisplay.min.js'
];

async function build() {
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
  for (const file of files) {
    await fs.copyFile(path.join(root, file), path.join(dist, file));
  }
  const apiBase = String(process.env.NOTARIUM_API_URL || '').trim().replace(/\/+$/, '');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const configuredHtml = html.replace(
    /(<meta name="notarium-api-base" content=")[^"]*(">)/,
    `$1${apiBase.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}$2`
  );
  await fs.writeFile(path.join(dist, 'index.html'), configuredHtml, 'utf8');
  console.log(`Harmonette pronta em dist${apiBase ? ` usando API ${apiBase}` : ''}`);
}

build().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});